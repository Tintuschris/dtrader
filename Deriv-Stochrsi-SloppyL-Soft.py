"""
Deriv Video Strategy - Enhanced CLI
Maconny L-Shape with rich terminal output.
"""

import asyncio
import json
import os
import sys
import time
import atexit
from collections import deque

import aiohttp
import websockets

import argparse


parser = argparse.ArgumentParser(description="Deriv STOCHRSI L-Shape Bot")
parser.add_argument("-s", "--symbol", default=os.environ.get("SYMBOL", "R_25"),
                    help="Deriv symbol (default: R_25)")
parser.add_argument("--stake", type=float, default=float(os.environ.get("STAKE", "1")),
                    help="Stake amount in USD (default: 1)")
parser.add_argument("--duration", type=int, default=int(os.environ.get("DURATION", "5")),
                    help="Contract duration in ticks (default: 5)")
parser.add_argument("--barrier-higher", default=os.environ.get("BARRIER_HIGHER", "-0.23"),
                    help="Barrier for HIGHER contract (default: -0.23)")
parser.add_argument("--barrier-lower", default=os.environ.get("BARRIER_LOWER", "+0.23"),
                    help="Barrier for LOWER contract (default: +0.23)")
parser.add_argument("--account", default=os.environ.get("ACCOUNT_TYPE", "demo"),
                    choices=["demo", "real"],
                    help="Account type (default: demo)")
parser.add_argument("--dry-run", action="store_true",
                    help="Detect signals but do not place trades")
parser.add_argument("--record", metavar="FILE",
                    help="Record ticks to JSON for backtesting")
parser.add_argument("--replay", metavar="FILE",
                    help="Replay recorded ticks for backtesting")
parser.add_argument("--history", action="store_true",
                    help="Print saved session history from trade_log.json and exit")
parser.add_argument("--max-sessions", type=int, metavar="N",
                    help="With --history: show only the newest N session records")
parser.add_argument("--trim", action="store_true",
                    help="With --history and --max-sessions N: delete older session records from the file")
parser.add_argument("--stats", action="store_true",
                    help="With --history: also print the win/loss band analysis from analyze_trade_log.py")
parser.add_argument("--since", metavar="YYYY-MM-DD HH:MM:SS",
                    help="With --history --stats: only analyze trades at/after this timestamp")
parser.add_argument("--speed", type=float, default=1.0,
                    help="Replay speed (1.0=real-time, 10=10x)")
parser.add_argument('--barrier-strong', default=os.environ.get('BARRIER_STRONG', '-0.20'),
                    help='Barrier for strong RSI signals (default: -0.20)')
parser.add_argument('--barrier-weak', default=os.environ.get('BARRIER_WEAK', '-0.30'),
                    help='Barrier for weaker RSI signals (default: -0.30)')
args = parser.parse_args()


# ============ CONFIG ============
BRIDGE_URL = os.environ.get("DTRADER_BRIDGE_URL", "http://localhost:3000")
USE_BRIDGE = os.environ.get("USE_BRIDGE", "1") == "1"
PAT_TOKEN = os.environ.get("PAT_TOKEN", "")
APP_ID = os.environ.get("DERIV_APP_ID", "")
ACCOUNT_TYPE = os.environ.get("ACCOUNT_TYPE", "demo")
SYMBOL = args.symbol
STAKE = args.stake
CURRENCY = "USD"
BARRIER_HIGHER = args.barrier_higher
BARRIER_LOWER = args.barrier_lower
BARRIER_STRONG = args.barrier_strong
BARRIER_WEAK = args.barrier_weak
DURATION = args.duration
DURATION_UNIT = "t"
RSI_PERIOD = 14
STOCH_PERIOD = 14
K_SMOOTH = 3
D_SMOOTH = 3
LEVEL_LOW = 0.3
LEVEL_HIGH = 0.7
FLAT_LOOKBACK = 6
FLAT_THRESHOLD = 0.06
BREAKOUT_MIN = 0.12

# === RAW StochRSI L-shape detection (replaces SMA-smoothed K detection) ===
RAW_LEVEL_LOW = 0.20
RAW_LEVEL_HIGH = 0.80
RAW_FLAT_LOOKBACK = 3
RAW_FLAT_THRESHOLD = 0.08
RAW_BREAKOUT_MIN = 0.10
RAW_SLOPE_MIN = -0.15
RAW_SLOPE_MAX = 0.15

# === Soft risk controls ===
# These keep the original sloppy-L detector intact while allowing more signals.
# Loss policy (same as main bot): pause after the first loss for LOSS_COOLDOWN_SECONDS.
MAX_CONSECUTIVE_LOSSES = int(os.environ.get("SOFT_MAX_CONSECUTIVE_LOSSES", "1"))
LOSS_COOLDOWN_SECONDS = int(os.environ.get("SOFT_LOSS_COOLDOWN_SECONDS", "60"))
RSI_LONG_MAX = float(os.environ.get("SOFT_RSI_LONG_MAX", "45"))
RSI_LONG_MIN = float(os.environ.get("SOFT_RSI_LONG_MIN", "20"))  # RSI floor for LONG: skip knife-catching deep oversold
RSI_SHORT_MIN = float(os.environ.get("SOFT_RSI_SHORT_MIN", "65"))

# === Trend filters ===
# Skip signals when price is trending strongly against the trade direction.
TREND_FILTER_TICKS = int(os.environ.get("SOFT_TREND_FILTER_TICKS", "10"))
TREND_FILTER_MIN_DOWNS = int(os.environ.get("SOFT_TREND_FILTER_MIN_DOWNS", "7"))
PRICE_DROP_FILTER_TICKS = int(os.environ.get("SOFT_PRICE_DROP_FILTER_TICKS", "10"))
PRICE_DROP_MIN_POINTS = float(os.environ.get("SOFT_PRICE_DROP_MIN_POINTS", "2.0"))

# === Payout filter ===
# Skip trades when payout is too high (market thinks trade will lose).
MAX_PAYOUT = float(os.environ.get("SOFT_MAX_PAYOUT", "2.50"))

# === Momentum confirmation ===
# Require price to actually reverse before entering trade.
MOMENTUM_CONFIRM_TICKS = int(os.environ.get("SOFT_MOMENTUM_CONFIRM_TICKS", "2"))

# Reconnection
MAX_RECONNECT_ATTEMPTS = 10
RECONNECT_BASE_DELAY = 2
PING_INTERVAL = 30
DRY_RUN = args.dry_run or bool(args.replay)
RECORD_FILE = args.record
REPLAY_FILE = args.replay
REPLAY_SPEED = args.speed
REST_BASE_URL = "https://api.derivws.com"
WS_URL = None

# ============ ANSI COLORS ============
RST = "\033[0m"
BLD = "\033[1m"
DIM = "\033[2m"
GRN = "\033[92m"
RED = "\033[91m"
YLW = "\033[93m"
CYN = "\033[96m"
MAG = "\033[95m"
WHT = "\033[97m"

# Buffers
closes = deque(maxlen=200)
rsi_vals = deque(maxlen=200)
stochrsi_vals = deque(maxlen=200)
k_vals = deque(maxlen=200)
d_vals = deque(maxlen=200)
tick_history = deque(maxlen=60)

# Stats
stats = {"trades": 0, "wins": 0, "losses": 0, "cancelled": 0, "total_pnl": 0.0, "balance": 0.0}
active_contract = None
pending_proposal = None  # {proposal_id, direction, barrier, entry_price}
_active_contract_id = None  # Persists across reconnects for POC re-subscription
_active_contract_snapshot = None  # Full open-contract context kept across reconnects for settle recovery
_tick_count = 0
_in_cooldown = False
_reconnect_count = 0
_recorded_ticks = []

# L-shape state tracking (operates on RAW StochRSI)
_l_phase = None
_l_slope_start_val = 0.0
_l_flat_count = 0
_l_flat_val_sum = 0.0
_l_direction = None
_consecutive_losses = 0
_loss_cooldown_until = 0.0
_trade_log = []
_last_displayed_cid = None


# ============ INDICATOR MATH ============

def calc_rsi(prices, period=14):
    if len(prices) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calc_stochrsi(rsi_list, period=14):
    if len(rsi_list) < period:
        return None
    recent = list(rsi_list)[-period:]
    lo, hi = min(recent), max(recent)
    if hi == lo:
        return 0
    return (recent[-1] - lo) / (hi - lo)


def sma(vals, period):
    if len(vals) < period:
        return None
    return sum(list(vals)[-period:]) / period


def is_flat(values, lookback, threshold):
    if len(values) < lookback + 1:
        return False
    recent = list(values)[-lookback - 1 : -1]
    return (max(recent) - min(recent)) < threshold


# ============ UI HELPERS ============


def reset_l_state():
    global _l_phase, _l_slope_start_val, _l_flat_count, _l_flat_val_sum, _l_direction, pending_proposal
    pending_proposal = None
    _l_phase = None
    _l_slope_start_val = 0.0
    _l_flat_count = 0
    _l_flat_val_sum = 0.0
    _l_direction = None


def reset_active_contract():
    """Clear active contract and pending proposal, saving contract context for re-subscription."""
    global active_contract, pending_proposal, _active_contract_id, _active_contract_snapshot
    if active_contract and active_contract.get("contract_id"):
        _active_contract_id = active_contract["contract_id"]
        _active_contract_snapshot = dict(active_contract)
    active_contract = None
    pending_proposal = None


def detect_l_shape(srsi_now, srsi_prev):
    global _l_phase, _l_slope_start_val, _l_flat_count, _l_flat_val_sum, _l_direction
    if srsi_now is None or srsi_prev is None:
        return None
    delta = srsi_now - srsi_prev

    if _l_phase is None:
        if delta <= RAW_SLOPE_MIN:
            _l_phase = "slope_down"
            _l_slope_start_val = srsi_prev
            _l_direction = "long"
            return None
        if delta >= RAW_SLOPE_MAX:
            _l_phase = "slope_up"
            _l_slope_start_val = srsi_prev
            _l_direction = "short"
            return None
        return None

    if _l_phase == "slope_down":
        if srsi_now <= RAW_LEVEL_LOW:
            _l_phase = "flat_low"
            _l_flat_count = 1
            _l_flat_val_sum = srsi_now
            return None
        if delta > 0.02:
            reset_l_state()
            return None
        return None

    if _l_phase == "slope_up":
        if srsi_now >= RAW_LEVEL_HIGH:
            _l_phase = "flat_high"
            _l_flat_count = 1
            _l_flat_val_sum = srsi_now
            return None
        if delta < -0.02:
            reset_l_state()
            return None
        return None

    if _l_phase == "flat_low":
        _l_flat_count += 1
        _l_flat_val_sum += srsi_now
        avg = _l_flat_val_sum / _l_flat_count
        if abs(srsi_now - avg) < RAW_FLAT_THRESHOLD and srsi_now <= RAW_LEVEL_LOW + 0.10:
            if _l_flat_count >= RAW_FLAT_LOOKBACK:
                _l_phase = "ready_long"
            return None
        else:
            reset_l_state()
            return None

    if _l_phase == "flat_high":
        _l_flat_count += 1
        _l_flat_val_sum += srsi_now
        avg = _l_flat_val_sum / _l_flat_count
        if abs(srsi_now - avg) < RAW_FLAT_THRESHOLD and srsi_now >= RAW_LEVEL_HIGH - 0.10:
            if _l_flat_count >= RAW_FLAT_LOOKBACK:
                _l_phase = "ready_short"
            return None
        else:
            reset_l_state()
            return None

    if _l_phase == "ready_long":
        if delta >= RAW_BREAKOUT_MIN:
            flat_avg = _l_flat_val_sum / _l_flat_count
            reason = (f"SRSI dropped from {_l_slope_start_val:.3f} to {flat_avg:.3f} "
                     f"(flat {_l_flat_count}t), broke UP +{delta:.3f}")
            reset_l_state()
            return ("higher", reason)
        if abs(delta) < RAW_FLAT_THRESHOLD:
            _l_flat_count += 1
            return None
        if delta < -0.02:
            reset_l_state()
            return None
        return None

    if _l_phase == "ready_short":
        if delta <= -RAW_BREAKOUT_MIN:
            flat_avg = _l_flat_val_sum / _l_flat_count
            reason = (f"SRSI rose from {_l_slope_start_val:.3f} to {flat_avg:.3f} "
                     f"(flat {_l_flat_count}t), broke DOWN {delta:.3f}")
            reset_l_state()
            return ("lower", reason)
        if abs(delta) < RAW_FLAT_THRESHOLD:
            _l_flat_count += 1
            return None
        if delta > 0.02:
            reset_l_state()
            return None
        return None

    return None
def mini_spark(values, width=20):
    if len(values) < 2:
        return "." * width
    recent = list(values)[-width:]
    lo, hi = min(recent), max(recent)
    rng = hi - lo if hi != lo else 1
    blocks = ["_", ".", "o", "O", "0", "X", "#", "@"]
    result = []
    for v in recent:
        idx = int(((v - lo) / rng) * (len(blocks) - 1))
        result.append(blocks[idx])
    return "".join(result)


def signal_bar(k_now):
    w = 30
    pos = max(0, min(1, k_now))
    filled = int(pos * w)
    low_pos = int(LEVEL_LOW * w)
    high_pos = int(LEVEL_HIGH * w)
    parts = []
    for i in range(w):
        if i == low_pos or i == high_pos:
            parts.append("|")
        elif i < filled:
            if i < low_pos:
                parts.append(RED + "#" + RST)
            elif i < high_pos:
                parts.append(YLW + "#" + RST)
            else:
                parts.append(GRN + "#" + RST)
        else:
            parts.append(DIM + "." + RST)
    return "".join(parts) + " " + f"{k_now:.4f}"


def print_header():
    print()
    print(f"{BLD}{CYN}+{'='*56}+{RST}")
    print(f"{CYN}|{RST}  {BLD}Deriv STOCHRSI L-Shape Bot{RST}  {DIM}v2.0 Enhanced CLI{RST}")
    print(f"{CYN}+{'='*56}+{RST}")
    print(f"{CYN}|{RST}  Symbol:    {BLD}{SYMBOL}{RST}                          Duration: {BLD}{DURATION}{DURATION_UNIT}{RST}")
    print(f"{CYN}|{RST}  Stake:     {GRN}${STAKE} {CURRENCY}{RST}                       Barrier:  {BLD}{BARRIER_HIGHER}/{BARRIER_LOWER}{RST}")
    print(f"{CYN}|{RST}  Mode:      {BLD}{'BRIDGE' if USE_BRIDGE else 'PAT'}{RST}")
    print(f"{CYN}|{RST}  Strategy:  {MAG}RAW StochRSI({RSI_PERIOD}) slanted L{RST}")
    if DRY_RUN:
        print(f"  {DIM}    *** DRY RUN MODE ***{RST}")
    print(f"{CYN}+{'='*56}+{RST}")
    print()


def print_dashboard():
    rsi_n = len(rsi_vals)
    stoch_n = len(stochrsi_vals)
    raw_now = stochrsi_vals[-1] if stochrsi_vals else None
    k_now = k_vals[-1] if k_vals else None
    d_now = d_vals[-1] if d_vals else None
    rsi_now = rsi_vals[-1] if rsi_vals else 0

    if raw_now is None:
        needed = max(0, RSI_PERIOD + 1 - rsi_n) + max(0, STOCH_PERIOD - stoch_n)
        print(f"  {DIM}+--- WARMUP -------------------------------------------+{RST}")
        print(f"  {DIM}|{RST}  RSI: {YLW}{rsi_n:2d}{RST}/{RSI_PERIOD+1}  StochRSI: {YLW}{stoch_n:2d}{RST}/{STOCH_PERIOD}  {DIM}~{needed} ticks left{RST}")
        print(f"  {DIM}+------------------------------------------------------+{RST}")
        return

    raw_color = GRN if raw_now > RAW_LEVEL_HIGH else (RED if raw_now < RAW_LEVEL_LOW else YLW)

    phase_str = DIM + "IDLE" + RST
    if _l_phase == "slope_down": phase_str = RED + "SLOPE DN" + RST
    elif _l_phase == "slope_up": phase_str = GRN + "SLOPE UP" + RST
    elif _l_phase == "flat_low": phase_str = YLW + "FLAT LOW" + RST
    elif _l_phase == "flat_high": phase_str = YLW + "FLAT HIGH" + RST
    elif _l_phase == "ready_long": phase_str = GRN + "READY-L" + RST
    elif _l_phase == "ready_short": phase_str = RED + "READY-S" + RST

    _track_market(rsi_now, raw_now)

    print(f"  {DIM}+--- RAW STOCHRSI DETECTION ---------------------------+{RST}")
    print(f"  {DIM}|{RST}  RSI({RSI_PERIOD}):  {BLD}{rsi_now:6.2f}{RST}  |  Raw SRSI: {raw_color}{BLD}{raw_now:6.4f}{RST}  |  Phase: {phase_str}")
    if k_now is not None:
        k_color = GRN if k_now > LEVEL_HIGH else (RED if k_now < LEVEL_LOW else YLW)
        print(f"  {DIM}|{RST}  K({K_SMOOTH}):     {k_color}{BLD}{k_now:6.4f}{RST}  |  D({D_SMOOTH}):     {CYN}{BLD}{d_now:6.4f}{RST}")
        print(f"  {DIM}|{RST}  K line:    {DIM}{mini_spark(k_vals, 30)}{RST}")
    print(f"  {DIM}|{RST}  Raw SRSI:  {DIM}{mini_spark(stochrsi_vals, 30)}{RST}")
    print(f"  {DIM}|{RST}  Signal:    {signal_bar(raw_now)}")
    print(f"  {DIM}|{RST}  Levels:    {RED}{RAW_LEVEL_LOW}{RST}{DIM}--------{YLW}MID{YLW}{DIM}--------{GRN}{RAW_LEVEL_HIGH}{RST}")
    print(f"  {DIM}+------------------------------------------------------+{RST}")
def print_tick(price, tick_num):
    if len(closes) >= 2:
        prev = list(closes)[-2]
        arrow = GRN + "^" + RST if price > prev else (RED + "v" + RST if price < prev else DIM + "-" + RST)
    else:
        arrow = DIM + "." + RST
    digit = int(str(price).split(".")[-1][-1]) if "." in str(price) else 0
    digit_color = GRN if digit >= 5 else RED
    spark = mini_spark(tick_history, 30)
    srsi_str = ""
    if stochrsi_vals:
        sv = stochrsi_vals[-1]
        sc = GRN if sv > RAW_LEVEL_HIGH else (RED if sv < RAW_LEVEL_LOW else DIM)
        srsi_str = f"  {sc}SRSI:{sv:.3f}{RST}"
    print(f"  {DIM}#{tick_num:>4d}{RST} {arrow} {BLD}{price:.4f}{RST}  {digit_color}[{digit}]{RST}{srsi_str}  {DIM}{spark}{RST}")

def _calc_barrier(direction, rsi):
    """Pick barrier based on RSI strength. Uses user-specified BARRIER_HIGHER/BARRIER_LOWER."""
    strong_threshold = 25 if direction == 'higher' else 85
    if direction == 'higher':
        return BARRIER_HIGHER if rsi <= strong_threshold else BARRIER_WEAK
    else:
        bv = BARRIER_LOWER if rsi >= strong_threshold else BARRIER_WEAK
        return '+' + bv.lstrip('-')

def print_signal(direction, srsi_val, reason, rsi_val=None, barrier=None):
    if direction == "higher":
        print(f"  {BLD}{GRN}{"="*60}{RST}")
        print(f"  {BLD}{GRN}  >>>  L-SHAPE LONG SIGNAL  <<<{RST}")
        print(f"  {BLD}{GRN}  Raw SRSI={srsi_val:.4f} broke UP from oversold zone{RST}")
        print(f"  {GRN}  Reason: {reason}{RST}")
        bv = barrier if barrier else BARRIER_HIGHER
        print(f"  {GRN}  Barrier: {bv} | Contract: HIGHER | Stake: {RST}")
        print(f"  {BLD}{GRN}{"="*60}{RST}")
    else:
        print(f"  {BLD}{RED}{"="*60}{RST}")
        print(f"  {BLD}{RED}  <<<  L-SHAPE SHORT SIGNAL  >>>{RST}")
        print(f"  {BLD}{RED}  Raw SRSI={srsi_val:.4f} broke DOWN from overbought zone{RST}")
        print(f"  {RED}  Reason: {reason}{RST}")
        bv = barrier if barrier else BARRIER_LOWER
        print(f"  {RED}  Barrier: {bv} | Contract: LOWER | Stake: {RST}")
        print(f"  {BLD}{RED}{"="*60}{RST}")
def print_trade_placed(contract_id, direction, cost, payout):
    print(f"  {BLD}{YLW}+--- TRADE PLACED --------------------------------+{RST}")
    print(f"  {YLW}|{RST}  Contract:   {BLD}{contract_id}{RST}")
    print(f"  {YLW}|{RST}  Direction:  {BLD}{direction.upper()}{RST}")
    print(f"  {YLW}|{RST}  Cost:       {RED}${cost}{RST}")
    print(f"  {YLW}|{RST}  Payout:     {GRN}${payout}{RST}")
    print(f"  {YLW}|{RST}  Duration:   {DURATION}{DURATION_UNIT} ({DURATION} ticks)")
    print(f"  {YLW}|{RST}  {DIM}Waiting for {DURATION} ticks to settle...{RST}")
    print(f"  {YLW}+------------------------------------------------+{RST}")


def print_trade_progress(current, total, entry_price, barrier):
    try: current = int(current)
    except Exception: current = 0
    try: total = int(total)
    except Exception: total = 1
    pct = current / total if total > 0 else 0
    bar_w = 20
    filled = int(pct * bar_w)
    bar = GRN + "#" * filled + DIM + "." * (bar_w - filled) + RST
    print(f"  {CYN}>> [{bar}] {current}/{total} ticks  {DIM}entry={entry_price:.4f} barrier={barrier}{RST}", end="\r", flush=True)


def print_trade_result(status, profit, entry_price, exit_price, direction, contract_id):
    is_win = profit >= 0
    rc = GRN if is_win else RED
    txt = "WIN" if is_win else "LOSS"

    stats["trades"] += 1
    stats["total_pnl"] += profit
    if is_win:
        stats["wins"] += 1
    else:
        stats["losses"] += 1

    wr = (stats["wins"] / stats["trades"] * 100) if stats["trades"] > 0 else 0

    print()
    print(f"  {rc}{'='*56}{RST}")
    print(f"  {BLD}{rc}  TRADE {txt}  {RST}")
    print(f"  {rc}{'='*56}{RST}")
    print(f"  {DIM}|{RST}  Contract:   {BLD}{contract_id}{RST}")
    print(f"  {DIM}|{RST}  Direction:  {BLD}{direction.upper()}{RST}")
    print(f"  {DIM}|{RST}  Entry:      {entry_price:.4f}")
    print(f"  {DIM}|{RST}  Exit:       {exit_price:.4f}")
    print(f"  {DIM}|{RST}  Barrier:    {BARRIER_HIGHER if direction == 'higher' else BARRIER_LOWER}")
    print(f"  {DIM}|{RST}  Profit:     {rc}{BLD}${profit:+.2f}{RST}")
    print(f"  {DIM}|{RST}  Balance:    {BLD}${stats['balance']:.2f}{RST}")
    print(f"  {DIM}|{RST}")
    print(f"  {DIM}|{RST}  Session:  {stats['trades']} trades  |  {GRN}{stats['wins']}W{RST} {RED}{stats['losses']}L{RST}  |  WR: {BLD}{wr:.0f}%{RST}  |  PnL: {rc}${stats['total_pnl']:+.2f}{RST}")
    print(f"  {rc}{'='*56}{RST}")


def print_balance(amount):
    stats["balance"] = float(amount) if amount != "?" else stats["balance"]
    print(f"  {DIM}Balance: ${stats['balance']:.2f}{RST}")





def print_trade_result_analyzed(status, profit, entry_price, exit_price, direction, contract_id, barrier_val, poc):
    global _consecutive_losses, _loss_cooldown_until
    profit = float(profit) if profit else 0.0
    is_cancelled = status in ("cancelled", "sold") and profit <= 0
    
    if is_cancelled:
        rc = YLW
        txt = "CANCELLED"
        stats["cancelled"] += 1
        stats["total_pnl"] += profit
    else:
        is_win = profit >= 0
        rc = GRN if is_win else RED
        txt = "WIN" if is_win else "LOSS"
        stats["trades"] += 1
        stats["total_pnl"] += profit
        if is_win:
            stats["wins"] += 1
            _consecutive_losses = 0
        else:
            stats["losses"] += 1
            _consecutive_losses += 1
    wr = (stats["wins"] / stats["trades"] * 100) if stats["trades"] > 0 else 0

    entry_spot = poc.get("entry_tick", entry_price)
    exit_spot = poc.get("exit_tick", exit_price)
    if isinstance(entry_spot, dict):
        entry_spot = entry_spot.get("epoch", entry_price)
    if isinstance(exit_spot, dict):
        exit_spot = exit_spot.get("epoch", exit_price)
    try:
        entry_spot = float(entry_spot)
    except Exception:
        entry_spot = entry_price
    try:
        exit_spot = float(exit_spot)
    except Exception:
        exit_spot = exit_price

    bv = float(barrier_val)
    if direction == "higher":
        barrier_level = entry_spot + bv
        won = exit_spot > barrier_level
        condition = "Exit ({:.4f}) > Barrier ({:.4f})".format(exit_spot, barrier_level)
    else:
        barrier_level = entry_spot + bv
        won = exit_spot < barrier_level
        condition = "Exit ({:.4f}) < Barrier ({:.4f})".format(exit_spot, barrier_level)

    diff = exit_spot - barrier_level
    pct_diff = abs(diff) / entry_spot * 100 if entry_spot else 0

    print()
    print("  " + rc + "=" * 60 + RST)
    print("  " + BLD + rc + "  TRADE " + txt + "  " + RST)
    print("  " + rc + "=" * 60 + RST)
    print("  " + DIM + "|" + RST + "  Contract:   " + BLD + str(contract_id) + RST)
    print("  " + DIM + "|" + RST + "  Direction:  " + BLD + direction.upper() + RST)
    print("  " + DIM + "|" + RST + "  Stake:      $" + str(STAKE))
    try:
        payout_val = float(poc.get("payout", 0))
    except Exception:
        payout_val = 0
    print("  " + DIM + "|" + RST + "  Payout:     $" + "{:.2f}".format(payout_val))
    print("  " + DIM + "|" + RST + "  Profit:     " + rc + BLD + "${:+.2f}".format(profit) + RST)
    print("  " + DIM + "|" + RST + "  Balance:    " + BLD + "${:.2f}".format(stats["balance"]) + RST)
    print("  " + DIM + "|" + RST)
    print("  " + DIM + "|" + RST + "  " + BLD + "Trade Analysis:" + RST)
    print("  " + DIM + "|" + RST + "  Entry spot:  " + "{:.4f}".format(entry_spot))
    print("  " + DIM + "|" + RST + "  Exit spot:   " + "{:.4f}".format(exit_spot))
    print("  " + DIM + "|" + RST + "  Barrier:     " + "{:.4f}".format(barrier_level) + " (" + str(barrier_val) + ")")
    print("  " + DIM + "|" + RST + "  " + condition)
    print("  " + DIM + "|" + RST + "  Gap:         " + rc + "{:+.4f}".format(diff) + " ({:.4f}%)".format(pct_diff) + RST)
    if is_cancelled:
        reason = "Early sold by user" if poc.get("sell_time") else "Market cancelled"
        print("  " + DIM + "|" + RST + "  " + YLW + "Reason:      " + reason + RST)
    elif not won:
        needed = abs(diff)
        print("  " + DIM + "|" + RST + "  " + YLW + "Lost by:     " + "{:.4f}".format(needed) + " ({:.4f}%)".format(needed / entry_spot * 100) + RST)
    print("  " + DIM + "|" + RST)
    print("  " + DIM + "|" + RST + "  Session:  {} trades  |  ".format(stats["trades"] + stats["cancelled"]) + GRN + "{}W".format(stats["wins"]) + RST + " " + RED + "{}L".format(stats["losses"]) + RST + " " + YLW + "{}C".format(stats["cancelled"]) + RST + "  |  WR: " + BLD + "{:.0f}%".format(wr) + RST + "  |  PnL: " + rc + "${:+.2f}".format(stats["total_pnl"]) + RST)
    print("  " + rc + "=" * 60 + RST)

def save_recording():
    if not RECORD_FILE or not _recorded_ticks:
        return
    data = {"symbol": SYMBOL, "ticks": _recorded_ticks,
            "config": {"rsi_period": RSI_PERIOD, "stoch_period": STOCH_PERIOD}}
    with open(RECORD_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print("  " + GRN + "+" + RST + " Saved " + str(len(_recorded_ticks)) + " ticks to " + RECORD_FILE)


atexit.register(save_recording)


TRADE_LOG_FILE = "trade_log.json"


def save_trade_log():
    """Save signal and settled-trade data for later tuning."""
    if _history_mode:
        return  # --history is view/trim only; never rewrite the file here
    if not _trade_log and not _sessions:
        return
    try:
        done = [e for e in _trade_log if e["result"]["status"] in ("won", "lost")]
        wins = sum(1 for e in done if e["result"]["status"] == "won")
        losses = len(done) - wins
        trades = wins + losses
        pnl = sum(float(e["result"].get("profit", 0) or 0) for e in done)
        summary = {
            "total_trades": trades,
            "wins": wins,
            "losses": losses,
            "win_rate": round(wins / trades * 100, 1) if trades else 0,
            "pnl": round(pnl, 2),
            "current_loss_streak": _consecutive_losses,
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(TRADE_LOG_FILE, "w") as f:
            json.dump({"summary": summary, "trades": _trade_log, "sessions": _sessions}, f, indent=2)
    except Exception as e:
        print(f"  {RED}X Failed to save trade log: {e}{RST}")


atexit.register(save_trade_log)


# ---- Session history: one summary record per run, appended on exit ----
SESSION_START_TS = time.time()
_exit_reason = "process_end"
_session_finalized = False
_history_mode = False  # True when --history: view only, do not record a session


def _load_existing_sessions():
    """Load session records left by previous runs that used this trade log file."""
    try:
        with open(TRADE_LOG_FILE, "r") as f:
            return json.load(f).get("sessions", [])
    except Exception:
        return []


_sessions = _load_existing_sessions()


def record_session_end():
    """Append this run's final summary to the session history (idempotent)."""
    global _session_finalized
    if _session_finalized or _history_mode:
        return
    _session_finalized = True
    try:
        end_ts = time.time()
        settled = stats["trades"]
        settled_list = []
        for e in _trade_log:
            r = e.get("result", {})
            if r.get("contract_id") and r.get("status") in ("won", "lost", "cancelled"):
                settled_list.append({
                    "contract_id": r.get("contract_id"),
                    "direction": e.get("direction"),
                    "status": r.get("status"),
                    "profit": r.get("profit"),
                    "settled_at": r.get("settled_at"),
                })
        ms = _market_state
        _n = ms["samples"]
        by_cat = {}
        for _s in _skips:
            by_cat[_s["category"]] = by_cat.get(_s["category"], 0) + 1
        _sessions.append({
            "session_start": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(SESSION_START_TS)),
            "session_start_epoch": int(SESSION_START_TS),
            "session_end": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(end_ts)),
            "duration_sec": round(end_ts - SESSION_START_TS, 1),
            "exit_reason": _exit_reason,
            "ticks": _tick_count,
            "signals": len(_trade_log),
            "summary": {
                "settled": settled,
                "wins": stats["wins"],
                "losses": stats["losses"],
                "cancelled": stats["cancelled"],
                "win_rate": round(stats["wins"] / settled * 100, 1) if settled else 0.0,
                "pnl": round(stats["total_pnl"], 2),
                "balance": round(stats["balance"], 2),
            },
            "market": {
                "samples": _n,
                "rsi_min": round(ms["rsi_min"], 2) if _n else None,
                "rsi_max": round(ms["rsi_max"], 2) if _n else None,
                "rsi_avg": round(ms["rsi_sum"] / _n, 2) if _n else None,
                "srsi_min": round(ms["srsi_min"], 4) if _n else None,
                "srsi_max": round(ms["srsi_max"], 4) if _n else None,
                "srsi_avg": round(ms["srsi_sum"] / _n, 4) if _n else None,
                "phases": dict(ms["phases"]),
            },
            "skips": {
                "count": len(_skips),
                "by_category": by_cat,
                "recent": list(_skips[-10:]),
            },
            "settled_trades": settled_list,
        })
        save_trade_log()
    except Exception:
        pass


atexit.register(record_session_end)


# ---- Skip / market tracking (captured into the session record at exit) ----
_skips = []  # why signals were skipped, newest last
_market_state = {"samples": 0, "rsi_min": None, "rsi_max": None, "rsi_sum": 0.0,
                 "srsi_min": None, "srsi_max": None, "srsi_sum": 0.0, "phases": {}}


def _plain(text):
    """Strip ANSI color codes from a console string."""
    import re as _re
    return _re.sub(r"\x1b\[[0-9;]*m", "", text)


def _skip(category, text):
    """Log a skipped signal (category + text) and return the text to print."""
    try:
        if len(_skips) > 500:
            _skips.pop(0)
        detail = _plain(text).replace("! SKIPPED:", "skipped").strip()
        _skips.append({"time": time.strftime("%Y-%m-%d %H:%M:%S"),
                       "category": category, "detail": detail})
    except Exception:
        pass
    return text


def _track_market(rsi, raw):
    """Accumulate per-tick RSI/SRSI/phase stats for the session record."""
    try:
        ms = _market_state
        ms["samples"] += 1
        ms["rsi_min"] = rsi if ms["rsi_min"] is None else min(ms["rsi_min"], rsi)
        ms["rsi_max"] = rsi if ms["rsi_max"] is None else max(ms["rsi_max"], rsi)
        ms["rsi_sum"] += rsi
        ms["srsi_min"] = raw if ms["srsi_min"] is None else min(ms["srsi_min"], raw)
        ms["srsi_max"] = raw if ms["srsi_max"] is None else max(ms["srsi_max"], raw)
        ms["srsi_sum"] += raw
        key = _l_phase if _l_phase else "idle"
        ms["phases"][key] = ms["phases"].get(key, 0) + 1
    except Exception:
        pass


def log_trade_signal(direction, srsi_val, rsi_val, reason, price, barrier):
    """Record the exact context of every signal that reaches execution."""
    entry = {
        "id": len(_trade_log) + 1,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": time.time(),
        "symbol": SYMBOL,
        "direction": direction,
        "stake": STAKE,
        "barrier": barrier,
        "signal": {
            "srsi_value": round(srsi_val, 4),
            "rsi_value": round(rsi_val, 2),
            "reason": reason,
        },
        "market": {
            "entry_price": price,
            "last_5_ticks": [round(t, 4) for t in list(tick_history)[-5:]],
            "tick_count": _tick_count,
        },
        "result": {
            "status": "pending",
            "contract_id": None,
            "entry_spot": None,
            "exit_spot": None,
            "profit": None,
            "payout": None,
            "balance": None,
        },
    }
    _trade_log.append(entry)
    save_trade_log()


def log_trade_result(contract_id, status, profit, entry_spot, exit_spot, payout, balance):
    """Attach the settled result to the most recent pending signal."""
    for entry in reversed(_trade_log):
        if entry["result"]["status"] == "pending":
            entry["result"].update({
                "status": status,
                "contract_id": contract_id,
                "entry_spot": entry_spot,
                "exit_spot": exit_spot,
                "profit": profit,
                "payout": payout,
                "balance": balance,
                "settled_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            })
            break
    save_trade_log()


def print_backtest_results(bt):
    total, wins, losses, pnl = bt["trades"], bt["wins"], bt["losses"], bt["pnl"]
    wr = (wins / total * 100) if total > 0 else 0
    rc = GRN if pnl >= 0 else RED
    print()
    print(f"  {BLD}{CYN}+============================================================+{RST}")
    print(f"  {BLD}{CYN}|  BACKTEST RESULTS                                         |{RST}")
    print(f"  {BLD}{CYN}+============================================================+{RST}")
    print(f"  {CYN}|{RST}  Ticks:    {BLD}{bt['ticks']}{RST}  |  Signals: {BLD}{bt['signals']}{RST}")
    print(f"  {CYN}|{RST}  Trades:   {BLD}{total}{RST}  |  Wins: {GRN}{wins}{RST}  Losses: {RED}{losses}{RST}")
    print(f"  {CYN}|{RST}  Win rate: {BLD}{wr:.1f}%{RST}  |  P&L: {rc}{BLD}{pnl:+.2f}{RST}")
    print(f"  {BLD}{CYN}+============================================================+{RST}")

# ============ AUTH ============

async def get_ws_url_via_bridge():
    url = f"{BRIDGE_URL}/api/deriv/bot-session?type={ACCOUNT_TYPE}"
    print(f"  {CYN}>{RST} Requesting WS session from bridge...")
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"Bridge error: {data.get('error', resp.status)}")
            print(f"  {GRN}+{RST} Got WS URL for account {data.get('accountId', '?')}")
            return data.get("url")


async def get_accounts():
    url = f"{REST_BASE_URL}/trading/v1/options/accounts"
    headers = {"Authorization": f"Bearer {PAT_TOKEN}", "Deriv-App-ID": APP_ID, "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"Accounts fetch failed: {data}")
            return data


def select_account(accounts_data):
    d = accounts_data.get("data") if isinstance(accounts_data, dict) else None
    if isinstance(d, list):
        accounts = d
    elif isinstance(d, dict) and "accounts" in d:
        accounts = d["accounts"]
    elif isinstance(accounts_data, list):
        accounts = accounts_data
    else:
        accounts = []
    if not accounts:
        return None
    selected = None
    for acc in accounts:
        acc_id = acc.get("account_id") or acc.get("accountId") or acc.get("id") or acc.get("loginid")
        is_virtual = acc.get("is_virtual") or acc.get("isVirtual") or (acc.get("account_type") == "demo")
        acc_type = acc.get("account_type") or acc.get("accountType") or ("demo" if is_virtual else "real")
        is_demo = is_virtual or acc_type == "demo" or str(acc_id).startswith("VR") or str(acc_id).startswith("DOT")
        if ACCOUNT_TYPE == "demo" and is_demo:
            selected = acc
            break
        if ACCOUNT_TYPE == "real" and not is_demo:
            selected = acc
            break
    if not selected and accounts:
        selected = accounts[0]
    return selected.get("account_id") or selected.get("accountId") or selected.get("id") or selected.get("loginid")


async def get_otp_url(account_id):
    url = f"{REST_BASE_URL}/trading/v1/options/accounts/{account_id}/otp"
    headers = {"Authorization": f"Bearer {PAT_TOKEN}", "Deriv-App-ID": APP_ID, "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json={}) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"OTP failed: {data}")
            if "data" in data and isinstance(data["data"], dict):
                return data["data"].get("url") or data["data"].get("otpUrl")
            return data.get("url")


# ============ TRADE PLACEMENT ============

async def place_trade(ws, direction, barrier):
    global pending_proposal
    contract_type = "HIGHER" if direction == "higher" else "LOWER"
    proposal_req = {
        "proposal": 1,
        "amount": STAKE,
        "basis": "stake",
        "contract_type": contract_type,
        "currency": CURRENCY,
        "duration": DURATION,
        "duration_unit": DURATION_UNIT,
        "barrier": barrier,
        "underlying_symbol": SYMBOL,
    }
    pending_proposal = {"direction": direction, "barrier": barrier, "entry_price": None}
    print(f"  {DIM}[PROPOSAL] amount={STAKE} type={contract_type} barrier={barrier} symbol={SYMBOL}{RST}")
    await ws.send(json.dumps(proposal_req))
# ============ TICK PROCESSING ============

async def process_tick(ws, tick_data, last_trade_time):
    global _tick_count, _in_cooldown, active_contract
    global _consecutive_losses, _loss_cooldown_until
    _tick_count += 1
    price = tick_data["quote"]
    closes.append(price)
    tick_history.append(price)

    if RECORD_FILE:
        _recorded_ticks.append({"epoch": tick_data.get("epoch", time.time()), "quote": price})
        if len(_recorded_ticks) % 10 == 0:
            save_recording()

    print_tick(price, _tick_count)

    # Calculate indicators
    rsi = calc_rsi(list(closes), RSI_PERIOD)
    if rsi is not None:
        rsi_vals.append(rsi)
        stochrsi = calc_stochrsi(list(rsi_vals), STOCH_PERIOD)
        if stochrsi is not None:
            stochrsi_vals.append(stochrsi)
            k = sma(list(stochrsi_vals), K_SMOOTH)
            d = sma(list(stochrsi_vals), D_SMOOTH) if len(stochrsi_vals) >= D_SMOOTH else k
            if k is not None:
                k_vals.append(k)
            if d is not None:
                d_vals.append(d)

    print_dashboard()

    if len(stochrsi_vals) < 2 or active_contract:
        return last_trade_time


    # Cooldown
    now = time.time()
    if now - last_trade_time < (DURATION + 2):
        if not _in_cooldown:
            remaining = int((DURATION + 2) - (now - last_trade_time))
            print(f"  {DIM}Cooldown: {remaining}s remaining{RST}")
            _in_cooldown = True
        return last_trade_time
    _in_cooldown = False

    # === L-SHAPE DETECTION ON RAW STOCHRSI ===
    srsi_now = stochrsi_vals[-1]
    srsi_prev = stochrsi_vals[-2]

    result = detect_l_shape(srsi_now, srsi_prev)
    if result:
        direction, reason = result

        # === LOSS-STREAK CIRCUIT BREAKER ===
        if _consecutive_losses >= MAX_CONSECUTIVE_LOSSES:
            if _loss_cooldown_until == 0:
                _loss_cooldown_until = now + LOSS_COOLDOWN_SECONDS
            remaining = _loss_cooldown_until - now
            if remaining > 0:
                print(_skip("loss_streak", f"  {YLW}! SKIPPED: Loss streak ({_consecutive_losses}L) - {int(remaining)}s cooldown{RST}"))
                reset_l_state()
                return now
            _consecutive_losses = 0
            _loss_cooldown_until = 0

        # === RSI TREND ALIGNMENT ===
        rsi_now = rsi_vals[-1] if rsi_vals else 50
        if direction == "higher" and rsi_now > RSI_LONG_MAX:
            print(_skip("rsi_not_oversold", f"  {YLW}! SKIPPED: RSI={rsi_now:.1f} > {RSI_LONG_MAX:.0f}, not oversold enough{RST}"))
            reset_l_state()
            return now
        if direction == "higher" and rsi_now < RSI_LONG_MIN:
            print(_skip("rsi_too_deep", f"  {YLW}! SKIPPED: RSI={rsi_now:.1f} < {RSI_LONG_MIN:.0f}, oversold too deep (knife-catching){RST}"))
            reset_l_state()
            return now
        if direction == "lower" and rsi_now < RSI_SHORT_MIN:
            print(_skip("rsi_not_overbought", f"  {YLW}! SKIPPED: RSI={rsi_now:.1f} < {RSI_SHORT_MIN:.0f}, not overbought enough{RST}"))
            reset_l_state()
            return now

        # === REVERSAL CONFIRMATION (2-tick) ===
        if len(tick_history) >= 3:
            t1, t2, t3 = tick_history[-3], tick_history[-2], tick_history[-1]
            if direction == "higher" and not (t3 > t2 or t2 > t1):
                print(_skip("reversal_up", f"  {YLW}! SKIPPED: No reversal confirmation (need 2 UP ticks){RST}"))
                reset_l_state()
                return now
            if direction == "lower" and not (t3 < t2 or t2 < t1):
                print(_skip("reversal_down", f"  {YLW}! SKIPPED: No reversal confirmation (need 2 DOWN ticks){RST}"))
                reset_l_state()
                return now

        # === TREND FILTER: Skip if price dropping too hard against trade ===
        if direction == "higher" and len(tick_history) >= TREND_FILTER_TICKS:
            recent = list(tick_history)[-TREND_FILTER_TICKS:]
            down_count = sum(1 for i in range(1, len(recent)) if recent[i] < recent[i-1])
            if down_count >= TREND_FILTER_MIN_DOWNS:
                print(_skip("trend_against_long", f"  {YLW}! SKIPPED: Strong downtrend ({down_count}/{TREND_FILTER_TICKS} ticks down) - price dropping against LONG{RST}"))
                reset_l_state()
                return now
        if direction == "lower" and len(tick_history) >= TREND_FILTER_TICKS:
            recent = list(tick_history)[-TREND_FILTER_TICKS:]
            up_count = sum(1 for i in range(1, len(recent)) if recent[i] > recent[i-1])
            if up_count >= TREND_FILTER_MIN_DOWNS:
                print(_skip("trend_against_short", f"  {YLW}! SKIPPED: Strong uptrend ({up_count}/{TREND_FILTER_TICKS} ticks up) - price rising against SHORT{RST}"))
                reset_l_state()
                return now

        # === PRICE DROP FILTER: Skip LONG if price dropped too much recently ===
        if direction == "higher" and len(tick_history) >= PRICE_DROP_FILTER_TICKS:
            old_price = list(tick_history)[-PRICE_DROP_FILTER_TICKS]
            price_change = tick_history[-1] - old_price
            if price_change < -PRICE_DROP_MIN_POINTS:
                print(_skip("price_drop", f"  {YLW}! SKIPPED: Price dropped {abs(price_change):.4f} pts in last {PRICE_DROP_FILTER_TICKS} ticks (threshold: {PRICE_DROP_MIN_POINTS}){RST}"))
                reset_l_state()
                return now
        if direction == "lower" and len(tick_history) >= PRICE_DROP_FILTER_TICKS:
            old_price = list(tick_history)[-PRICE_DROP_FILTER_TICKS]
            price_change = tick_history[-1] - old_price
            if price_change > PRICE_DROP_MIN_POINTS:
                print(_skip("price_rise", f"  {YLW}! SKIPPED: Price rose {price_change:.4f} pts in last {PRICE_DROP_FILTER_TICKS} ticks (threshold: {PRICE_DROP_MIN_POINTS}){RST}"))
                reset_l_state()
                return now

        # === MOMENTUM CONFIRMATION: Require price to actually reverse ===
        if len(tick_history) >= MOMENTUM_CONFIRM_TICKS + 1:
            recent_mom = list(tick_history)[-(MOMENTUM_CONFIRM_TICKS + 1):]
            if direction == "higher":
                mom_up = sum(1 for i in range(1, len(recent_mom)) if recent_mom[i] > recent_mom[i-1])
                if mom_up < MOMENTUM_CONFIRM_TICKS:
                    print(_skip("momentum_up", f"  {YLW}! SKIPPED: No momentum confirmation ({mom_up}/{MOMENTUM_CONFIRM_TICKS} UP ticks){RST}"))
                    reset_l_state()
                    return now
            if direction == "lower":
                mom_dn = sum(1 for i in range(1, len(recent_mom)) if recent_mom[i] < recent_mom[i-1])
                if mom_dn < MOMENTUM_CONFIRM_TICKS:
                    print(_skip("momentum_down", f"  {YLW}! SKIPPED: No momentum confirmation ({mom_dn}/{MOMENTUM_CONFIRM_TICKS} DOWN ticks){RST}"))
                    reset_l_state()
                    return now

        barrier = _calc_barrier(direction, rsi_now)
        print_signal(direction, srsi_now, reason, rsi_val=rsi_now, barrier=barrier)
        active_contract = {"direction": direction, "entry_price": price, "barrier": barrier}
        log_trade_signal(direction, srsi_now, rsi_now, reason, price, barrier)
        if DRY_RUN:
            print(f"  {DIM}[DRY RUN] Would place {direction} trade with barrier {barrier}{RST}")
        else:
            await place_trade(ws, direction, barrier)
        return now

    return last_trade_time


# ============ TRADING LOOP ============

async def get_ws_url():
    global WS_URL
    use_bridge = USE_BRIDGE
    if use_bridge:
        try:
            WS_URL = await get_ws_url_via_bridge()
            return WS_URL
        except Exception as e:
            print(f"  {RED}X Bridge failed: {e}{RST}")
            if not PAT_TOKEN:
                print(f"  {RED}No PAT_TOKEN for fallback. Exiting.{RST}")
                return None
            print(f"  {YLW}> Falling back to PAT mode...{RST}")
    try:
        acc_data = await get_accounts()
        acc_id = select_account(acc_data)
        if not acc_id:
            print(f"  {RED}X No matching {ACCOUNT_TYPE} account found{RST}")
            return None
        print(f"  {GRN}+{RST} Account: {BLD}{acc_id}{RST} ({ACCOUNT_TYPE})")
        WS_URL = await get_otp_url(acc_id)
        return WS_URL
    except Exception as e:
        print(f"  {RED}X PAT auth error: {e}{RST}")
        return None


async def subscribe_ws(ws):
    if ("binaryws.com" in WS_URL or "otp" not in WS_URL) and PAT_TOKEN:
        await ws.send(json.dumps({"authorize": PAT_TOKEN}))
        auth_resp = json.loads(await ws.recv())
        if "error" in auth_resp:
            print(f"  {RED}X Auth failed: {auth_resp["error"]}{RST}")
            return False
        print(f"  {GRN}+{RST} Authenticated")
    await ws.send(json.dumps({"ticks": SYMBOL, "subscribe": 1}))
    await ws.send(json.dumps({"balance": 1, "subscribe": 1}))
    print(f"  {GRN}+{RST} Subscribed to {SYMBOL}")
    # Re-subscribe to active contract POC if we have one
    if _active_contract_id:
        print(f"  {YLW}> Re-subscribing to active contract {_active_contract_id}...{RST}")
        await ws.send(json.dumps({"proposal_open_contract": 1, "contract_id": _active_contract_id, "subscribe": 1}))
    print(f"  {DIM}{"-"*60}{RST}")
    print(f"  {DIM}Watching for L-shape signals on RAW StochRSI...{RST}")
    print(f"  {DIM}{"-"*60}{RST}")
    print()
    return True


async def handle_message(ws, data, last_trade_time):
    # Debug: log non-tick messages
    _mt = data.get("msg_type", "?")
    if _mt not in ("tick", "balance", "ping"):
        print(f"  {DIM}[MSG] msg_type={_mt}{RST}")
    global pending_proposal
    global active_contract, _active_contract_id, _active_contract_snapshot, _last_displayed_cid
    if data.get("msg_type") == "tick":
        tick = data.get("tick", {})
        if tick:
            result = await process_tick(ws, tick, last_trade_time)
            if isinstance(result, (int, float)):
                return result
    elif data.get("msg_type") == "proposal":
        prop = data.get("proposal", {})
        if "error" in data:
            print(f"  {RED}X PROPOSAL ERROR: {data["error"]}{RST}")
            reset_active_contract()
        elif prop and pending_proposal:
            pid = prop.get("id")
            payout_val = float(prop.get("payout", 0) or 0)
            if pid:
                # === PAYOUT FILTER: Skip if payout too high (market says trade will lose) ===
                if payout_val > MAX_PAYOUT:
                    print(_skip("payout", f"  {YLW}! SKIPPED: Payout ${payout_val:.2f} > ${MAX_PAYOUT:.2f} limit - market thinks trade will lose{RST}"))
                    reset_active_contract()
                    _active_contract_id = None
                    return last_trade_time
                buy_req = {"buy": pid, "price": STAKE}
                print(f"  {DIM}[BUY] proposal={pid} price={STAKE} payout=${payout_val:.2f}{RST}")
                pending_proposal["entry_price"] = prop.get("spot", active_contract["entry_price"] if active_contract else 0)
                await ws.send(json.dumps(buy_req))
            else:
                print(f"  {RED}X No proposal_id in response{RST}")
                reset_active_contract()
    elif data.get("msg_type") == "buy":
        buy = data.get("buy", {})
        if "error" in data:
            print(f"  {RED}X BUY ERROR: {data["error"]}{RST}")
            reset_active_contract()
        elif buy:
            cid = buy.get("contract_id", "?")
            cost = buy.get("buy_price", "?")
            payout = buy.get("payout", "?")
            direction = active_contract["direction"] if active_contract else (pending_proposal["direction"] if pending_proposal else "?")
            if active_contract:
                active_contract["contract_id"] = cid
            elif pending_proposal:
                active_contract = {"direction": direction, "entry_price": pending_proposal.get("entry_price", 0), "contract_id": cid, "barrier": pending_proposal.get("barrier", BARRIER_HIGHER)}
            pending_proposal = None
            _active_contract_id = cid
            _active_contract_snapshot = dict(active_contract) if active_contract else None
            print_trade_placed(cid, direction, cost, payout)
            await ws.send(json.dumps({"proposal_open_contract": 1, "contract_id": cid, "subscribe": 1}))
            print(f"  {DIM}[DEBUG] Sent POC subscribe for contract {cid}{RST}")
    elif data.get("msg_type") == "proposal_open_contract":
        poc = data.get("proposal_open_contract", {})
        if poc:
            print(f"  {DIM}[POC] keys={list(poc.keys())} status={poc.get(chr(115)+chr(116)+chr(97)+chr(116)+chr(117)+chr(115), chr(63))} is_sold={poc.get(chr(105)+chr(115)+chr(95)+chr(115)+chr(111)+chr(108)+chr(100), chr(63))} profit={poc.get(chr(112)+chr(114)+chr(111)+chr(102)+chr(105)+chr(116), chr(63))}{RST}")
            status = poc.get("status", "")
            profit = poc.get("profit", 0)
            entry = poc.get("entry_tick", 0)
            exit_p = poc.get("exit_tick", 0)
            cur = poc.get("current_spot", poc.get("current_tick", 0))
            total = poc.get("tick_count", DURATION)
            cid = poc.get("contract_id", "?")
            is_sold = status in ("expired", "sold", "won", "lost", "cancelled") or poc.get("is_sold") == 1 or poc.get("is_expired") == 1
            if is_sold and poc.get("exit_spot") is not None and _last_displayed_cid != cid:
                direction = "?"
                entry_price = entry
                ctx = active_contract
                if ctx is None and _active_contract_snapshot and _active_contract_snapshot.get("contract_id") == cid:
                    ctx = _active_contract_snapshot  # Contract recovered after reconnect
                if ctx:
                    direction = ctx.get("direction", "?")
                    entry_price = ctx.get("entry_price") or entry
                if ctx and direction != "?":
                    barrier_val = ctx.get("barrier", BARRIER_HIGHER)
                else:
                    barrier_val = BARRIER_HIGHER if direction == "higher" else (BARRIER_LOWER if direction == "lower" else "0.23")
                print(f"  {DIM}[POC] status={status} profit={profit} cid={cid}{RST}")
                try:
                    profit_f = float(profit)
                    entry_f = float(entry_price) if entry_price else 0
                    exit_f = float(exit_p) if exit_p else 0
                    print_trade_result_analyzed(status, profit_f, entry_f, exit_f, direction, cid, barrier_val, poc)
                    log_trade_result(cid, status, profit_f, entry_f, exit_f,
                                     float(poc.get("payout", 0) or 0), stats["balance"])
                except Exception as e:
                    print(f"  {RED}X Trade result error: {e}{RST}")
                    print(f"  {DIM}  status={status} profit={profit} entry={entry_price} exit={exit_p}{RST}")
                reset_active_contract()
                _active_contract_id = None
                _active_contract_snapshot = None
                _last_displayed_cid = cid
                last_trade_time = time.time()
            elif status == "open" and total:
                direction = active_contract["direction"] if active_contract else (_active_contract_snapshot.get("direction", "?") if _active_contract_snapshot else "?")
                barrier_val = BARRIER_HIGHER if direction == "higher" else BARRIER_LOWER
                print_trade_progress(cur, total, entry, barrier_val)
    elif data.get("msg_type") == "balance":
        bal = data.get("balance", {})
        print_balance(bal.get("balance", "?"))
    elif data.get("msg_type") == "ping":
        await ws.send(json.dumps({"pong": 1}))
    return last_trade_time



async def keepalive_ping(ws):
    """Send periodic pings to keep the WebSocket connection alive."""
    while True:
        try:
            await asyncio.sleep(PING_INTERVAL)
            await ws.send(json.dumps({"ping": 1}))
        except Exception:
            break  # Connection is dead, stop pinging

async def run_session():
    """Run one WebSocket session with keepalive ping."""
    global active_contract, _reconnect_count

    url = await get_ws_url()
    if not url:
        return False

    async with websockets.connect(url) as ws:
        if not await subscribe_ws(ws):
            return False

        # Reset reconnect counter on successful connection
        _reconnect_count = 0

        # Start keepalive ping task
        ping_task = asyncio.create_task(keepalive_ping(ws))

        try:
            last_trade_time = 0
            async for msg in ws:
                data = json.loads(msg)
                result = await handle_message(ws, data, last_trade_time)
                if isinstance(result, (int, float)):
                    last_trade_time = result
        finally:
            ping_task.cancel()
            try:
                await ping_task
            except asyncio.CancelledError:
                pass

    return True


async def trading_loop():
    global _reconnect_count, active_contract, _exit_reason
    print_header()
    print(f"  {CYN}>{RST} Authenticating...")
    while _reconnect_count < MAX_RECONNECT_ATTEMPTS:
        try:
            success = await run_session()
            if not success:
                return
            _reconnect_count += 1
            delay = min(RECONNECT_BASE_DELAY * (2 ** (_reconnect_count - 1)), 60)
            print(f"  {YLW}> Connection closed. Reconnecting in {delay}s (attempt {_reconnect_count}/{MAX_RECONNECT_ATTEMPTS})...{RST}")
            reset_active_contract()
            reset_l_state()
            await asyncio.sleep(delay)
        except (websockets.exceptions.ConnectionClosed,
                websockets.exceptions.ConnectionClosedError,
                ConnectionError, OSError) as e:
            _reconnect_count += 1
            delay = min(RECONNECT_BASE_DELAY * (2 ** (_reconnect_count - 1)), 60)
            print(f"  {RED}X Connection error: {e}{RST}")
            print(f"  {YLW}> Reconnecting in {delay}s (attempt {_reconnect_count}/{MAX_RECONNECT_ATTEMPTS})...{RST}")
            reset_active_contract()
            reset_l_state()
            await asyncio.sleep(delay)
        except Exception as e:
            print(f"  {RED}X Unexpected error: {e}{RST}")
            import traceback
            traceback.print_exc()
            _reconnect_count += 1
            delay = min(RECONNECT_BASE_DELAY * (2 ** (_reconnect_count - 1)), 60)
            print(f"  {YLW}> Reconnecting in {delay}s...{RST}")
            reset_active_contract()
            reset_l_state()
            await asyncio.sleep(delay)
    _exit_reason = "max_reconnects"
    print(f"  {RED}X Max reconnection attempts ({MAX_RECONNECT_ATTEMPTS}) reached. Exiting.{RST}")


async def replay_loop():
    print_header()
    print(f"  {CYN}>{RST} Replay mode: loading {REPLAY_FILE}...")
    with open(REPLAY_FILE, "r") as f:
        data = json.load(f)
    recorded = data.get("ticks", [])
    if not recorded:
        print(f"  {RED}X No ticks in {REPLAY_FILE}{RST}")
        return
    print(f"  {GRN}+{RST} Loaded {len(recorded)} ticks | Speed: {REPLAY_SPEED}x | Stake: ${STAKE}")
    print("  " + "-" * 60)
    bt = {"ticks": 0, "signals": 0, "trades": 0, "wins": 0, "losses": 0, "pnl": 0.0, "last_trade": 0}
    delay = 0.05 / REPLAY_SPEED
    for tick in recorded:
        bt["ticks"] += 1
        await process_tick_replay({"quote": tick["quote"], "epoch": tick.get("epoch", 0)}, bt)
        if delay > 0:
            await asyncio.sleep(delay)
    save_recording()
    print_backtest_results(bt)


async def process_tick_replay(tick_data, bt):
    global _tick_count, _in_cooldown, active_contract
    _tick_count += 1
    price = tick_data["quote"]
    closes.append(price)
    tick_history.append(price)
    print_tick(price, _tick_count)
    rsi = calc_rsi(list(closes), RSI_PERIOD)
    if rsi is not None:
        rsi_vals.append(rsi)
        stochrsi = calc_stochrsi(list(rsi_vals), STOCH_PERIOD)
        if stochrsi is not None:
            stochrsi_vals.append(stochrsi)
            k = sma(list(stochrsi_vals), K_SMOOTH)
            d = sma(list(stochrsi_vals), D_SMOOTH) if len(stochrsi_vals) >= D_SMOOTH else k
            if k is not None: k_vals.append(k)
            if d is not None: d_vals.append(d)
    print_dashboard()
    if len(stochrsi_vals) < 2 or active_contract:
        return
    now = time.time()
    if now - bt.get("last_trade", 0) < (DURATION + 2):
        return
    srsi_now = stochrsi_vals[-1]
    srsi_prev = stochrsi_vals[-2]
    result = detect_l_shape(srsi_now, srsi_prev)
    if result:
        direction, reason = result
        bt["signals"] += 1
        print_signal(direction, srsi_now, reason, rsi_val=rsi_now, barrier=_calc_barrier(direction, rsi_now))
        entry = price
        barrier = _calc_barrier(direction, rsi_now)
        bv = float(barrier)
        print(f"  {YLW}[SIM] {direction.upper()} at {entry:.4f} barrier {barrier}{RST}")
        active_contract = {"direction": direction, "entry_price": entry}
        exit_p = entry + bv * 0.5
        won = (exit_p > entry) if direction == "higher" else (exit_p < entry)
        profit = STAKE * 0.9 if won else -STAKE
        bt["trades"] += 1
        if won: bt["wins"] += 1
        else: bt["losses"] += 1
        bt["pnl"] += profit
        bt["last_trade"] = time.time()
        rc = GRN if won else RED
        txt = "WIN" if won else "LOSS"
        print(f"  {rc}[SIM] {txt} | Entry: {entry:.4f} | Exit: {exit_p:.4f} | P&L: ${profit:+.2f}{RST}")
        active_contract = None

if __name__ == "__main__":
    if args.history:
        _history_mode = True
        print_header()
        if args.trim and not args.max_sessions:
            print(f"  {RED}X --trim requires --max-sessions N{RST}")
        elif args.max_sessions is not None and args.max_sessions < 1:
            print(f"  {RED}X --max-sessions must be at least 1{RST}")
        elif args.since and not args.stats:
            print(f"  {RED}X --since requires --stats (band analysis){RST}")
        else:
            print(f"  {CYN}>{RST} Session history from {TRADE_LOG_FILE}{RST}")
            try:
                from view_trade_log import print_history, trim_sessions
                if args.trim:
                    trim_sessions(TRADE_LOG_FILE, args.max_sessions)
                print_history(TRADE_LOG_FILE, max_sessions=args.max_sessions)
            except ImportError:
                print(f"  {RED}X view_trade_log.py not found - cannot render session history{RST}")
            except Exception as e:
                print(f"  {RED}X Could not show session history: {e}{RST}")
                print(f"  {DIM}Run the bot once and let it exit to start recording sessions.{RST}")
            if args.stats:
                print()
                try:
                    from analyze_trade_log import print_analysis
                    print_analysis(TRADE_LOG_FILE, since=args.since)
                except ImportError:
                    print(f"  {RED}X analyze_trade_log.py not found - cannot run band analysis{RST}")
    else:
        try:
            if args.replay:
                asyncio.run(replay_loop())
            else:
                asyncio.run(trading_loop())
        except KeyboardInterrupt:
            print(f"\n\n  {YLW}Bot stopped by user{RST}", flush=True)
            _exit_reason = "user_stop"
            record_session_end()
            # Force save trade log and recording (atexit may not fire on Windows)
            try:
                save_trade_log()
                save_recording()
            except Exception:
                pass
            # Always print session summary (even with zero settled trades)
            if stats["trades"] > 0:
                wr = stats["wins"] / stats["trades"] * 100
                rc = GRN if stats["total_pnl"] >= 0 else RED
                print(f"  {DIM}Session:  {stats['trades'] + stats['cancelled']} trades  |  {GRN}{stats['wins']}W{RST} {RED}{stats['losses']}L{RST} {YLW}{stats['cancelled']}C{RST}  |  WR: {wr:.0f}%  |  PnL: {rc}${stats['total_pnl']:+.2f}{RST}")
            else:
                print(f"  {DIM}No trades placed this session{RST}")
                if _trade_log:
                    print(f"  {DIM}Trade log saved to {TRADE_LOG_FILE}{RST}")
            print(flush=True)
