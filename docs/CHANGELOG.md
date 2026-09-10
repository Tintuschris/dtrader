# Changelog

Notable changes to both trading products in this repository, each tracked with its own version history:

- **Bots** - the Deriv STOCHRSI L-Shape Python trading bots (`Deriv-Stochrsi-Video-Bot.py`, `Deriv-Stochrsi-SloppyL-Soft.py`) and their analysis tooling (`view_trade_log.py`, `analyze_trade_log.py`)
- **Web App** - the DTrader Options Terminal Next.js web trader, including its trading WebSocket reliability & diagnostics work

## Latest Releases

| Product | Latest | Full history |
|---|---|---|
| **Bots** | [v3.4.0 - Safety-First Adaptive Barrier & Risk Controls (2026-09-07)](#v340---safety-first-adaptive-barrier--risk-controls-2026-09-07) | [Bots](#bots) |
| **DigitBot** | [v1.4 - Shared DerivClient Transport + Smart Barrier (2026-09-11)](#deriv-digitbot--v14---shared-derivclient-transport--smart-barrier-2026-09-11) | [DigitBot v1.4](DIGITBOT-v1.4-CHANGES.md), [v1.3.1](DIGITBOT-v1.3.1-CHANGES.md) |
| **Web App** | [Web v1.5 - Proposal Stream Recovery (2026-09-07)](#web-v15---proposal-stream-recovery-2026-09-07) | [Web App](#web-app) |

---

## DigitBot

### Deriv DigitBot — v1.4 - Shared DerivClient Transport + Smart Barrier (2026-09-11)

DigitBot and the Soft StochRSI bot now share a single `DerivClient` transport
(auth, subscriptions, proposal → buy → POC settlement, keepalive, reconnect),
removing ~390 lines of duplicated plumbing across the two bots. Strategy and
logging behavior is otherwise unchanged by the refactor, with two fixes and
one new opt-in feature:

- **Over-side EV fix** in dynamic prediction: OVER barriers were scored
  against the UNDER base-win probability, mis-ranking every over trade.
- **`--smart-barrier`** (opt-in): instead of always trading over/under a fixed
  5, pick the barrier (3–7) whose winning-digit mass most exceeds the uniform
  baseline in the digit window, with Laplace shrinkage against small-sample
  noise. Skips trading entirely when no barrier clears the minimum edge
  (default 5%). Chosen barrier is recorded in the trade log for per-barrier
  analysis. Details and the v1.3 performance baseline:
  [DIGITBOT-v1.4-CHANGES.md](DIGITBOT-v1.4-CHANGES.md).

---

## Bots

### v3.4.0 - Safety-First Adaptive Barrier & Risk Controls (2026-09-07)

A major safety overhaul driven by real-account loss analysis. Two losing trades
on Sep 6 (Trade #19: falling knife LONG lost by 0.793 points; Trade #21:
near-miss SHORT lost by 0.086 points) motivated a full review of the barrier
system, stake sizing, and entry filtering.

#### New Features

- **Three-tier RSI barrier mapping** — replaces the 2-tier system with
  Extreme/Strong/Weak tiers:
  - Extreme (RSI ≤ 20 / ≥ 85): ±0.30 barrier (high-confidence signals)
  - Strong (RSI 20–30 / 75–85): ±0.40 barrier (solid signals)
  - Weak (RSI 30–35 / 65–75): ±0.50 barrier (wider safety margin)
  - All three tiers are fully configurable from CLI
  - Trade #21 (RSI=75.89, lost by 0.086) would have been saved with the
    Strong-tier +0.40 barrier (exit 2739.810 vs barrier 2739.024 = 0.786 margin)

- **Adaptive variance-based barrier multiplier** — replaces the fixed 1.5x
  barrier multiplier with a 4-tier system based on recent tick movement stdev:
  - Choppy (> 0.15 stdev): 2.0x — wide barrier, maximum room
  - Moderate (0.08–0.15): 1.7x — slightly wider
  - Normal (0.03–0.08): 1.5x — default
  - Calm (< 0.03): 1.2x — tighter barrier, better payout
  - The bot now logs every barrier decision with tier, base, and scaled values

- **Balance floor stake scaling** — dynamically reduces stake when account
  balance is low, preventing a depleted account from being wiped:
  - Balance ≥ $10: 100% stake (normal)
  - Balance ≥ $5: 70% stake
  - Balance ≥ $2: 50% stake
  - Balance ≥ $1: 40% stake
  - Balance < $1: configurable minimum (default $0.15, real-account safe)

- **Post-entry cooldown escalation** — increases cooldown between trades after
  consecutive losses, slowing down during unfavorable market conditions:
  - Each loss adds +0.5× to the cooldown multiplier (capped at 4.0×)
  - Each win resets to 1.0×
  - Progression: 7s → 10.5s → 14s → 17.5s → … → 28s (max)

- **Opposite-direction tick count gate** (filters 9a/9b) — new pre-entry micro
  and macro filter that counts how many recent ticks move against the trade:
  - Micro gate (last 5 ticks): blocks if ≥ 3 of 5 go against trade direction
  - Macro gate (last 10 ticks): blocks if ≥ 7 of 10 go against trade direction
  - Configurable via `--tick-gate-micro` / `--tick-gate-macro` and env vars
  - Trade #19 (falling knife LONG) would have been caught by the macro gate

- **CLI-configurable `--barrier-extreme`** — the Extreme tier barrier is no
  longer hardcoded; it can be set from the command line alongside `--barrier-strong`
  and `--barrier-weak`

- **CLI-configurable `--min-stake`** — replaces the hardcoded $0.15 minimum with
  a configurable floor. For real-account use: `--min-stake 0.35` preserves the
  full $0.35 stake at all balance levels

- **Session P&L halt** (`--max-session-loss`) — pauses trading for 5 minutes
  when cumulative session losses exceed the threshold, then resets the counter.
  Prevents extended bleeding during unfavorable market regimes

#### Updated Filter Chain (Video Bot)

The Video bot now has **10 filters** (up from 6):

| # | Filter | New? |
|---|--------|------|
| 1 | Loss-streak circuit breaker | |
| 2 | RSI trend alignment | |
| 3 | SRSI peak check | |
| 4 | 3-tick reversal confirmation | |
| 5 | Adaptive flat duration cap | |
| 6 | Price direction check | |
| 7 | Longer normalized trend against trade | |
| 8 | Strong trend + price drop spike check | |
| 9a | Micro tick count gate (5-tick) | ✅ |
| 9b | Macro tick count gate (10-tick) | ✅ |
| 10 | Session P&L halt | ✅ |

#### New CLI Args

| Arg | Env Var | Default | Description |
|-----|---------|---------|-------------|
| `--barrier-extreme` | `BARRIER_EXTREME` | 0.30 | Barrier for extreme RSI signals |
| `--min-stake` | `MIN_STAKE` | 0.15 | Minimum stake (balance floor) |
| `--max-session-loss` | `MAX_SESSION_LOSS` | 5.0 | Session loss halt threshold |
| `--tick-gate-micro` | `FILTER_TICK_GATE_MICRO` | 3 | Micro gate: opposite ticks in 5 |
| `--tick-gate-macro` | `FILTER_TICK_GATE_MACRO` | 7 | Macro gate: opposite ticks in 10 |

#### Commits

- `1b1240e` — adaptive barrier, balance guard, cooldown escalation, tick gate
- `ecc7539` — safety-first barrier tiers, min-stake CLI, session P&L halt
- `2789239` — recover stalled contract pricing

---

### Video bot recent-movement barrier scaling (2026-09-06)

- Added bounded, recent-tick movement scaling for the normal `R_25` Video bot.
- The RSI-selected barrier remains the base; the bot uses the median absolute
  movement over the last 20 ticks multiplied by `1.5`, bounded to `0.20–0.45`.
- `HIGHER` keeps a negative offset and `LOWER` keeps a positive offset.
- Added fixed-mode and CLI/environment controls for demo calibration.
- The Sloppy-L signal and entry filters are unchanged. This change applies
  only to `Deriv-Stochrsi-Video-Bot.py`, not multi-market or 1-second bots.

### Video bot longer trend alignment protection (2026-09-06)

- Added a symmetric counter-trend protection for real-money Video-bot entries:
  it blocks short HIGHER bounces inside a broader downtrend and short LOWER
  dips inside a broader uptrend.
- The default window is 10 ticks, requiring at least 6 opposite-direction
  transitions and a net counter-move of 1.25 average tick movements.
- The movement threshold is normalized by each market's recent tick size rather
  than using a fixed raw-point threshold. Configure it with
  `FILTER_TREND_LOOKBACK`, `FILTER_TREND_MIN_OPPOSITE`, and
  `FILTER_TREND_MIN_NORMALIZED_MOVE`.

### Demo multi-market and 1-second launch profiles (2026-09-06)

- Added `run_soft_multi_demo.py`, which starts isolated, demo-only Soft-bot
  workers for `R_25`, `R_75`, and `R_100`. Each worker has a separate trade
  history JSON file and terminal-output log.
- Added `Deriv-Stochrsi-SloppyL-Soft-1s.py`, a demo-only 1-second-market
  profile that defaults to `1HZ100V` and writes to an independent log.
- Account selection now fails closed if the requested demo or real account type
  is unavailable; it no longer silently falls back to the first account.
- The multi-market launcher now presents a compact live event board for placed
  and settled contracts while preserving each worker's complete dashboard in
  its own log file.
- Fixed Soft-bot settlement-progress formatting when Deriv sends numeric fields
  as strings, preventing repeated worker reconnects during open contracts.
- The 1-second profile now has an independent slower/stricter experimental
  profile (10 ticks, 21-period indicators, stronger breakout and momentum
  confirmation) with `SOFT_1S_*` overrides.

### Barrier CLI normalization warning fix (2026-09-06)

- Barrier parsing now warns only when the typed value contains repeated or
  mixed leading signs that require normalization, such as `++35.00`,
  `--0.20`, or `+-0.23`.
- Clean inputs such as `+0.23`, `-0.23`, `35.00`, and `+35.00` are still
  formatted into Deriv-compatible signed values but no longer produce a
  misleading normalization warning.
- Empty, unparseable, and non-finite values retain their existing warnings and
  fallback behavior.

### Soft bot eased-entry follow-up (2026-09-06)

- The Soft bot defaults now match the tested eased configuration: RSI `30–48`
  for HIGHER signals, RSI `62+` for LOWER signals, and fixed barriers
  `-0.40/+0.40`.
- HIGHER signals require at least `0.12` raw SRSI breakout; LOWER signals use a
  stricter `0.15` minimum because weak SHORT reversals were the most fragile
  part of the eased four-hour run. Both thresholds remain configurable through
  `SOFT_RAW_BREAKOUT_MIN` and `SOFT_SHORT_BREAKOUT_MIN`.
- Settled trade analysis now prefers Deriv's absolute barrier from the settled
  contract payload and persists it as `result.barrier_level`, preventing a
  relative-offset reconstruction from hiding settlement discrepancies.

### v3.3 - Per-Bot Trade Logs & Append-Only History (2026-09-04)

#### New Features

- **Each bot writes to its own log file** - `trade_log_video.json` (Video bot) and `trade_log_soft.json` (Soft bot), overridable with `TRADE_LOG_FILE`, so the two bots no longer clobber each other's records
- **Append-only trade history** - `trades` now accumulates across runs instead of being replaced by the latest run; signals that never settle stay visible for reconciliation
- **Per-run session accuracy** - session records count and settle only their own run's trades (`signals` per run, results matched by run), and every trade/session/file is tagged with its bot
- **One-time migration** - the Video bot copies the old shared `trade_log.json` history into its new file on first start, so prior sessions are preserved

### v3.3.5 - Settlement Status Fix & SHORT Cohort Analyzer (2026-09-05)

#### Bug Fixes

- **Settlement status normalization** - Deriv can send intermediate settlement snapshots with a non-final status (e.g. "open") while profit/exit_spot are already final. Both bots now normalize any non-final status to the real outcome (won if profit >= 0, else lost), so a stuck "open" status doesn't drop the trade from all status-filtered counters

#### New Features

- **SHORT cohort analyzer** (`analyze_trade_log.py --short-cohorts`) - prints the SHORT cohort split by downs-at-entry (>=3/4 vs 2/4 of the last 4 ticks), the SHORT momentum-gate check. With `--since`, prints the pre-window baseline and the at/after window side by side - e.g. pass the gated bot's start time to compare the gated SHORTs against the pre-gate cohorts

### v3.3.4 - SHORT Momentum Gate (2026-09-05)

#### New Features

- **SHORT momentum gate** (`SOFT_SHORT_MOMENTUM_LOOKBACK` default 4, `SOFT_SHORT_MOMENTUM_MIN_DOWNS` default 0 = disabled) - a LOWER is only sold once the drop has momentum (>= `SOFT_SHORT_MOMENTUM_MIN_DOWNS` down-transitions in the last `SOFT_SHORT_MOMENTUM_LOOKBACK` before entry). Across the backfilled 71-trade demo sample, SHORTs entered with >= 3/4 downs ran 92.3% WR (+$1.76) vs 80.0% (-$0.16) at 2/4 - the only sub-breakeven SHORT regime. Disabled by default; enable by setting `SOFT_SHORT_MOMENTUM_MIN_DOWNS=3`
- New skip category `short_momentum_unconfirmed` feeds the existing skip/session stats

### v3.3.3 - LONG Entry Quality Gates (2026-09-05)

#### New Features

- **LONG RSI floor raised 20 -> 30** (`SOFT_RSI_LONG_MIN`) - the RSI 20-30 bucket ran 60% WR / -$1.31 across the backfilled 71-trade demo sample; the floor now skips that knife-catching band
- **LONG dip-stall gate** (`SOFT_LONG_STALL_LOOKBACK` default 4, `SOFT_LONG_STALL_MAX_DOWNS` default 1) - a LONG is only bought once the dip has stopped falling (<= 1 down-tick in the last 4 before entry). Historical LONGs entered with <= 1 down ran 84.6% WR vs 68.2% at 2-of-4; disable by setting `SOFT_LONG_STALL_MAX_DOWNS` >= lookback (e.g. 99)
- New skip category `long_dip_not_stalled` feeds the existing skip/session stats

### v3.3.2 - Exit-Spot Settlement Analysis Fix (2026-09-04)

#### Bug Fixes

- **SloppyL-Soft bot now records and displays the real exit spot** - Deriv's settlement messages carry the final price as `exit_spot`, but the Soft bot only read `exit_tick` (a field the OTP endpoint does not send), so every banner and log row showed `Exit spot: 0.0000` and losses printed a bogus `Lost by: <barrier> (99.99%)` gap. The analyzer and settlement handler now read `entry_spot`/`exit_spot` first (falling back to `*_tick`), matching the Video bot
- **No more premature loss banners** - a contract that just hit `is_expired` can send an intermediate snapshot whose `exit_spot` is still `0.0`; the Soft bot analyzed it and reported a fake ~100% loss. Settlements are now only analyzed when the message carries `audit_details` and a real `exit_spot > 0`, so the true "last tick vs barrier" gap is shown instead

### v3.3.1 - Keepalive & Error Logging Fix (2026-09-04)

#### Bug Fixes

- **30-second `UnrecognisedRequest` error loop fixed** - Deriv's OTP endpoint answers the bots' keepalive `{"ping": 1}` with `msg_type: "ping"` (a pong tagged as a ping). Both bots misread that reply as a server-initiated ping and answered with an unsolicited `{"pong": 1}`, which Deriv rejected with an `UnrecognisedRequest` error every `PING_INTERVAL` seconds. Pongs are now sent only for genuine server pings (no `echo_req`)
- **API errors now log code + message** - generic API errors print as `API ERROR [code]: message` instead of a bare `msg_type=error` line
- **Keepalive hardened against dead connections** - a failed keepalive send is now logged and retried every `PING_INTERVAL` instead of silently stopping the ping loop; after `PING_MAX_FAILURES` (3) consecutive failures the connection is closed so the session's reconnect logic takes over

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

### Web v1.5 - Proposal Stream Recovery (2026-09-07)

- Added a proposal-specific watchdog that refreshes payout pricing when the
  WebSocket is alive but the proposal stream has gone stale.
- Failed proposal sends and proposal errors now leave loading state cleanly and
  trigger recovery instead of leaving the Buy button disabled indefinitely.
- Added a manual `Refresh price` action when the connection is live but fresh
  contract pricing is unavailable.
- Buy remains disabled until a fresh proposal is received, preventing stale or
  incorrectly priced purchases.
- If repeated proposal refreshes fail while the socket still appears connected,
  the authenticated trading socket is now reconnected automatically.
- The chart feed label now uses the same tick-stream status as the workspace
  header, preventing contradictory “LIVE TICKS” and “Simulated feed” labels.
- Set the default trade ticket to 1 tick and `$1.00` stake.
- Added a 20-tick duration option; all ticket durations now use the selected
  value consistently when requesting and buying a contract.

### Web v1.4 - Settlement Details & Next-Trade Refresh (2026-09-03)

#### Trade results

- Preserve Deriv's exact entry and exit quotes through the settlement result model.
- Calculate and display the actual resolved digit from the settlement quote.
- Show settlement digit and quote in the result popup, trade notification, recent-trade history, and chart markers.
- Stop using the latest unrelated market tick as a substitute for the contract's exit tick.

#### Post-trade reliability

- Clear the settled proposal immediately and request one clean replacement proposal for the next trade.
- Prevent repeated final contract messages from repeatedly resetting proposal state and causing next-trade lag.
- Resolve generic Deriv buy errors immediately so the UI does not remain in “Placing Trade” until the timeout.
- Release one-tick trade controls immediately after settlement and start the next proposal refresh without the normal configuration debounce.

#### Scanner and notification polish

- Keep the floating scanner pill above its backdrop and close the scanner when the user clicks outside it.
- Auto-dismiss trade-result toasts in under one second while leaving other notification types readable.

---

### Web v1.3 - Mobile Scanner Alert Reliability (2026-09-03)

#### Notifications and trade safety

- Faster compact/mobile scanner alert batching (about 450ms) keeps notifications responsive without showing one toast per rapidly changing tick.
- Actionable scanner toasts revalidate the selected Under 8/Over 1 condition against the latest market snapshot before opening the trade ticket.
- Expired conditions show a warning instead of loading a stale market recommendation.
- Proposal subscriptions clear the previous market/contract proposal while new parameters are being requested.
- Proposals are invalidated on disconnect/reconnect and cannot be bought until fresh pricing arrives.

#### Documentation

- Added the mobile batching, signal revalidation, and fresh-proposal behavior to `docs/SCANNER.md`.

---

### Web v1.1 - Notifications, Price Alerts & Result Polish (2026-09-03)

- **Notification feed persistence** - the bell panel, unread state, and timestamps now survive page refreshes via localStorage (`dtrader_notifications`), without replaying old notifications as toasts

- **Balance-change notifications** - watched on the live balance stream (own-trade deltas suppressed) and pushed with the delta and new balance
- **Price alerts** - one-shot, per-market levels that fire when price crosses on any live or simulated tick, managed from the Settings tab and persisted locally
- **Notification settings** - the Settings tab gains working toggles for trade results, balance changes, price alerts, risk warnings, and sound & vibration

- **Resolved digit colored by outcome** - the exit-digit ring on the digit strip pulses green on wins and red on losses, matching the chart markers

### Web v1.2 - Market Scanner Tracking & Alerts (2026-09-03)

- **Volatility market scanner** - continuously watches five Volatility 1s markets and identifies Under 8 / Over 1 conditions from exact live tick digits
- **Per-market danger thresholds** - choose below 10%, 8%, or 5% independently for each market; choices persist locally
- **Next-tick signal ledger** - records every qualifying signal and settles it against the actual next tick, showing wins, bets, hit rate, streak, and recent outcomes
- **Scanner backtest helper** - `simulateRuleHits()` replays the same incremental settle/re-arm semantics used by live tracking
- **Qualification alerts** - grouped toast and sound notifications for new rising-edge signals, with cooldown and persisted mute control
- **Focus-aware notifications** - scanner alerts wait while the scanner panel is open and deliver still-valid suppressed signals when it closes
- **Actionable alerts** - clicking a scanner toast loads the market and matching trade ticket; grouped alerts open the first listed signal
- **Toast burst protection** - the global visible toast stack is capped at four while notification history remains available in the notification center

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
