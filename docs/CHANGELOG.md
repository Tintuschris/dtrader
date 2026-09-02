# Changelog

All notable changes to the Deriv STOCHRSI L-Shape Bot.

---

## v3.1 - Strategy Filters + Trade Logging (2026-09-02)

### New Features

- **6 configurable strategy filters** to maximize win rate
- **Entry delay confirmation** - waits 2 ticks for price confirmation before placing trade
- **Adaptive barrier offset** - adjusts barrier width based on signal strength (RSI)
- **Local trade log** - saves every trade with full signal context to `trade_log.json`
- **Summary stats** in trade log (total trades, win rate, PnL, streaks)
- **All filter thresholds configurable** via CLI args and environment variables
- **atexit handler** - gracefully saves trade log and recording on bot shutdown

### Strategy Filters Added

| # | Filter | CLI Arg | Default | Purpose |
|---|--------|---------|---------|---------|
| 1 | Circuit Breaker | `--max-loss-streak` | 2 | Stop after N consecutive losses |
| 2 | RSI Alignment | `--rsi-long-max` / `--rsi-short-min` | 35 / 75 | RSI must be in extreme zones |
| 3 | SRSI Peak Check | `--srsi-short-peak` / `--srsi-long-peak` | 0.90 / 0.10 | SRSI must reach extremes during flat |
| 4 | Reversal Confirmation | `--reversal-ticks` | 3 | Consecutive ticks in trade direction |
| 5 | Adaptive Flat Cap | `--adaptive-flat-max` / `--adaptive-breakout-min` | 8 / 0.20 | Stronger breakout for stale signals |
| 6 | Price Direction | `--price-dir-min` | 3 | Price momentum must align |

### New CLI Args

| Arg | Env Var | Default | Description |
|-----|---------|---------|-------------|
| `--max-loss-streak` | `FILTER_LOSS_STREAK_MAX` | 2 | Circuit breaker threshold |
| `--rsi-long-max` | `FILTER_RSI_LONG_MAX` | 35 | Max RSI for LONG signals |
| `--rsi-short-min` | `FILTER_RSI_SHORT_MIN` | 75 | Min RSI for SHORT signals |
| `--srsi-short-peak` | `FILTER_SRSI_SHORT_PEAK_MIN` | 0.90 | Min SRSI peak for SHORT |
| `--srsi-long-peak` | `FILTER_SRSI_LONG_PEAK_MAX` | 0.10 | Max SRSI trough for LONG |
| `--reversal-ticks` | `FILTER_REVERSAL_TICKS` | 3 | Reversal confirmation ticks |
| `--adaptive-flat-max` | `FILTER_ADAPTIVE_FLAT_MAX` | 8 | Stale signal flat threshold |
| `--adaptive-breakout-min` | `FILTER_ADAPTIVE_BREAKOUT_MIN` | 0.20 | Min breakout for stale signals |
| `--price-dir-min` | `FILTER_PRICE_DIR_MIN` | 3 | Min price momentum ticks |
| `--entry-delay` | `FILTER_ENTRY_DELAY` | 2 | Ticks to wait for confirmation |
| `--barrier-strong` | `BARRIER_STRONG` | -0.20 | Tight barrier for strong signals |
| `--barrier-weak` | `BARRIER_WEAK` | -0.30 | Wide barrier for weaker signals |

### Bug Fixes

- **exit_spot always 0.0000** - Now reads `entry_spot`/`exit_spot` from POC settlement messages (falls back to `entry_tick`/`exit_tick`)
- **Duplicate trade display** - Tracks `_last_displayed_cid` to prevent showing the same trade result twice
- **First POC has no entry/barrier** - Only triggers display on `audit_details` messages with valid non-zero `exit_spot`
- **Active contract ID lost on reconnect** - Now saves `_active_contract_id` on buy success for POC re-subscription
- **Infinite crash loop on POC error** - Try/except wrapper ensures `_active_contract_id = None` even if display function crashes

### Internal Changes

- Added `_l_flat_extreme` state variable to track SRSI peak/trough during flat zone
- Added `_pending_signal` queue for entry delay mechanism
- Added `_consecutive_losses` counter for circuit breaker
- Added `_trade_log` list for trade logging
- Added `_last_displayed_cid` for duplicate display prevention
- Added `save_trade_log()` function with summary stats computation
- Added `log_trade_signal()` and `log_trade_result()` functions
- Added `_calc_barrier()` function for adaptive barrier selection
- Modified `process_tick()` to handle pending signal queue
- Modified `handle_message()` to handle audit_details POC messages
- Modified `detect_l_shape()` to track flat extreme values
- Added `atexit.register(save_trade_log)` for graceful shutdown

---

## v3.0 - Raw StochRSI Detection (2026-08-28)

### Changes

- Replaced SMA(3)-smoothed K detection with **raw StochRSI** detection
- Added L-shape state machine (IDLE -> SLOPE -> FLAT -> READY -> SIGNAL)
- Added auto-reconnection with exponential backoff (max 10 attempts)
- Added keepalive ping every 30 seconds
- Added rich terminal UI with spark charts and detection phases
- Added dry-run mode (`--dry-run`)
- Added record/replay mode (`--record`/`--replay`)
- Added CLI arguments for symbol, stake, duration, barriers, account type

### Detection Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `RAW_LEVEL_LOW` | 0.20 | Oversold zone threshold |
| `RAW_LEVEL_HIGH` | 0.80 | Overbought zone threshold |
| `RAW_FLAT_LOOKBACK` | 3 | Minimum flat ticks |
| `RAW_FLAT_THRESHOLD` | 0.08 | Max variance during flat |
| `RAW_BREAKOUT_MIN` | 0.15 | Minimum single-tick reversal |
| `RAW_SLOPE_MIN` | -0.15 | Min downward slope |
| `RAW_SLOPE_MAX` | 0.15 | Min upward slope |

---

## v2.0 - Enhanced CLI (2026-08-26)

### Changes

- Added PAT token authentication mode (standalone, no web app needed)
- Added Bridge mode (shares web app OAuth session)
- Added rich terminal output with ANSI colors
- Added balance tracking and session statistics

---

## v1.0 - Initial Bot (2026-08-24)

### Changes

- Basic bot with SMA(3)-smoothed K detection
- Deriv WebSocket connection
- Trade placement and result tracking
- Bridge endpoint for OAuth authentication
