# Soft Bot Multi-Market Demo Runs

`run_soft_multi_demo.py` starts three independent demo-only Soft-bot workers:
Volatility 25 (`R_25`), Volatility 75 (`R_75`), and Volatility 100 (`R_100`).

Every worker has isolated state and files:

- `trade_log_soft_R_25.json`, `trade_log_soft_R_75.json`, or
  `trade_log_soft_R_100.json` stores its trade history.
- `logs/soft_<symbol>_<timestamp>.log` stores its terminal output.

The launcher terminal is intentionally a compact event board, not three
interleaved tick dashboards. It shows only confirmed placements and settlements:

```text
[20:31:27] R_75    PLACED  LOWER  #123456 | stake $1.00 | payout $1.14 | 5 ticks
[20:31:42] R_75    WON     LOWER  #123456 | P/L $+0.14 | exit 2746.9670 vs barrier 2747.6040 | gap -0.6370
```

The complete dashboard, indicator values, skips, and API details remain in the
matching file under `logs/` for troubleshooting.

The launcher forces `ACCOUNT_TYPE=demo` and `USE_BRIDGE=0`. The bot now fails
instead of silently selecting a mismatched account type when no demo account is
available for the supplied token.

Run it from Git Bash with the PAT token and Deriv app ID in the environment:

```bash
USE_BRIDGE=0 ACCOUNT_TYPE=demo PAT_TOKEN="YOUR_PAT_TOKEN" DERIV_APP_ID="YOUR_APP_ID" python run_soft_multi_demo.py
```

Use `--dry-run` to check live signals without purchasing demo contracts:

```bash
USE_BRIDGE=0 ACCOUNT_TYPE=demo PAT_TOKEN="YOUR_PAT_TOKEN" DERIV_APP_ID="YOUR_APP_ID" python run_soft_multi_demo.py --dry-run
```

Press `Ctrl+C` once in the launcher terminal to stop all workers. Review each
market independently with the main bot's `--history` option and the matching
`TRADE_LOG_FILE` value.

## 1-second Soft Bot

`Deriv-Stochrsi-SloppyL-Soft-1s.py` is a separate demo-only launch profile. It
uses the same strategy engine but defaults to Deriv's Volatility 100 (1s)
symbol, `1HZ100V`, and writes to `trade_log_soft_1s_1HZ100V.json`.
It does not inherit generic `SYMBOL` or `TRADE_LOG_FILE` values left by another
bot. Use `SOFT_1S_SYMBOL` or `SOFT_1S_TRADE_LOG_FILE` only when you need to
override those profile defaults without CLI options.

The profile also uses independent 1-second defaults: 10-tick duration, RSI and
StochRSI periods of 21, a 5-tick flat zone, stronger SRSI breakout thresholds
(`0.20` HIGHER / `0.25` LOWER), three-tick momentum confirmation, RSI
`30–48` for HIGHER, and RSI `65+` for LOWER. These are an experimental demo
profile, not a claim of profitability. Override any one with the matching
`SOFT_1S_<SETTING>` variable, for example `SOFT_1S_DURATION=5`.

```bash
USE_BRIDGE=0 ACCOUNT_TYPE=demo PAT_TOKEN="YOUR_PAT_TOKEN" DERIV_APP_ID="YOUR_APP_ID" python Deriv-Stochrsi-SloppyL-Soft-1s.py
```

To test another 1-second symbol, choose it explicitly. Its default trade log
will match that symbol:

```bash
USE_BRIDGE=0 ACCOUNT_TYPE=demo PAT_TOKEN="YOUR_PAT_TOKEN" DERIV_APP_ID="YOUR_APP_ID" python Deriv-Stochrsi-SloppyL-Soft-1s.py --symbol 1HZ25V
```

The 1-second profile refuses `--account real`. Its settings have not been
validated as profitable on 1-second markets; evaluate a separate demo log for
each symbol before changing the strategy or considering real-money use.
