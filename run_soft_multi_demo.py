"""Launch isolated Soft-bot demo workers for several Volatility indices.

Each worker has its own symbol, trade-history JSON, and terminal-output log.
The launcher deliberately forces demo mode and refuses to start without the
PAT credentials required by the existing PAT WebSocket flow.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path


DEFAULT_SYMBOLS = ("R_25", "R_75", "R_100")
ROOT = Path(__file__).resolve().parent

# Per-market barrier and RSI profiles derived from loss analysis (Sep 6).
# R_75 needs a much larger barrier because its tick moves are 10-20 points;
# the old fixed +/-0.40 was meaningless at that scale.
# R_25 SHORT RSI raised from 62 to 68 because losses clustered at RSI 62-69.
# Breakout minimum raised from 0.12 to 0.20 to filter weak-signal losses.
# Barrier offsets removed - auto-calibration measures the market's tick size
# from live data and sets the barrier proportionally. RSI and breakout
# thresholds are still per-market because they depend on signal quality.
MARKET_PROFILES = {
    "R_25": {
        "SOFT_RSI_SHORT_MIN": "68",
        "SOFT_RAW_BREAKOUT_MIN": "0.20",
    },
    "R_75": {
        "SOFT_RSI_SHORT_MIN": "72",
        "SOFT_RAW_BREAKOUT_MIN": "0.25",
    },
    "R_100": {
        "SOFT_RSI_SHORT_MIN": "68",
        "SOFT_RAW_BREAKOUT_MIN": "0.20",
    },
}
BOT = ROOT / "Deriv-Stochrsi-SloppyL-Soft.py"
EVENT_PREFIX = "[BOT_EVENT] "


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run isolated Soft-bot workers on demo Volatility markets."
    )
    parser.add_argument(
        "--symbols",
        nargs="+",
        default=DEFAULT_SYMBOLS,
        help="Deriv symbols to run (default: R_25 R_75 R_100)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Detect signals without buying contracts.",
    )
    parser.add_argument(
        "--log-dir",
        default="logs",
        help="Directory for per-worker terminal output (default: logs).",
    )
    return parser.parse_args()


def require_credentials() -> None:
    missing = [name for name in ("PAT_TOKEN", "DERIV_APP_ID") if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing required environment variable(s): " + ", ".join(missing))


def worker_env(symbol: str) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "USE_BRIDGE": "0",
            "ACCOUNT_TYPE": "demo",
            "SYMBOL": symbol,
            "TRADE_LOG_FILE": f"trade_log_soft_{symbol}.json",
            "SOFT_EVENT_STREAM": "1",
        }
    )
    profile = MARKET_PROFILES.get(symbol, {})
    env.update(profile)
    return env


def parse_event(line: str) -> dict | None:
    """Return a worker lifecycle event without exposing its raw dashboard."""
    if not line.startswith(EVENT_PREFIX):
        return None
    try:
        event = json.loads(line[len(EVENT_PREFIX):])
    except json.JSONDecodeError:
        return None
    return event if isinstance(event, dict) else None


def display_number(value: object, decimals: int, signed: bool = False) -> str:
    try:
        return f"{float(value):{ '+' if signed else ''}.{decimals}f}"
    except (TypeError, ValueError):
        return "?"


def format_event(event: dict) -> str | None:
    symbol = str(event.get("symbol", "?"))
    kind = event.get("event")
    if kind == "placed":
        return (
            f"{symbol:<7} PLACED  {str(event.get('direction', '?')).upper():<6} "
            f"#{event.get('contract_id', '?')} | stake ${display_number(event.get('cost'), 2)} "
            f"| payout ${display_number(event.get('payout'), 2)} "
            f"| {event.get('duration_ticks', '?')} ticks"
        )
    if kind == "settled":
        outcome = str(event.get("outcome", "?")).upper()
        return (
            f"{symbol:<7} {outcome:<7} {str(event.get('direction', '?')).upper():<6} "
            f"#{event.get('contract_id', '?')} | P/L ${display_number(event.get('profit'), 2, signed=True)} "
            f"| exit {display_number(event.get('exit_spot'), 4)} "
            f"vs barrier {display_number(event.get('barrier_level'), 4)} "
            f"| gap {display_number(event.get('gap'), 4, signed=True)}"
        )
    return None


def mirror_worker_output(
    worker: subprocess.Popen[str], output_path: Path, terminal_lock: threading.Lock
) -> None:
    """Persist the full child dashboard while surfacing only lifecycle events."""
    assert worker.stdout is not None
    with output_path.open("w", encoding="utf-8", errors="replace") as output:
        for line in worker.stdout:
            output.write(line)
            output.flush()
            summary = format_event(parse_event(line) or {})
            if summary:
                with terminal_lock:
                    print(f"[{time.strftime('%H:%M:%S')}] {summary}", flush=True)


def stop_workers(workers: list[subprocess.Popen[bytes]]) -> None:
    # A Ctrl+C delivered by the shared terminal normally reaches every worker,
    # allowing its KeyboardInterrupt handler to save the session. Give that
    # graceful path a moment before using process termination as a fallback.
    graceful_deadline = time.monotonic() + 3
    while any(worker.poll() is None for worker in workers) and time.monotonic() < graceful_deadline:
        time.sleep(0.1)
    for worker in workers:
        if worker.poll() is None:
            worker.terminate()
    deadline = time.monotonic() + 8
    for worker in workers:
        if worker.poll() is None:
            try:
                worker.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                worker.kill()


def main() -> int:
    args = parse_args()
    require_credentials()
    if not BOT.is_file():
        raise SystemExit(f"Soft bot not found: {BOT}")

    log_dir = (ROOT / args.log_dir).resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    workers: list[subprocess.Popen[str]] = []
    readers: list[threading.Thread] = []
    terminal_lock = threading.Lock()

    try:
        for symbol in args.symbols:
            output_path = log_dir / f"soft_{symbol}_{stamp}.log"
            command = [sys.executable, "-u", str(BOT), "--symbol", symbol, "--account", "demo"]
            if args.dry_run:
                command.append("--dry-run")
            worker = subprocess.Popen(
                command,
                cwd=ROOT,
                env=worker_env(symbol),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            workers.append(worker)
            reader = threading.Thread(
                target=mirror_worker_output,
                args=(worker, output_path, terminal_lock),
                daemon=True,
            )
            reader.start()
            readers.append(reader)
            print(
                f"Started {symbol} (PID {worker.pid}) | "
                f"trade log: trade_log_soft_{symbol}.json | output: {output_path.relative_to(ROOT)}"
            )

        print("Demo workers are running. Press Ctrl+C once to stop all of them.")
        while any(worker.poll() is None for worker in workers):
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("Stopping all demo workers...")
        stop_workers(workers)
    finally:
        for reader in readers:
            reader.join(timeout=2)

    failed = [worker for worker in workers if worker.returncode not in (None, 0)]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
