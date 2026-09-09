"""Deriv Accumulator Options bot.

This is deliberately independent from the Higher/Lower, digit, Video, Soft,
and 1-second bots in this repository.  It trades stability rather than
direction: it looks for compressed, non-trending tick movement and then lets
Deriv's ACCU contract manage the moving barriers.

Safety defaults:
  * demo account only;
  * dry-run unless --live-demo is supplied;
  * no martingale;
  * one open contract;
  * two knockout/session-loss stops;
  * 1% growth rate and a short early-profit target.

The live path uses the official Deriv flow: contracts_for -> proposal with
contract_type ACCU -> buy -> proposal_open_contract -> sell/settlement.
The exact barrier values are read from Deriv's proposal/open-contract payloads
when available; they are never guessed for a live trade.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import statistics
import time
from collections import deque
from pathlib import Path
from typing import Any

import aiohttp
import websockets


REST_BASE_URL = "https://api.derivws.com"
PING_INTERVAL = 30
MAX_RECONNECT_ATTEMPTS = 10
RECONNECT_BASE_DELAY = 2
PROPOSAL_MAX_AGE = 4.0

RST = "\033[0m"
BLD = "\033[1m"
DIM = "\033[2m"
GRN = "\033[92m"
RED = "\033[91m"
YLW = "\033[93m"
CYN = "\033[96m"
MAG = "\033[95m"


def as_float(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def as_bool(value: Any, default: bool = False) -> bool:
    """Parse Deriv boolean flags, including 0/1 and string values."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes"}:
            return True
        if normalized in {"0", "false", "no", ""}:
            return False
    return default


def find_accu_contract(value: Any) -> dict[str, Any] | None:
    """Find the ACCU item in either legacy or current contracts_for shapes."""
    if isinstance(value, dict):
        contract_type = str(value.get("contract_type", "")).upper()
        if contract_type == "ACCU":
            return value
        for child in value.values():
            found = find_accu_contract(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_accu_contract(child)
            if found:
                return found
    return None


def mean_or_zero(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def rsi_series(values: list[float], period: int = 14) -> list[float]:
    """Return a simple RSI series without third-party dependencies."""
    if len(values) <= period:
        return []
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    result: list[float] = []
    for end in range(period, len(changes) + 1):
        window = changes[end - period:end]
        gains = sum(max(change, 0.0) for change in window) / period
        losses = sum(max(-change, 0.0) for change in window) / period
        if losses == 0:
            result.append(100.0 if gains else 50.0)
        else:
            result.append(100.0 - (100.0 / (1.0 + gains / losses)))
    return result


def current_stoch_rsi(values: list[float], period: int = 14) -> float | None:
    series = rsi_series(values, period)
    if len(series) < period:
        return None
    window = series[-period:]
    low, high = min(window), max(window)
    if high == low:
        return 0.5
    return (series[-1] - low) / (high - low)


def ema_series(values: list[float], period: int) -> list[float]:
    if len(values) < period:
        return []
    alpha = 2.0 / (period + 1.0)
    ema = statistics.fmean(values[:period])
    result = [ema]
    for value in values[period:]:
        ema = alpha * value + (1.0 - alpha) * ema
        result.append(ema)
    return result


def macd_features(values: list[float], fast: int = 12, slow: int = 26,
                  signal: int = 9) -> dict[str, float] | None:
    """Return MACD values normalized later by the market's typical tick move."""
    fast_line = ema_series(values, fast)
    slow_line = ema_series(values, slow)
    if not fast_line or not slow_line:
        return None
    aligned_fast = fast_line[-len(slow_line):]
    macd_line = [fast_value - slow_value
                 for fast_value, slow_value in zip(aligned_fast, slow_line)]
    signal_line = ema_series(macd_line, signal)
    if not signal_line:
        return None
    histogram = macd_line[-1] - signal_line[-1]
    return {
        "macd": macd_line[-1],
        "macd_signal": signal_line[-1],
        "macd_hist": histogram,
    }


def market_features(quotes: list[float], lookback: int = 20) -> dict[str, float] | None:
    """Calculate stability features used by the entry filter."""
    if len(quotes) < max(lookback + 1, 30):
        return None
    window = quotes[-lookback:]
    changes = [window[i] - window[i - 1] for i in range(1, len(window))]
    absolute = [abs(change) for change in changes]
    median_move = statistics.median(absolute) if absolute else 0.0
    if median_move <= 0:
        return None
    recent = absolute[-5:]
    last_move = absolute[-1] if absolute else 0.0
    recent_peak_ratio = max(recent) / median_move if recent else 0.0
    last_three = changes[-3:]
    directional_cluster_ratio = abs(sum(last_three)) / median_move if last_three else 0.0
    slope = (window[-1] - window[0]) / (median_move * max(len(window) - 1, 1))
    rsi_values = rsi_series(quotes, 14)
    rsi = rsi_values[-1] if rsi_values else 50.0
    srsi = current_stoch_rsi(quotes, 14)
    if srsi is None:
        return None
    macd = macd_features(quotes) or {"macd": 0.0, "macd_signal": 0.0, "macd_hist": 0.0}
    return {
        "spot": window[-1],
        "median_move": median_move,
        "recent_move_ratio": mean_or_zero(recent) / median_move,
        "recent_peak_ratio": recent_peak_ratio,
        "directional_cluster_ratio": directional_cluster_ratio,
        "last_move_ratio": last_move / median_move,
        "slope_ratio": slope,
        "rsi": rsi,
        "srsi": srsi,
        "range": max(window) - min(window),
        **macd,
        "macd_hist_ratio": macd["macd_hist"] / median_move,
    }


def stability_metrics(prices: list[float]) -> dict[str, float] | None:
    """Summarize normalized tail risk for the optional market selector."""
    if len(prices) < 30:
        return None
    changes = [prices[index] - prices[index - 1] for index in range(1, len(prices))]
    moves = [abs(change) for change in changes]
    median_move = statistics.median(moves)
    if median_move <= 0:
        return None
    sorted_moves = sorted(moves)
    p95 = sorted_moves[min(len(sorted_moves) - 1, int(len(sorted_moves) * 0.95))]
    recent = moves[-5:]
    last_three = changes[-3:]
    return {
        "median_move": median_move,
        "p95_ratio": p95 / median_move,
        "max_ratio": max(moves) / median_move,
        "shock_rate_2x": sum(move >= median_move * 2 for move in moves) / len(moves),
        "shock_rate_3x": sum(move >= median_move * 3 for move in moves) / len(moves),
        "recent_move_ratio": mean_or_zero(recent) / median_move,
        "directional_cluster_ratio": abs(sum(last_three)) / median_move,
    }


def shock_cluster_warnings(features: dict[str, float], args: argparse.Namespace) -> list[str]:
    """Return independent short-term warnings that can combine into a veto."""
    warnings: list[str] = []
    if features.get("last_move_ratio", 0.0) >= args.shock_cluster_last_tick_ratio:
        warnings.append("last tick shock")
    if features.get("recent_move_ratio", 0.0) >= args.shock_cluster_expansion:
        warnings.append("recent expansion")
    if features.get("recent_peak_ratio", 0.0) >= args.shock_cluster_peak_ratio:
        warnings.append("recent move peak")
    if abs(features.get("slope_ratio", 0.0)) >= args.shock_cluster_slope:
        warnings.append("directional slope")
    if abs(features.get("macd_hist_ratio", 0.0)) >= args.shock_cluster_macd:
        warnings.append("MACD momentum")
    if features.get("directional_cluster_ratio", 0.0) >= args.shock_cluster_directional_ratio:
        warnings.append("directional cluster")
    return warnings


def qualifies_for_accumulator(features: dict[str, float], args: argparse.Namespace) -> tuple[bool, list[str]]:
    """Return whether the market is calm enough for the configured experiment."""
    reasons: list[str] = []
    if features["recent_move_ratio"] > args.max_expansion:
        reasons.append("recent volatility expanded")
    if features["last_move_ratio"] > args.max_tick_multiple:
        reasons.append("latest tick was a shock")
    if abs(features["slope_ratio"]) > args.max_slope:
        reasons.append("directional trend too strong")
    if not args.rsi_min <= features["rsi"] <= args.rsi_max:
        reasons.append("RSI outside stability band")
    if not args.srsi_min <= features["srsi"] <= args.srsi_max:
        reasons.append("StochRSI outside stability band")
    if args.macd_filter and abs(features["macd_hist_ratio"]) > args.max_macd_hist_ratio:
        reasons.append("MACD trend strength too high")
    if args.directional_edge_filter:
        rsi = features.get("rsi", 50.0)
        slope = features.get("slope_ratio", 0.0)
        lower_edge = 100.0 - args.directional_edge_rsi
        outward = (
            rsi >= args.directional_edge_rsi and slope >= args.directional_edge_slope
        ) or (
            rsi <= lower_edge and slope <= -args.directional_edge_slope
        )
        if outward:
            side = "upper" if rsi >= args.directional_edge_rsi else "lower"
            reasons.append(f"directional {side}-edge pressure")
    if args.directional_cluster_gate and (
        features.get("directional_cluster_ratio", 0.0)
        >= args.max_directional_cluster_ratio
    ):
        reasons.append(
            "directional cluster too strong "
            f"({features.get('directional_cluster_ratio', 0.0):.2f}x >= "
            f"{args.max_directional_cluster_ratio:.2f}x)"
        )
    if args.shock_cluster_filter:
        warnings = shock_cluster_warnings(features, args)
        rsi_edge = (
            features.get("rsi", 50.0) >= args.shock_cluster_rsi_edge
            or features.get("rsi", 50.0) <= 100.0 - args.shock_cluster_rsi_edge
        )
        if rsi_edge and len(warnings) >= args.shock_cluster_min_warnings:
            reasons.append("shock cluster: " + ", ".join(warnings))
    return not reasons, reasons


def first_number(mapping: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = as_float(mapping.get(name))
        if value is not None:
            return value
    return None


def extract_barriers(payload: dict[str, Any]) -> tuple[float | None, float | None]:
    """Handle barrier fields at the top level or in nested API payloads."""
    names_upper = ("high_barrier", "upper_barrier", "barrier_high")
    names_lower = ("low_barrier", "lower_barrier", "barrier_low")

    def walk(value: Any) -> tuple[float | None, float | None]:
        if isinstance(value, dict):
            upper = first_number(value, *names_upper)
            lower = first_number(value, *names_lower)
            if upper is not None and lower is not None:
                return upper, lower
            for child in value.values():
                found_upper, found_lower = walk(child)
                upper = upper if upper is not None else found_upper
                lower = lower if lower is not None else found_lower
                if upper is not None and lower is not None:
                    return upper, lower
            return upper, lower
        elif isinstance(value, list):
            for child in value:
                found_upper, found_lower = walk(child)
                if found_upper is not None or found_lower is not None:
                    return found_upper, found_lower
        return None, None

    return walk(payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Demo-first Deriv Accumulator Options bot")
    parser.add_argument("-s", "--symbol", default=os.environ.get("SYMBOL", "R_25"))
    parser.add_argument("--stake", type=float, default=float(os.environ.get("STAKE", "1.00")),
                        help="Initial stake; live ACCU minimum is currently $1.00")
    parser.add_argument("--growth-rate", type=float, default=float(os.environ.get("GROWTH_RATE", "0.01")),
                        help="Accumulator growth rate: 0.01, 0.02, 0.03, 0.04, or 0.05")
    parser.add_argument("--duration", type=int, default=int(os.environ.get("DURATION", "45")),
                        help="Legacy compatibility option; ACCU positions have no fixed expiry")
    parser.add_argument("--target-safe-ticks", type=int, default=int(os.environ.get("TARGET_SAFE_TICKS", "5")),
                        help="Sell after this many safe ticks if the contract is still open")
    parser.add_argument("--take-profit", type=float, default=float(os.environ.get("TAKE_PROFIT", "0.05")),
                        help="Optional Deriv take-profit amount; 0 disables the limit order")
    parser.add_argument("--account", choices=["demo", "real"], default=os.environ.get("ACCOUNT_TYPE", "demo"))
    parser.add_argument("--allow-real", action="store_true",
                        help="Required in addition to --account real; use only after demo validation")
    parser.add_argument("--live-demo", action="store_true",
                        help="Allow demo proposals and buys; without this flag the bot is paper/dry-run")
    parser.add_argument("--dry-run", action="store_true",
                        help="Force paper mode even if --live-demo is supplied")
    parser.add_argument("--lookback", type=int, default=int(os.environ.get("VOL_LOOKBACK", "20")))
    parser.add_argument("--min-history", type=int, default=int(os.environ.get("MIN_HISTORY", "60")))
    parser.add_argument("--rsi-min", type=float, default=float(os.environ.get("RSI_MIN", "40")))
    parser.add_argument("--rsi-max", type=float, default=float(os.environ.get("RSI_MAX", "60")))
    parser.add_argument("--srsi-min", type=float, default=float(os.environ.get("SRSI_MIN", "0.20")))
    parser.add_argument("--srsi-max", type=float, default=float(os.environ.get("SRSI_MAX", "0.80")))
    parser.add_argument("--macd-filter", action="store_true",
                        default=os.environ.get("USE_MACD_FILTER", "0") == "1",
                        help="Reject entries when normalized MACD histogram shows strong trend")
    parser.add_argument("--max-macd-hist-ratio", type=float,
                        default=float(os.environ.get("MAX_MACD_HIST_RATIO", "0.75")),
                        help="Maximum abs(MACD histogram / median tick move) when MACD filter is enabled")
    parser.add_argument("--max-expansion", type=float, default=float(os.environ.get("MAX_VOL_EXPANSION", "1.80")),
                        help="Maximum recent/typical absolute-move ratio")
    parser.add_argument("--max-tick-multiple", type=float, default=float(os.environ.get("MAX_TICK_MULTIPLE", "3.0")))
    parser.add_argument("--max-slope", type=float, default=float(os.environ.get("MAX_SLOPE", "1.50")))
    parser.add_argument("--min-entry-room-moves", type=float,
                        default=float(os.environ.get("MIN_ENTRY_ROOM_MOVES", "2.0")),
                        help="Skip proposals whose nearest barrier is fewer than this many median moves away")
    parser.add_argument("--early-exit-room", type=float, default=float(os.environ.get("EARLY_EXIT_ROOM", "0.30")),
                        help="Sell when the nearest live barrier is this fraction of the band width away")
    parser.add_argument("--protect-profit", type=float, default=0.0,
                        help="Deprecated compatibility option; profit protection is disabled")
    parser.add_argument("--protect-profit-room", type=float, default=0.35,
                        help=argparse.SUPPRESS)
    parser.add_argument("--shock-cluster-filter", action=argparse.BooleanOptionalAction,
                        default=os.environ.get("SHOCK_CLUSTER_FILTER", "1") != "0",
                        help="Reject entries only when multiple short-term shock warnings agree")
    parser.add_argument("--shock-cluster-min-warnings", type=int,
                        default=int(os.environ.get("SHOCK_CLUSTER_MIN_WARNINGS", "2")),
                        help="Warnings required before the shock-cluster filter rejects an entry")
    parser.add_argument("--shock-cluster-last-tick-ratio", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_LAST_TICK_RATIO", "1.45")),
                        help="Last tick / median move warning threshold")
    parser.add_argument("--shock-cluster-expansion", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_EXPANSION", "1.50")),
                        help="Recent expansion warning threshold")
    parser.add_argument("--shock-cluster-peak-ratio", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_PEAK_RATIO", "2.50")),
                        help="Recent peak-move warning threshold")
    parser.add_argument("--shock-cluster-slope", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_SLOPE", "0.20")),
                        help="Absolute normalized slope warning threshold")
    parser.add_argument("--shock-cluster-macd", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_MACD", "0.50")),
                        help="Absolute normalized MACD histogram warning threshold")
    parser.add_argument("--shock-cluster-directional-ratio", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_DIRECTIONAL_RATIO", "2.50")),
                        help="Last-three-tick directional-cluster warning threshold")
    parser.add_argument("--shock-cluster-rsi-edge", type=float,
                        default=float(os.environ.get("SHOCK_CLUSTER_RSI_EDGE", "55")),
                        help="RSI edge context required for a multi-warning veto; mirrored below 45 by default")
    parser.add_argument("--directional-edge-filter", action=argparse.BooleanOptionalAction,
                        default=os.environ.get("DIRECTIONAL_EDGE_FILTER", "1") != "0",
                        help="Skip RSI-edge entries when slope points outward from the stable band")
    parser.add_argument("--directional-edge-rsi", type=float,
                        default=float(os.environ.get("DIRECTIONAL_EDGE_RSI", "55")),
                        help="RSI edge for the mirrored directional-pressure veto")
    parser.add_argument("--directional-edge-slope", type=float,
                        default=float(os.environ.get("DIRECTIONAL_EDGE_SLOPE", "0.30")),
                        help="Minimum outward normalized slope for the edge veto")
    parser.add_argument("--directional-cluster-gate", action=argparse.BooleanOptionalAction,
                        default=os.environ.get("DIRECTIONAL_CLUSTER_GATE", "1") != "0",
                        help="Reject entries with an unusually strong last-three-tick directional cluster")
    parser.add_argument("--max-directional-cluster-ratio", type=float,
                        default=float(os.environ.get("MAX_DIRECTIONAL_CLUSTER_RATIO", "2.50")),
                        help="Maximum last-three-tick directional cluster ratio before the gate rejects an entry")
    parser.add_argument("--stable-market-scan", action=argparse.BooleanOptionalAction,
                        default=os.environ.get("STABLE_MARKET_SCAN", "0") == "1",
                        help="Opt in to periodic multi-market stability ranking and flat-position switching")
    parser.add_argument("--scan-symbols", default=os.environ.get(
                        "SCAN_SYMBOLS", "R_10,R_25,R_50,R_75,R_100"),
                        help="Comma-separated symbols considered by the optional stability scanner")
    parser.add_argument("--scan-ticks", type=int,
                        default=int(os.environ.get("SCAN_TICKS", "500")),
                        help="Historical ticks sampled per market during a stability scan")
    parser.add_argument("--scan-interval", type=int,
                        default=int(os.environ.get("SCAN_INTERVAL", "900")),
                        help="Seconds between optional stability scans")
    parser.add_argument("--cooldown", type=int, default=int(os.environ.get("COOLDOWN_SECONDS", "60")))
    parser.add_argument("--max-knockouts", type=int, default=int(os.environ.get("MAX_KNOCKOUTS", "2")))
    parser.add_argument("--max-session-loss", type=float, default=float(os.environ.get("MAX_SESSION_LOSS", "0.70")))
    parser.add_argument("--paper-band-pct", type=float, default=float(os.environ.get("PAPER_BAND_PCT", "0.0065")),
                        help="Approximate band in percent for dry-run only; live mode uses Deriv barriers")
    parser.add_argument("--record", metavar="FILE", help="Override the per-market JSON log path")
    parser.add_argument("--history", action="store_true", help="Print the selected log and exit")
    parser.add_argument("--speed", type=float, default=1.0, help="Reserved for future tick replay support")
    return parser.parse_args()


class LogBook:
    def __init__(self, path: Path, symbol: str, args: argparse.Namespace):
        self.path = path
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self.data = {}
        else:
            self.data = {}
        self.data.setdefault("version", 1)
        self.data.setdefault("bot", "accumulator")
        self.data.setdefault("symbol", symbol)
        self.data.setdefault("trades", [])
        self.data.setdefault("signals", [])
        self.data.setdefault("filter_events", [])
        self.data.setdefault("sessions", [])
        self.data.setdefault("config_history", [])
        self.data["config_history"].append({
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "growth_rate": args.growth_rate,
            "duration": args.duration,
            "target_safe_ticks": args.target_safe_ticks,
            "stake": args.stake,
            "macd_filter": args.macd_filter,
            "max_macd_hist_ratio": args.max_macd_hist_ratio,
            "min_entry_room_moves": args.min_entry_room_moves,
            "early_exit_room": args.early_exit_room,
            "shock_cluster_filter": args.shock_cluster_filter,
            "shock_cluster_min_warnings": args.shock_cluster_min_warnings,
            "shock_cluster_last_tick_ratio": args.shock_cluster_last_tick_ratio,
            "shock_cluster_expansion": args.shock_cluster_expansion,
            "shock_cluster_peak_ratio": args.shock_cluster_peak_ratio,
            "shock_cluster_slope": args.shock_cluster_slope,
            "shock_cluster_macd": args.shock_cluster_macd,
            "shock_cluster_directional_ratio": args.shock_cluster_directional_ratio,
            "shock_cluster_rsi_edge": args.shock_cluster_rsi_edge,
            "directional_edge_filter": args.directional_edge_filter,
            "directional_edge_rsi": args.directional_edge_rsi,
            "directional_edge_slope": args.directional_edge_slope,
            "directional_cluster_gate": args.directional_cluster_gate,
            "max_directional_cluster_ratio": args.max_directional_cluster_ratio,
            "stable_market_scan": args.stable_market_scan,
            "scan_symbols": args.scan_symbols,
            "scan_ticks": args.scan_ticks,
            "scan_interval": args.scan_interval,
            "mode": "live-demo" if args.live_demo and not args.dry_run else "dry-run",
        })
        self.save()

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")

    def signal(self, record: dict[str, Any]) -> None:
        self.data["signals"].append(record)
        self.data["signals"] = self.data["signals"][-500:]
        self.save()

    def filter_event(self, record: dict[str, Any]) -> None:
        self.data["filter_events"].append(record)
        self.data["filter_events"] = self.data["filter_events"][-500:]
        self.save()

    def trade(self, record: dict[str, Any]) -> None:
        key = record.get("contract_id") or record.get("entry_epoch")
        for index, existing in enumerate(self.data["trades"]):
            existing_key = existing.get("contract_id") or existing.get("entry_epoch")
            if key is not None and existing_key == key:
                self.data["trades"][index] = record
                self.save()
                return
        self.data["trades"].append(record)
        self.save()

    def session(self, record: dict[str, Any]) -> None:
        self.data["sessions"].append(record)
        self.save()


class AccumulatorBot:
    def __init__(self, args: argparse.Namespace):
        if args.growth_rate not in (0.01, 0.02, 0.03, 0.04, 0.05):
            raise ValueError("--growth-rate must be one of 0.01, 0.02, 0.03, 0.04, or 0.05")
        if args.stake <= 0 or args.duration <= 0:
            raise ValueError("stake and duration must be positive")
        if args.live_demo and not args.dry_run and args.stake < 1.0:
            raise ValueError("Live ACCU trading requires --stake 1.00 or higher; "
                             "Deriv rejected the $0.35 buy")
        if args.account == "real" and not args.allow_real:
            raise ValueError("Real account blocked. Add --allow-real only after demo validation.")
        self.args = args
        self.symbol = args.symbol
        self.scan_symbols = [
            symbol.strip().upper()
            for symbol in args.scan_symbols.split(",")
            if symbol.strip()
        ]
        if self.symbol not in self.scan_symbols:
            self.scan_symbols.insert(0, self.symbol)
        self.quotes: deque[float] = deque(maxlen=500)
        self.epochs: deque[float] = deque(maxlen=500)
        self.pending: dict[str, Any] | None = None
        self.active: dict[str, Any] | None = None
        self.sell_sent = False
        self.last_entry_at = 0.0
        self.cooldown_until = 0.0
        self.accu_contract: dict[str, Any] | None = None
        self.tick_subscription_id: str | None = None
        self.portfolio_received = False
        self.knockouts = 0
        self.session_pnl = 0.0
        self.session_start = time.time()
        self.request_id = 1000
        self.logbook = LogBook(self.log_path_for_symbol(self.symbol), self.symbol, args)

    def log_path_for_symbol(self, symbol: str) -> Path:
        """Keep scanner output separated by market unless explicitly single-market."""
        if not self.args.record:
            return Path(f"trade_log_accu_{symbol}.json")
        if not self.args.stable_market_scan or len(self.scan_symbols) <= 1:
            return Path(self.args.record)
        custom = Path(self.args.record)
        return custom.with_name(f"{custom.stem}_{symbol}{custom.suffix}")

    @property
    def trading_enabled(self) -> bool:
        return self.args.live_demo and not self.args.dry_run

    def next_req_id(self) -> int:
        self.request_id += 1
        return self.request_id

    def print_header(self) -> None:
        mode = "LIVE DEMO" if self.trading_enabled and self.args.account == "demo" else "PAPER / DRY-RUN"
        if self.args.account == "real":
            mode = "REAL UNLOCKED"
        print()
        print(f"{CYN}{BLD}DERIV ACCUMULATOR BOT{RST}  {DIM}stability strategy{RST}")
        print(f"Symbol: {BLD}{self.symbol}{RST}   Mode: {YLW}{mode}{RST}")
        print(f"Stake: ${self.args.stake:.2f}   Growth: {self.args.growth_rate:.0%}   "
              f"Position: open-ended ACCU")
        if self.args.duration != 45:
            print(f"{DIM}Legacy --duration={self.args.duration} retained for command compatibility; "
                  f"it is not sent to Deriv for ACCU{RST}")
        print(f"Target: {self.args.target_safe_ticks} safe ticks   Take profit: ${self.args.take_profit:.2f}")
        print(f"Filters: RSI {self.args.rsi_min:.0f}-{self.args.rsi_max:.0f}, "
              f"SRSI {self.args.srsi_min:.2f}-{self.args.srsi_max:.2f}, "
              f"max expansion {self.args.max_expansion:.1f}x")
        print(f"Risk guard: entry room >= {self.args.min_entry_room_moves:.1f} median moves, "
              f"early exit room {self.args.early_exit_room:.0%}, "
              f"shock cluster={'on' if self.args.shock_cluster_filter else 'off'}, "
              f"directional edge={'on' if self.args.directional_edge_filter else 'off'}")
        if self.args.shock_cluster_filter:
            print(f"Shock warnings: {self.args.shock_cluster_min_warnings} of 6 required "
                  f"(tick>={self.args.shock_cluster_last_tick_ratio:.2f}x, "
                  f"expansion>={self.args.shock_cluster_expansion:.2f}x, "
                  f"MACD>={self.args.shock_cluster_macd:.2f}) "
                  f"at RSI edge >= {self.args.shock_cluster_rsi_edge:.0f} "
                  f"or <= {100 - self.args.shock_cluster_rsi_edge:.0f}")
        if self.args.directional_edge_filter:
            print(f"Directional edge: RSI >= {self.args.directional_edge_rsi:.0f} "
                  f"or <= {100 - self.args.directional_edge_rsi:.0f}, "
                  f"outward slope >= {self.args.directional_edge_slope:.2f}")
        print(f"Directional cluster gate: "
              f"{'on' if self.args.directional_cluster_gate else 'off'} "
              f"(max {self.args.max_directional_cluster_ratio:.2f}x)")
        if self.args.macd_filter:
            print(f"MACD filter: abs(histogram / median move) <= "
                  f"{self.args.max_macd_hist_ratio:.2f}")
        print(f"Stable-market scan: "
              f"{'on' if self.args.stable_market_scan else 'off'}")
        if self.args.stable_market_scan:
            print(f"Scan universe: {','.join(self.scan_symbols)} | "
                  f"history={self.args.scan_ticks} ticks | "
                  f"interval={self.args.scan_interval}s | "
                  f"switching only while flat")
        print(f"Log: {self.logbook.path}")
        print(f"{DIM}{'-' * 72}{RST}")

    def print_history(self) -> None:
        print(json.dumps(self.logbook.data, indent=2))

    async def fetch_scan_metrics(self) -> list[dict[str, Any]]:
        """Fetch public tick history without competing with the trading socket."""
        app_id = os.environ.get("DERIV_SCAN_APP_ID", "1089")
        url = f"wss://ws.derivws.com/websockets/v3?app_id={app_id}"
        results: list[dict[str, Any]] = []
        async with websockets.connect(url, ping_interval=None, ping_timeout=None) as scan_ws:
            for symbol in self.scan_symbols:
                req_id = self.next_req_id()
                await scan_ws.send(json.dumps({
                    "ticks_history": symbol,
                    "count": self.args.scan_ticks,
                    "end": "latest",
                    "style": "ticks",
                    "req_id": req_id,
                }))
                response = json.loads(await asyncio.wait_for(scan_ws.recv(), timeout=15))
                if response.get("error"):
                    print(f"{DIM}[SCAN] {symbol} unavailable: "
                          f"{response['error'].get('message', response['error'])}{RST}")
                    continue
                history = response.get("history") or {}
                prices = [as_float(price) for price in history.get("prices", [])]
                prices = [price for price in prices if price is not None]
                metrics = stability_metrics(prices)
                if metrics is None:
                    print(f"{DIM}[SCAN] {symbol} skipped: insufficient usable history{RST}")
                    continue
                # Lower is better. The score emphasizes 3x shocks, then the
                # broad tail and the most recent movement regime.
                metrics["stability_score"] = (
                    metrics["shock_rate_3x"] * 100.0
                    + metrics["p95_ratio"]
                    + metrics["recent_move_ratio"]
                    + metrics["directional_cluster_ratio"] * 0.25
                )
                results.append({"symbol": symbol, **metrics})
        return sorted(results, key=lambda item: item["stability_score"])

    async def switch_market(self, ws, symbol: str) -> None:
        """Switch only when no proposal or ACCU position is active."""
        if symbol == self.symbol or self.active or self.pending:
            return
        previous = self.symbol
        if self.tick_subscription_id:
            await ws.send(json.dumps({
                "forget": self.tick_subscription_id,
                "req_id": self.next_req_id(),
            }))
        self.logbook.data.setdefault("market_switches", []).append({
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "from": previous,
            "to": symbol,
            "reason": "stable_market_scan",
        })
        self.logbook.save()
        self.symbol = symbol
        self.quotes.clear()
        self.epochs.clear()
        self.pending = None
        self.accu_contract = None
        self.tick_subscription_id = None
        self.cooldown_until = time.time() + 2
        self.logbook = LogBook(self.log_path_for_symbol(symbol), symbol, self.args)
        await ws.send(json.dumps({
            "contracts_for": symbol,
            "req_id": self.next_req_id(),
        }))
        await ws.send(json.dumps({
            "ticks": symbol,
            "subscribe": 1,
            "req_id": self.next_req_id(),
        }))
        print(f"{CYN}[SCAN] switched market {previous} -> {symbol}; "
              f"rebuilding {self.args.min_history}-tick signal history{RST}")

    async def market_scan_loop(self, ws) -> None:
        """Periodically rank markets and switch only while the bot is flat."""
        # Allow the initial portfolio response to recover any already-open
        # contract before the scanner is allowed to consider switching.
        for _ in range(30):
            if self.portfolio_received:
                break
            await asyncio.sleep(0.5)
        while True:
            try:
                ranked = await self.fetch_scan_metrics()
                if ranked:
                    print(f"{CYN}[SCAN] stability ranking: "
                          + " | ".join(
                              f"{item['symbol']} score={item['stability_score']:.2f} "
                              f"3x={item['shock_rate_3x']:.1%} "
                              f"recent={item['recent_move_ratio']:.2f}x"
                              for item in ranked
                          ) + RST)
                    self.logbook.data.setdefault("market_scan_history", []).append({
                        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "current_symbol": self.symbol,
                        "ranked": ranked,
                    })
                    self.logbook.data["market_scan_history"] = (
                        self.logbook.data["market_scan_history"][-100:]
                    )
                    self.logbook.save()
                    best = ranked[0]["symbol"]
                    if self.active or self.pending:
                        if best != self.symbol:
                            print(f"{YLW}[SCAN] best market is {best}, "
                                  f"but {self.symbol} remains active until flat{RST}")
                    else:
                        await self.switch_market(ws, best)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                print(f"{DIM}[SCAN] unavailable: {error}{RST}")
            await asyncio.sleep(max(30, self.args.scan_interval))

    def should_trade(self) -> bool:
        now = time.time()
        if self.active or self.pending or now < self.cooldown_until:
            return False
        if self.knockouts >= self.args.max_knockouts:
            return False
        if self.args.max_session_loss > 0 and self.session_pnl <= -self.args.max_session_loss:
            return False
        return True

    def note_signal(self, features: dict[str, float]) -> None:
        self.logbook.signal({
            "at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "epoch": time.time(),
            "symbol": self.symbol,
            "spot": features["spot"],
            "features": features,
            "growth_rate": self.args.growth_rate,
            "duration": None,
            "target_safe_ticks": self.args.target_safe_ticks,
            "mode": "live-demo" if self.trading_enabled else "dry-run",
        })

    def start_paper_trade(self, features: dict[str, float]) -> None:
        entry = features["spot"]
        self.active = {
            "mode": "paper",
            "symbol": self.symbol,
            "entry_epoch": time.time(),
            "entry_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "entry_spot": entry,
            "last_spot": entry,
            "growth_rate": self.args.growth_rate,
            "stake": self.args.stake,
            "safe_ticks": 0,
            "elapsed_ticks": 0,
            "observations": [],
        }
        self.logbook.trade(self.active)
        print(f"{GRN}[PAPER] ACCU candidate opened at {entry:.5f}; "
              f"estimated band ±{self.args.paper_band_pct:.5f}%{RST}")

    def process_paper_tick(self, quote: float) -> None:
        if not self.active or self.active.get("mode") != "paper":
            return
        previous = self.active["last_spot"]
        move_pct = abs(quote - previous) / max(abs(previous), 1e-12) * 100
        self.active["last_spot"] = quote
        self.active["observations"].append({
            "epoch": time.time(),
            "spot": quote,
            "move_pct": move_pct,
        })
        band = self.args.paper_band_pct
        if move_pct >= band:
            self.finish_paper("knockout_proxy", -self.args.stake, quote)
            return
        self.active["safe_ticks"] += 1
        value = self.args.stake * ((1 + self.args.growth_rate) ** self.active["safe_ticks"])
        profit = value - self.args.stake
        if self.active["safe_ticks"] >= self.args.target_safe_ticks or (
            self.args.take_profit > 0 and profit >= self.args.take_profit
        ):
            self.finish_paper("take_profit_proxy", profit, quote)

    def finish_paper(self, reason: str, profit: float, quote: float) -> None:
        if not self.active:
            return
        self.active.update({
            "status": "won" if profit > 0 else "lost",
            "exit_reason": reason,
            "exit_spot": quote,
            "profit": round(profit, 8),
            "settled_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "settled_epoch": time.time(),
        })
        self.session_pnl += profit
        if reason == "knockout_proxy":
            self.knockouts += 1
        self.logbook.trade(self.active)
        color = GRN if profit >= 0 else RED
        print(f"{color}[PAPER SETTLED] {reason} | safe={self.active['safe_ticks']} "
              f"| PnL={profit:+.4f}{RST}")
        self.active = None
        self.cooldown_until = time.time() + self.args.cooldown

    async def request_proposal(self, ws, features: dict[str, float]) -> None:
        self.pending = {
            "requested_at": time.time(),
            "signal_quote": features["spot"],
            "features": features,
            "req_id": self.next_req_id(),
            "buy_sent": False,
        }
        request: dict[str, Any] = {
            "proposal": 1,
            "req_id": self.pending["req_id"],
            "amount": self.args.stake,
            "basis": "stake",
            "contract_type": "ACCU",
            "currency": "USD",
            "underlying_symbol": self.symbol,
            "growth_rate": self.args.growth_rate,
        }
        if self.args.take_profit > 0:
            request["limit_order"] = {"take_profit": self.args.take_profit}
        await ws.send(json.dumps(request))
        print(f"{DIM}[PROPOSAL] ACCU {self.args.growth_rate:.0%} requested at "
              f"{features['spot']:.5f} (open-ended){RST}")

    def proposal_is_fresh(self, proposal: dict[str, Any]) -> bool:
        if not self.pending:
            return False
        age = time.time() - self.pending["requested_at"]
        if age > PROPOSAL_MAX_AGE:
            return False
        signal_quote = self.pending["signal_quote"]
        current = self.quotes[-1] if self.quotes else signal_quote
        median_move = self.pending["features"].get("median_move", 0.0)
        if median_move and abs(current - signal_quote) > median_move * self.args.max_tick_multiple:
            return False
        return bool(proposal.get("id"))

    def proposal_room_in_moves(self, proposal: dict[str, Any]) -> float | None:
        """Return nearest proposal-barrier distance in typical tick moves."""
        upper, lower = extract_barriers(proposal)
        entry = first_number(proposal, "spot") or (self.pending or {}).get("signal_quote")
        median_move = (self.pending or {}).get("features", {}).get("median_move", 0.0)
        if upper is None or lower is None or entry is None or median_move <= 0 or upper <= lower:
            return None
        distances = [upper - entry, entry - lower]
        positive = [distance for distance in distances if distance > 0]
        return min(positive) / median_move if positive else 0.0

    async def handle_tick(self, ws, tick: dict[str, Any]) -> None:
        tick_symbol = tick.get("symbol") or tick.get("underlying_symbol")
        if tick_symbol and tick_symbol != self.symbol:
            return
        quote = as_float(tick.get("quote"))
        if quote is None:
            return
        self.quotes.append(quote)
        self.epochs.append(as_float(tick.get("epoch"), time.time()) or time.time())
        if self.active and self.active.get("mode") == "paper":
            self.process_paper_tick(quote)
            # Do not open a second paper candidate on the same tick that
            # settled the previous one.
            return
        if self.active:
            # ACCU's tick_count is not the number of ticks elapsed since this
            # bot bought the contract (it may be a contract-side limit such as
            # 250). Count the live tick stream locally for exit timing.
            self.active["elapsed_ticks"] = self.active.get("elapsed_ticks", 0) + 1
            return
        if not self.should_trade() or len(self.quotes) < self.args.min_history:
            return
        features = market_features(list(self.quotes), self.args.lookback)
        if features is None:
            return
        qualifies, reasons = qualifies_for_accumulator(features, self.args)
        if not qualifies:
            filter_name = None
            if any(reason.startswith("shock cluster:") for reason in reasons):
                filter_name = "shock_cluster"
            elif any(reason.startswith("directional ") and reason.endswith("-edge pressure")
                     for reason in reasons):
                filter_name = "directional_edge"
            elif any(reason.startswith("directional cluster too strong")
                     for reason in reasons):
                filter_name = "directional_cluster"
            if filter_name:
                self.logbook.filter_event({
                    "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "epoch": time.time(),
                    "symbol": self.symbol,
                    "spot": quote,
                    "filter": filter_name,
                    "reasons": reasons,
                    "features": features,
                })
            return
        self.note_signal(features)
        print(f"{CYN}[SIGNAL] {self.symbol} stable | spot={quote:.5f} "
              f"RSI={features['rsi']:.1f} SRSI={features['srsi']:.2f} "
              f"slope={features['slope_ratio']:+.2f}{RST}")
        if not self.trading_enabled:
            self.start_paper_trade(features)
        else:
            await self.request_proposal(ws, features)

    async def handle_proposal(self, ws, proposal: dict[str, Any]) -> None:
        if not self.pending or self.pending.get("buy_sent"):
            return
        if not proposal.get("id"):
            print(f"{RED}[PROPOSAL ERROR] no proposal id returned{RST}")
            self.pending = None
            return
        if not self.proposal_is_fresh(proposal):
            print(f"{YLW}[SKIP] proposal was stale or price moved too far{RST}")
            self.pending = None
            self.cooldown_until = time.time() + 2
            return
        ask_price = as_float(proposal.get("ask_price"))
        if ask_price is None:
            print(f"{RED}[SKIP] proposal has no ask_price{RST}")
            self.pending = None
            return
        upper, lower = extract_barriers(proposal)
        self.pending["proposal"] = proposal
        self.pending["upper_barrier"] = upper
        self.pending["lower_barrier"] = lower
        self.pending["entry_spot"] = first_number(proposal, "spot") or self.pending["signal_quote"]
        self.pending["proposal_at"] = time.time()
        entry_room_moves = self.proposal_room_in_moves(proposal)
        self.pending["entry_room_moves"] = entry_room_moves
        if (entry_room_moves is not None and
                entry_room_moves < self.args.min_entry_room_moves):
            print(f"{YLW}[SKIP] proposal barrier too close | room="
                  f"{entry_room_moves:.2f} median moves; "
                  f"minimum={self.args.min_entry_room_moves:.2f}{RST}")
            self.pending = None
            self.cooldown_until = time.time() + 2
            return
        room_text = f" room={entry_room_moves:.2f} moves" if entry_room_moves is not None else ""
        print(f"{GRN}[PROPOSAL] id={proposal['id']} ask=${ask_price:.4f} "
              f"spot={self.pending['entry_spot']:.5f} "
              f"barriers=({lower if lower is not None else '?'}, "
              f"{upper if upper is not None else '?'}){room_text}{RST}")
        # ACCU proposals are requested as one-shot quotes. Mark the buy before
        # sending it so a duplicate response cannot submit a second buy.
        self.pending["buy_sent"] = True
        await ws.send(json.dumps({
            "buy": proposal["id"],
            "price": self.args.stake,
            "req_id": self.next_req_id(),
        }))

    async def handle_buy(self, buy: dict[str, Any]) -> None:
        if not self.pending:
            return
        contract_id = buy.get("contract_id")
        if not contract_id:
            print(f"{RED}[BUY ERROR] Deriv did not return a contract id{RST}")
            self.pending = None
            return
        self.active = {
            "mode": "live-demo" if self.args.account == "demo" else "live-real",
            "symbol": self.symbol,
            "contract_id": contract_id,
            "entry_epoch": time.time(),
            "entry_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "entry_spot": self.pending.get("entry_spot"),
            "stake": self.args.stake,
            "growth_rate": self.args.growth_rate,
            "duration": None,
            "proposal_id": self.pending.get("proposal", {}).get("id"),
            "proposal_snapshot": self.pending.get("proposal"),
            "signal_features": self.pending.get("features"),
            "upper_barrier": self.pending.get("upper_barrier"),
            "lower_barrier": self.pending.get("lower_barrier"),
            "proposal_barriers_available": (
                self.pending.get("upper_barrier") is not None and
                self.pending.get("lower_barrier") is not None
            ),
            "proposal_room_moves": self.pending.get("entry_room_moves"),
            "buy_price": as_float(buy.get("buy_price"), self.args.stake),
            "observations": [],
            "last_barrier_room": None,
            "room_decline_count": 0,
        }
        self.logbook.trade(self.active)
        self.pending = None
        self.sell_sent = False
        self.last_entry_at = time.time()
        print(f"{GRN}[BOUGHT] ACCU contract={contract_id} entry={self.active['entry_spot']} "
              f"growth={self.args.growth_rate:.0%}{RST}")

    async def recover_portfolio_contract(self, ws, contract: dict[str, Any]) -> None:
        """Resume monitoring an already-open ACCU position after a restart."""
        contract_id = contract.get("contract_id")
        if not contract_id or self.active:
            return
        self.active = {
            "mode": "recovered-live-demo" if self.args.account == "demo" else "recovered-live-real",
            "symbol": self.symbol,
            "contract_id": contract_id,
            "entry_epoch": as_float(contract.get("date_start"), time.time()) or time.time(),
            "entry_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "entry_spot": first_number(contract, "entry_spot", "spot"),
            "stake": as_float(contract.get("buy_price"), self.args.stake),
            "growth_rate": self.args.growth_rate,
            "duration": None,
            "proposal_id": None,
            "upper_barrier": None,
            "lower_barrier": None,
            "buy_price": as_float(contract.get("buy_price"), self.args.stake),
            "elapsed_ticks": 0,
            "observations": [],
            "last_barrier_room": None,
            "room_decline_count": 0,
            "recovered": True,
        }
        self.logbook.trade(self.active)
        print(f"{YLW}[RECOVERED] existing ACCU contract={contract_id}; "
              f"monitoring it instead of opening another{RST}")
        await ws.send(json.dumps({
            "proposal_open_contract": 1,
            "contract_id": contract_id,
            "subscribe": 1,
            "req_id": self.next_req_id(),
        }))

    def barrier_room(self, poc: dict[str, Any], spot: float | None) -> float | None:
        upper, lower = extract_barriers(poc)
        if upper is None or lower is None or spot is None or upper <= lower:
            return None
        width = upper - lower
        return min(abs(upper - spot), abs(spot - lower)) / width

    async def handle_open_contract(self, ws, poc: dict[str, Any]) -> None:
        if not self.active or self.active.get("contract_id") != poc.get("contract_id"):
            return
        spot = first_number(poc, "current_spot", "spot")
        upper, lower = extract_barriers(poc)
        deriv_tick_count = first_number(poc, "tick_count", "current_tick")
        safe_ticks = self.active.get("elapsed_ticks", 0)
        valid_to_sell = as_bool(poc.get("is_valid_to_sell"))
        if "first_open_contract_payload" not in self.active:
            self.active["first_open_contract_payload"] = poc
        room = self.barrier_room(poc, spot)
        previous_room = self.active.get("last_barrier_room")
        if room is not None and previous_room is not None and room < previous_room:
            self.active["room_decline_count"] = self.active.get("room_decline_count", 0) + 1
        elif room is not None:
            self.active["room_decline_count"] = 0
        if room is not None:
            self.active["last_barrier_room"] = room
        observation = {
            "epoch": time.time(),
            "spot": spot,
            "safe_ticks": int(safe_ticks),
            "elapsed_ticks": int(safe_ticks),
            "deriv_tick_count": int(deriv_tick_count) if deriv_tick_count is not None else None,
            "profit": as_float(poc.get("profit")),
            "bid_price": as_float(poc.get("bid_price")),
            "upper_barrier": upper,
            "lower_barrier": lower,
            "barrier_room": room,
            "room_decline_count": self.active.get("room_decline_count", 0),
            "is_valid_to_sell": valid_to_sell,
            "status": poc.get("status"),
            "is_sold": poc.get("is_sold"),
        }
        self.active["observations"].append(observation)
        self.active["last_update"] = observation
        self.active["safe_ticks"] = observation["safe_ticks"]
        self.logbook.trade(self.active)

        is_sold = bool(poc.get("is_sold"))
        status = str(poc.get("status", "")).lower()
        terminal = is_sold or status in {"won", "lost", "expired", "sold", "closed"}
        if terminal:
            await self.settle_live(ws, poc)
            return

        room = observation["barrier_room"]
        target_reached = safe_ticks >= self.args.target_safe_ticks
        danger_reached = room is not None and room <= self.args.early_exit_room
        if not self.sell_sent and valid_to_sell and (target_reached or danger_reached):
            self.sell_sent = True
            reason = "target_safe_ticks" if target_reached else "barrier_room"
            self.active["exit_request_reason"] = reason
            print(f"{YLW}[SELL] {reason} | elapsed={safe_ticks} "
                  f"deriv_tick_count={deriv_tick_count if deriv_tick_count is not None else '?'} "
                  f"room={room if room is not None else '?'} "
                  f"profit={observation['profit'] or 0.0:+.4f}{RST}")
            await ws.send(json.dumps({
                "sell": self.active["contract_id"],
                "price": 0,
                "req_id": self.next_req_id(),
            }))

    async def settle_live(self, ws, poc: dict[str, Any]) -> None:
        if not self.active:
            return
        profit = as_float(poc.get("profit"), 0.0) or 0.0
        status = str(poc.get("status", "")).lower()
        was_knockout = profit < 0 and status in {"lost", "expired", "closed"}
        exit_request_reason = self.active.get("exit_request_reason")
        if was_knockout and exit_request_reason:
            reason = f"knockout_after_{exit_request_reason}"
        elif was_knockout:
            reason = "knockout"
        else:
            reason = exit_request_reason if self.sell_sent else status or "settled"
        self.active.update({
            "status": "won" if profit > 0 else "lost" if profit < 0 else "closed",
            "exit_reason": reason,
            "exit_spot": first_number(poc, "current_spot", "exit_tick", "spot"),
            "profit": profit,
            "payout": as_float(poc.get("payout")),
            "settled_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "settled_epoch": time.time(),
        })
        self.session_pnl += profit
        if was_knockout:
            self.knockouts += 1
        self.logbook.trade(self.active)
        color = GRN if profit >= 0 else RED
        print(f"{color}[SETTLED] {reason} | safe={self.active.get('safe_ticks')} "
              f"| PnL={profit:+.4f}{RST}")
        subscription_id = self.active.get("poc_subscription_id")
        if subscription_id:
            await ws.send(json.dumps({"forget": subscription_id, "req_id": self.next_req_id()}))
        self.active = None
        self.sell_sent = False
        self.cooldown_until = time.time() + self.args.cooldown

    async def handle_message(self, ws, data: dict[str, Any]) -> None:
        if data.get("error"):
            error = data.get("error", {})
            code = error.get("code", "?")
            message = error.get("message", error)
            req_id = data.get("req_id")
            request_context = f" req_id={req_id}" if req_id is not None else ""
            if str(code).lower() == "contractnotfound" and self.sell_sent:
                print(f"{DIM}[INFO] sell response arrived after the contract had "
                      f"already closed; awaiting final status{RST}")
                return
            print(f"{RED}[API ERROR] {code}{request_context}: {message}{RST}")
            if self.pending:
                self.pending = None
            if str(code).lower() == "invalidexpiry":
                # Do not fire the same invalid proposal on every tick while
                # the connection is still returning an API-side rejection.
                self.cooldown_until = time.time() + 30
                print(f"{YLW}[PAUSE] ACCU expiry rejected; pausing proposals for 30s "
                      f"and refreshing market metadata{RST}")
                try:
                    await self.request_contracts_for(ws)
                except Exception as refresh_error:
                    print(f"{DIM}[MARKET] duration refresh unavailable: {refresh_error}{RST}")
            elif "buyvalidation" in str(code).lower():
                self.cooldown_until = time.time() + 30
                print(f"{YLW}[PAUSE] buy validation failed; pausing proposals for 30s{RST}")
            elif "openpositionlimit" in str(code).lower():
                self.cooldown_until = time.time() + 60
                print(f"{YLW}[PAUSE] an ACCU position is already open; "
                      f"pausing proposals for 60s{RST}")
            elif str(code).lower() == "invalidtosell":
                # Deriv can reject a sell during the entry tick. Do not leave
                # the contract marked as sell-requested, otherwise a later
                # knockout would be misreported as an intentional exit.
                self.sell_sent = False
                if self.active:
                    self.active.pop("exit_request_reason", None)
                print(f"{YLW}[WAIT] sell rejected before the next tick; "
                      f"waiting for a valid settlement update{RST}")
            return
        msg_type = data.get("msg_type")
        if msg_type == "tick":
            subscription = data.get("subscription")
            if isinstance(subscription, dict):
                self.tick_subscription_id = subscription.get("id")
            elif subscription:
                self.tick_subscription_id = str(subscription)
            await self.handle_tick(ws, data.get("tick", {}))
        elif msg_type == "proposal":
            await self.handle_proposal(ws, data.get("proposal", {}))
        elif msg_type == "buy":
            await self.handle_buy(data.get("buy", {}))
            if self.active:
                await ws.send(json.dumps({
                    "proposal_open_contract": 1,
                    "contract_id": self.active["contract_id"],
                    "subscribe": 1,
                    "req_id": self.next_req_id(),
                }))
        elif msg_type == "proposal_open_contract":
            poc = data.get("proposal_open_contract", {})
            if self.active and data.get("subscription"):
                subscription = data.get("subscription")
                self.active["poc_subscription_id"] = (
                    subscription.get("id") if isinstance(subscription, dict) else subscription
                )
            await self.handle_open_contract(ws, poc)
        elif msg_type == "portfolio":
            self.portfolio_received = True
            portfolio = data.get("portfolio") or {}
            contracts = portfolio.get("contracts") or []
            for contract in contracts:
                contract_type = str(contract.get("contract_type", "")).upper()
                symbol = contract.get("underlying_symbol") or contract.get("symbol")
                if contract_type == "ACCU" and symbol == self.symbol:
                    await self.recover_portfolio_contract(ws, contract)
                    break
        elif msg_type == "balance":
            balance = as_float((data.get("balance") or {}).get("balance"))
            if balance is not None:
                print(f"{DIM}[BALANCE] ${balance:.2f}{RST}")
        elif msg_type == "ping":
            return

    async def get_ws_url_via_bridge(self) -> str:
        url = f"{os.environ.get('DTRADER_BRIDGE_URL', 'http://localhost:3000')}/api/deriv/bot-session?type={self.args.account}"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=15) as response:
                data = await response.json()
                if response.status != 200:
                    raise RuntimeError(f"bridge error: {data}")
                return data["url"]

    async def get_ws_url_via_pat(self) -> str:
        pat = os.environ.get("PAT_TOKEN", "")
        app_id = os.environ.get("DERIV_APP_ID", "")
        if not pat or not app_id:
            raise RuntimeError("PAT_TOKEN and DERIV_APP_ID are required when USE_BRIDGE=0")
        headers = {"Authorization": f"Bearer {pat}", "Deriv-App-ID": app_id, "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{REST_BASE_URL}/trading/v1/options/accounts", headers=headers, timeout=15) as response:
                data = await response.json()
                if response.status != 200:
                    raise RuntimeError(f"account lookup failed: {data}")
        accounts = data.get("data", []) if isinstance(data, dict) else []
        if isinstance(accounts, dict):
            accounts = accounts.get("accounts", [])
        selected = None
        for account in accounts:
            account_id = account.get("account_id") or account.get("accountId") or account.get("id") or account.get("loginid")
            account_type = account.get("account_type") or account.get("accountType", "")
            is_demo = bool(account.get("is_virtual") or account.get("isVirtual") or account_type == "demo" or str(account_id).startswith(("VR", "DOT")))
            if (self.args.account == "demo" and is_demo) or (self.args.account == "real" and not is_demo):
                selected = account_id
                break
        if not selected and accounts:
            selected = accounts[0].get("account_id") or accounts[0].get("id")
        if not selected:
            raise RuntimeError(f"no {self.args.account} account found")
        otp_url = f"{REST_BASE_URL}/trading/v1/options/accounts/{selected}/otp"
        async with aiohttp.ClientSession() as session:
            async with session.post(otp_url, headers=headers, json={}, timeout=15) as response:
                data = await response.json()
                if response.status != 200:
                    raise RuntimeError(f"OTP request failed: {data}")
        payload = data.get("data", data)
        if isinstance(payload, dict):
            ws_url = payload.get("url") or payload.get("otpUrl")
        else:
            ws_url = None
        if not ws_url:
            raise RuntimeError(f"OTP response did not include a WebSocket URL: {data}")
        print(f"{GRN}[AUTH] account={selected} type={self.args.account}{RST}")
        return ws_url

    async def get_ws_url(self) -> str:
        use_bridge = os.environ.get("USE_BRIDGE", "1") == "1"
        if use_bridge:
            try:
                return await self.get_ws_url_via_bridge()
            except Exception as error:
                print(f"{YLW}[AUTH] bridge failed: {error}{RST}")
                if not os.environ.get("PAT_TOKEN"):
                    raise
        return await self.get_ws_url_via_pat()

    async def authorize_if_needed(self, ws, ws_url: str) -> None:
        pat = os.environ.get("PAT_TOKEN", "")
        if pat and ("binaryws.com" in ws_url or "otp" not in ws_url):
            await ws.send(json.dumps({"authorize": pat, "req_id": self.next_req_id()}))
            response = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if response.get("error"):
                raise RuntimeError(f"authorize failed: {response['error']}")
            print(f"{GRN}[AUTH] WebSocket authorized{RST}")

    async def request_contracts_for(self, ws) -> None:
        req_id = self.next_req_id()
        await ws.send(json.dumps({
            "contracts_for": self.symbol,
            "req_id": req_id,
        }))
        deadline = time.time() + 15
        while time.time() < deadline:
            response = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if response.get("error"):
                raise RuntimeError(f"contracts_for failed: {response['error']}")
            if response.get("msg_type") == "contracts_for" or response.get("req_id") == req_id:
                payload = response.get("contracts_for", response)
                text = json.dumps(payload).upper()
                if "ACCU" not in text:
                    raise RuntimeError(f"{self.symbol} did not advertise ACCU in contracts_for")
                contract = find_accu_contract(payload)
                if contract is None:
                    raise RuntimeError(f"{self.symbol} advertised ACCU but returned no ACCU contract details")
                self.accu_contract = contract
                expiry_type = contract.get("expiry_type", "unknown")
                print(f"{GRN}[MARKET] {self.symbol} advertises ACCU support | "
                      f"expiry={expiry_type} | position is open-ended{RST}")
                return
        raise TimeoutError("contracts_for timed out")

    async def subscribe(self, ws, ws_url: str) -> None:
        await self.authorize_if_needed(ws, ws_url)
        await self.request_contracts_for(ws)
        await ws.send(json.dumps({"portfolio": 1, "req_id": self.next_req_id()}))
        await ws.send(json.dumps({"ticks": self.symbol, "subscribe": 1, "req_id": self.next_req_id()}))
        await ws.send(json.dumps({"balance": 1, "subscribe": 1, "req_id": self.next_req_id()}))
        if self.active and self.active.get("contract_id"):
            await ws.send(json.dumps({
                "proposal_open_contract": 1,
                "contract_id": self.active["contract_id"],
                "subscribe": 1,
                "req_id": self.next_req_id(),
            }))
        print(f"{GRN}[STREAM] subscribed to {self.symbol}{RST}")

    async def keepalive(self, ws) -> None:
        failures = 0
        while True:
            await asyncio.sleep(PING_INTERVAL)
            try:
                await ws.send(json.dumps({"ping": 1, "req_id": self.next_req_id()}))
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                print(f"{YLW}[PING] failed {failures}/3: {error}{RST}")
                if failures >= 3:
                    await ws.close()
                    return

    async def run_session(self) -> None:
        ws_url = await self.get_ws_url()
        async with websockets.connect(ws_url, ping_interval=None, ping_timeout=None) as ws:
            await self.subscribe(ws, ws_url)
            keepalive_task = asyncio.create_task(self.keepalive(ws))
            scan_task = (
                asyncio.create_task(self.market_scan_loop(ws))
                if self.args.stable_market_scan else None
            )
            try:
                async for raw in ws:
                    await self.handle_message(ws, json.loads(raw))
            finally:
                keepalive_task.cancel()
                if scan_task:
                    scan_task.cancel()
                try:
                    await keepalive_task
                except asyncio.CancelledError:
                    pass
                if scan_task:
                    try:
                        await scan_task
                    except asyncio.CancelledError:
                        pass

    def close_session(self, reason: str) -> None:
        self.logbook.session({
            "start": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.session_start)),
            "end": time.strftime("%Y-%m-%d %H:%M:%S"),
            "reason": reason,
            "symbol": self.symbol,
            "mode": "live-demo" if self.trading_enabled else "dry-run",
            "session_pnl": round(self.session_pnl, 8),
            "knockouts": self.knockouts,
            "signals": len(self.logbook.data.get("signals", [])),
        })

    async def run(self) -> None:
        self.print_header()
        if self.args.history:
            self.print_history()
            return
        reconnects = 0
        reason = "stopped"
        try:
            while reconnects < MAX_RECONNECT_ATTEMPTS:
                try:
                    await self.run_session()
                    reconnects += 1
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    reconnects += 1
                    delay = min(RECONNECT_BASE_DELAY * (2 ** (reconnects - 1)), 60)
                    print(f"{RED}[CONNECTION] {error}{RST}")
                    if reconnects >= MAX_RECONNECT_ATTEMPTS:
                        reason = "max reconnect attempts"
                        break
                    print(f"{YLW}[CONNECTION] reconnecting in {delay}s "
                          f"({reconnects}/{MAX_RECONNECT_ATTEMPTS}){RST}")
                    await asyncio.sleep(delay)
        except KeyboardInterrupt:
            reason = "user stop"
        finally:
            self.close_session(reason)
            print(f"{DIM}Log saved to {self.logbook.path}{RST}")


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(AccumulatorBot(args).run())
    except KeyboardInterrupt:
        print("\nStopped by user")
    except Exception as error:
        print(f"{RED}Startup failed: {error}{RST}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
