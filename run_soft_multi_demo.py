"""Launch isolated Soft-bot demo workers for several Volatility indices.

Each worker has its own symbol, trade-history JSON, and terminal-output log.
The launcher deliberately forces demo mode and refuses to start without the
PAT credentials required by the existing PAT WebSocket flow.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path


DEFAULT_SYMBOLS = ("R_25", "R_75", "R_100")
ROOT = Path(__file__).resolve().parent
BOT = ROOT / "Deriv-Stochrsi-SloppyL-Soft.py"


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
        }
    )
    return env


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
    workers: list[subprocess.Popen[bytes]] = []
    handles = []

    try:
        for symbol in args.symbols:
            output_path = log_dir / f"soft_{symbol}_{stamp}.log"
            handle = output_path.open("wb")
            command = [sys.executable, "-u", str(BOT), "--symbol", symbol, "--account", "demo"]
            if args.dry_run:
                command.append("--dry-run")
            worker = subprocess.Popen(
                command,
                cwd=ROOT,
                env=worker_env(symbol),
                stdout=handle,
                stderr=subprocess.STDOUT,
            )
            handles.append(handle)
            workers.append(worker)
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
        for handle in handles:
            handle.close()

    failed = [worker for worker in workers if worker.returncode not in (None, 0)]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
