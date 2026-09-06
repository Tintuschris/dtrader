"""Demo-only 1-second-market profile for the Soft bot.

This keeps 1-second experiments independent from the standard Soft bot while
reusing the same tested strategy engine. It defaults to Deriv's 1HZ100V symbol
and a dedicated trade history file. Use --symbol to test another 1-second
market; its trade history file will be named for that symbol automatically.
"""

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / "Deriv-Stochrsi-SloppyL-Soft.py"


def requested_symbol(argv: list[str]) -> str:
    for index, arg in enumerate(argv):
        if arg.startswith("--symbol="):
            return arg.split("=", 1)[1]
        if arg in ("--symbol", "-s") and index + 1 < len(argv):
            return argv[index + 1]
    # Do not inherit a generic SYMBOL from another bot run. A 1-second profile
    # must start on its own documented default unless its CLI explicitly names
    # a market.
    return os.environ.get("SOFT_1S_SYMBOL", "1HZ100V")


def requests_real_account(argv: list[str]) -> bool:
    for index, arg in enumerate(argv):
        if arg == "--account" and index + 1 < len(argv):
            return argv[index + 1].lower() == "real"
        if arg.startswith("--account="):
            return arg.split("=", 1)[1].lower() == "real"
    return False


def has_option(argv: list[str], *names: str) -> bool:
    return any(arg == name or arg.startswith(name + "=") for arg in argv for name in names)


if not ENGINE.is_file():
    raise SystemExit(f"Soft bot engine not found: {ENGINE}")
if requests_real_account(sys.argv[1:]):
    raise SystemExit("The 1-second profile is demo-only. Remove --account real.")

symbol = requested_symbol(sys.argv[1:])
os.environ["USE_BRIDGE"] = "0"
os.environ["ACCOUNT_TYPE"] = "demo"
os.environ["SYMBOL"] = symbol
# One-second ticks are much noisier than the normal volatility feeds. Keep
# this profile independent by using a slower indicator, a longer contract,
# and stronger reversal confirmation. Every value remains overridable through
# the SOFT_1S_* environment variables for market-by-market experiments.
profile_defaults = {
    "DURATION": "10",
    "SOFT_RSI_PERIOD": "21",
    "SOFT_STOCH_PERIOD": "21",
    "SOFT_RAW_FLAT_LOOKBACK": "5",
    "SOFT_RAW_BREAKOUT_MIN": "0.20",
    "SOFT_SHORT_BREAKOUT_MIN": "0.25",
    "SOFT_MOMENTUM_CONFIRM_TICKS": "3",
    "SOFT_RSI_LONG_MAX": "48",
    "SOFT_RSI_LONG_MIN": "30",
    "SOFT_RSI_SHORT_MIN": "65",
}
for key, value in profile_defaults.items():
    os.environ[key] = os.environ.get("SOFT_1S_" + key, value)
# Do not inherit normal-market barrier exports. Explicit CLI barriers still
# win because argparse applies them after reading the environment defaults.
if not has_option(sys.argv[1:], "--barrier-higher"):
    os.environ["BARRIER_HIGHER"] = os.environ.get("SOFT_1S_BARRIER_HIGHER", "-0.40")
if not has_option(sys.argv[1:], "--barrier-lower"):
    os.environ["BARRIER_LOWER"] = os.environ.get("SOFT_1S_BARRIER_LOWER", "+0.40")
# Keep 1-second experiments independent even when the shell still exports a
# generic TRADE_LOG_FILE from a standard or multi-market run.
os.environ["TRADE_LOG_FILE"] = os.environ.get(
    "SOFT_1S_TRADE_LOG_FILE", f"trade_log_soft_1s_{symbol}.json"
)

sys.argv[0] = str(ENGINE)
runpy.run_path(str(ENGINE), run_name="__main__")
