# Changelog

Notable changes to both trading products in this repository, each tracked with its own version history:

- **Bots** - the Deriv STOCHRSI L-Shape Python trading bots (`Deriv-Stochrsi-Video-Bot.py`, `Deriv-Stochrsi-SloppyL-Soft.py`) and their analysis tooling (`view_trade_log.py`, `analyze_trade_log.py`)
- **Web App** - the DTrader Options Terminal Next.js web trader, including its trading WebSocket reliability & diagnostics work

## Latest Releases

| Product | Latest | Full history |
|---|---|---|
| **Bots** | [v3.2 - Reliability, Session History & Filter Hardening (2026-09-03)](#v32---reliability-session-history--filter-hardening-2026-09-03) | [Bots](#bots) |
| **Web App** | [Web v1.1 - Notifications, Price Alerts & Result Polish (2026-09-03)](#web-v11---notifications-price-alerts--result-polish-2026-09-03) | [Web App](#web-app) |

---

## Bots

### v3.2 - Reliability, Session History & Filter Hardening (2026-09-03)

#### New Features

- **SloppyL-Soft bot** (`Deriv-Stochrsi-SloppyL-Soft.py`) - softer L-shape variant with enhanced filters
- **RSI floor for LONG signals** - `--rsi-long-min` / `SOFT_RSI_LONG_MIN` (default 20) skips knife-catching oversold longs (logged RSI<20 longs were 0W/3L, while 20-30 was 5W/0L)
- **Per-run session records** in `trade_log.json` - start time, duration, exit reason, settled trades, win rate, PnL
- **`--history` flag** on both bots - prints saved session records and exits without trading
- **`--trim` / `--max-sessions`** - limit the display or trim old session records
- **`view_trade_log.py`** - session-history viewer with `--stats` for combined history + band analysis
- **`analyze_trade_log.py`** - repeatable band analysis: overall WR, LONG/SHORT loss rates by RSI/SRSI band, after-loss behavior, SHORT misfire watch, `--since` post-restart window
- **`--stats` / `--since`** forwarded through both bots' `--history` - one command shows history plus analysis
- **Skip reasons + market stats** captured in session records, so every skipped signal is auditable

#### Bug Fixes

- **LOWER contract barrier sign** - barrier for LOWER trades now computed with the correct sign (was inverted, making LOWER wins much harder)
- **Loss-streak circuit breaker now actually engages** - main bot pauses after the first loss with a 60s cooldown
- **Soft bot loss policy tightened** - same first-loss pause applied by default
- **SRSI peak check fixed in the main bot** - flat-extreme context is now captured *before* `reset_l_state()`, so SHORT signals (overbought flat >= 0.90) are actually evaluated instead of silently skipped
- **`--account` flag** now selects real/demo correctly; shutdown saves trades
- **Open-contract settlement recovered after reconnect** - POC re-subscription restored after a WebSocket drop

---

### v3.1 - Strategy Filters + Trade Logging (2026-09-02)

#### New Features

- **6 configurable strategy filters** to maximize win rate
- **Entry delay confirmation** - waits 2 ticks for price confirmation before placing trade
- **Adaptive barrier offset** - adjusts barrier width based on signal strength (RSI)
- **Local trade log** - saves every trade with full signal context to `trade_log.json`
- **Summary stats** in trade log (total trades, win rate, PnL, streaks)
- **All filter thresholds configurable** via CLI args and environment variables
- **atexit handler** - gracefully saves trade log and recording on bot shutdown

#### Strategy Filters Added

| # | Filter | CLI Arg | Default | Purpose |
|---|--------|---------|---------|---------|
| 1 | Circuit Breaker | `--max-loss-streak` | 2 | Stop after N consecutive losses |
| 2 | RSI Alignment | `--rsi-long-max` / `--rsi-short-min` | 35 / 75 | RSI must be in extreme zones |
| 3 | SRSI Peak Check | `--srsi-short-peak` / `--srsi-long-peak` | 0.90 / 0.10 | SRSI must reach extremes during flat |
| 4 | Reversal Confirmation | `--reversal-ticks` | 3 | Consecutive ticks in trade direction |
| 5 | Adaptive Flat Cap | `--adaptive-flat-max` / `--adaptive-breakout-min` | 8 / 0.20 | Stronger breakout for stale signals |
| 6 | Price Direction | `--price-dir-min` | 3 | Price momentum must align |

#### New CLI Args

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

#### Bug Fixes

- **exit_spot always 0.0000** - Now reads `entry_spot`/`exit_spot` from POC settlement messages (falls back to `entry_tick`/`exit_tick`)
- **Duplicate trade display** - Tracks `_last_displayed_cid` to prevent showing the same trade result twice
- **First POC has no entry/barrier** - Only triggers display on `audit_details` messages with valid non-zero `exit_spot`
- **Active contract ID lost on reconnect** - Now saves `_active_contract_id` on buy success for POC re-subscription
- **Infinite crash loop on POC error** - Try/except wrapper ensures `_active_contract_id = None` even if display function crashes

#### Internal Changes

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

### v3.0 - Raw StochRSI Detection (2026-08-28)

#### Changes

- Replaced SMA(3)-smoothed K detection with **raw StochRSI** detection
- Added L-shape state machine (IDLE -> SLOPE -> FLAT -> READY -> SIGNAL)
- Added auto-reconnection with exponential backoff (max 10 attempts)
- Added keepalive ping every 30 seconds
- Added rich terminal UI with spark charts and detection phases
- Added dry-run mode (`--dry-run`)
- Added record/replay mode (`--record`/`--replay`)
- Added CLI arguments for symbol, stake, duration, barriers, account type

#### Detection Parameters

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

### v2.0 - Enhanced CLI (2026-08-26)

#### Changes

- Added PAT token authentication mode (standalone, no web app needed)
- Added Bridge mode (shares web app OAuth session)
- Added rich terminal output with ANSI colors
- Added balance tracking and session statistics

---

### v1.0 - Initial Bot (2026-08-24)

#### Changes

- Basic bot with SMA(3)-smoothed K detection
- Deriv WebSocket connection
- Trade placement and result tracking
- Bridge endpoint for OAuth authentication

---

## Web App

The **DTrader Options Terminal** Next.js web trader - workspace UI, chart, trade ticket, and the authenticated Deriv trading WebSocket. Its reliability work is documented in detail in [`docs/web-ws-reliability.md`](web-ws-reliability.md).

### Web v1.1 - Notifications, Price Alerts & Result Polish (2026-09-03)

- **Notification feed persistence** - the bell panel, unread state, and timestamps now survive page refreshes via localStorage (`dtrader_notifications`), without replaying old notifications as toasts

- **Balance-change notifications** - watched on the live balance stream (own-trade deltas suppressed) and pushed with the delta and new balance
- **Price alerts** - one-shot, per-market levels that fire when price crosses on any live or simulated tick, managed from the Settings tab and persisted locally
- **Notification settings** - the Settings tab gains working toggles for trade results, balance changes, price alerts, risk warnings, and sound & vibration

- **Resolved digit colored by outcome** - the exit-digit ring on the digit strip pulses green on wins and red on losses, matching the chart markers

---

### Web v1.0 - Trading WebSocket Reliability & Diagnostics (2026-09-03)

#### New Features

- **Persistent status banner** across the workspace showing trading-socket state (live / reconnecting with attempt N/10 / offline)
- **Drop diagnostics** - every socket close (code, reason, duration, in-flight requests) logged to a localStorage ring buffer
- **Server-side drop log** - batched, rate-limited `/api/diag` endpoint writing `data/ws-drops.jsonl`
- **Stale watchdog** - proactively closes and reconnects when no WS message arrives for 45s (tunable via `NEXT_PUBLIC_WS_STALE_MS`)

#### Bug Fixes

- **Reconnect race** - connection-generation guard so stale sockets can't take over or reconnect over newer connections
- **Pending requests hung on disconnect** - proposals/buys now reject immediately when the socket closes
- **No pre-buy freshness check** - stale-proposal guard refuses expired proposals and re-subscribes; Buy disabled while not connected
- **Lost buy responses** - post-reconnect portfolio reconciliation recovers contracts accepted before the disconnect

#### Testing

- WebSocket lifecycle test suite (disconnect during proposal/buy, stale-socket reconnect races, lost buy responses, drop-log ring buffer, stale watchdog) - suite grew from 89 to 133 tests, `tsc --noEmit` clean

### Web v0.8 - Componentization, Hedge & Resolution Markers (2026-08-31)

- Trading terminal split into composable components managed through `TradingContext`
- One-click **Hedge** button auto-fills the opposite contract
- Resolution barrier line and trade tick countdown added to the chart (duration configurable)
- Historical trade resolution markers with hover tooltips (win/loss, digit, profit)
- Chart tooltip fixes, proposal reconnection on drop, and buy-button lag fix

---

### Web v0.7 - Trade Ticket & Connection Visibility (2026-08-30)

- Trade ticket rework: 7 UX enhancements, simplification, and buy-flow diagnostics
- Payout deflicker, sound/vibration feedback, stake confirmation, sell styling
- Live tick stream stabilized by splitting `ticks_history` from the `ticks` subscription
- Per-market WS connection status tracking with UI indicators
- Analyzer recommendations auto-fill the trade ticket; auto-trade interval made configurable

---

### Web v0.6 - Portfolio Accuracy & TradingView Charts (2026-08-29)

- Portfolio and profit table moved to the Core API v3 client-side WebSocket (fixes serverless/WS-pool crashes); fallback chain for trades with reduced settlement delay
- Payout amount flickering eliminated from the proposal subscription
- Transfer payloads matched to the actual Deriv schema (UUID `request_id`, platform-compatible preview)
- Trade result overlay converted from blocking modal to bottom toast; trade resolution marker with exit digit on chart
- SVG tick chart replaced with TradingView Lightweight Charts v5

---

### Web v0.5 - Centralized State & Performance (2026-08-28)

- Centralized `DerivContext` with React Query; portfolio dashboard migrated to query hooks with auto-refreshing balances
- Proposal subscription replaces request/response polling
- Trade placement critical path optimized for faster click response; proposal debounce cut from 250ms to 100ms
- Jittered exponential backoff with reconnect added across all React Query hooks (including the market analyzer)
- Shared formatting helpers, error boundaries, and desktop nav redesign with icons

---

### Web v0.4 - Trading Reliability & Auto-Trade (2026-08-27)

- Deriv-style chart with market search and wallet sub-accounts
- Tick stream reconnection; robust balances/trades APIs with loginId extraction from OAuth
- Auto-trade engine with configuration panel and UI toggle
- Instant trade placement with cached proposal fallback
- Wallet balances via the `account_list` WebSocket (replacing the broken REST API)

---

### Web v0.3 - Dashboards, Analyzer & v3 API Migration (2026-08-26)

- Wallet panel with multi-account balances and fund transfers
- Portfolio dashboard with P&L charts and trade analytics
- Risk management panel with stake limits and stop-loss controls
- Notification system with toast center
- Market Analyzer UI: TF.js training worker with epoch charts, confusion matrix, model comparison and auto-selection, IndexedDB persistence
- Trading terminal, Blockly bot execution, and UI integration
- Deriv endpoints migrated from the Options API to the v3 WebSocket API

---

### Web v0.2 - Workspace Expansion & Bot Builder (2026-08-25)

- Mobile-responsive UI overhaul with workspace navigation and WS stability
- Live tick chart with skeleton loader and real tick history
- WebSocket reconnect with jittered exponential backoff
- Payout-lag and stale-timeout fixes in the trade ticket
- Bot Builder: Blockly visual editor, XML bot import/export, 16-strategy template library, JS-Interpreter sandbox, strategy save/load, backtesting with tick replay
- Market Analyzer foundation with ML-based trade recommendations; OAuth-only login (PAT fallback removed)

---

### Web v0.1 - Initial Deriv Trading Pipeline (2026-08-24)

- Full Deriv trading pipeline with OAuth 2.0 login and account list
- Trading terminal with live ticks and trade placement; auth/session API routes
