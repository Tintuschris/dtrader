# Market Scanner

The market scanner watches the Volatility 1s markets and identifies two manual-trading conditions:

- **Under 8**: digits 8 and 9 are each below the selected danger-digit percentage.
- **Over 1**: digits 0 and 1 are each below the selected danger-digit percentage.

The scanner uses the exact digits from live Deriv ticks. It does not place trades by itself. A suggestion can be clicked to load the market and matching contract into the trader.

## Per-market threshold

Every market card has a **below** selector with three choices:

- **10%** — the baseline rule
- **8%** — stricter; fewer signals
- **5%** — strictest; fewest signals

The choice is independent for each market and is saved in the browser under `freebuff_scanner_thresholds_v1`. It affects the qualification state, suggestion ranking, and threshold reference line for that market.

## Signal tracking

The scanner keeps a separate track for Under 8 and Over 1 on every market. When a rule qualifies on tick N, it records a pending signal. Tick N+1 settles that signal:

- Under 8 wins when the next digit is 0–7; digits 8–9 lose.
- Over 1 wins when the next digit is 2–9; digits 0–1 lose.

This mirrors the intended next-tick trade timing. Each track displays its win rate, wins/total bets, current win streak, and the latest 12 outcomes. Detailed records are capped at 30 per market/rule, while totals continue accumulating. The ledger is persisted under `freebuff_scanner_signals_v1`.

The same settle-then-re-arm logic is exposed through `simulateRuleHits(digits, lookback)` for deterministic backtests and tests.

## Alerts and notification UX

Scanner alerts are rising-edge alerts: a rule must change from not-qualified to qualified. The initial scanner snapshot is used as a baseline and does not generate a burst of alerts.

- Alerts are silent while the scanner panel is open and focused.
- Signals that appear while the panel is open are remembered and delivered once when the panel is closed, if they are still valid.
- Rapid signals are grouped into one digest toast and one two-note sound.
- On compact/mobile layouts, the digest waits only about 450ms so alerts feel timely while still collapsing a burst of ticks; larger layouts use a 1.2s grouping window.
- Each market/rule has a 60-second alert cooldown.
- The scanner bell button persists mute/unmute state under `freebuff_scanner_alerts`.
- Sound follows the global Settings → Sound & vibration preference and is skipped when the browser tab is hidden or audio is blocked.
- Clicking an actionable scanner toast re-checks the market against the latest scanner snapshot before loading it. If the condition has moved, a small expiry warning is shown and no stale trade ticket is opened. For a grouped toast, the first listed signal is checked and opened.
- After a scanner selection, the trader clears the previous proposal immediately and waits for a fresh price for the new market/contract. Proposals received before a disconnect or older than the freshness window cannot be bought.
- The global toast stack keeps only the newest four visible; the complete notification history remains in the notification center.

## Live connection behavior

The scanner uses one public Options API WebSocket per market. Each socket:

- Backfills up to 200 ticks before subscribing to live ticks.
- Sends a keepalive ping every 15 seconds.
- Uses a 45-second stale-message watchdog.
- Re-subscribes a market after six seconds without a tick.
- Reconnects with jittered exponential backoff after abnormal or requested closes.

Each market has its own status, so one stalled market does not hide the state of the others.

## Trade settlement and next-trade refresh

When Deriv sends the final `proposal_open_contract` update, the trader keeps the
contract's actual `entry_tick` and `exit_tick`. The resolved digit is calculated
from the exact exit quote and the active market precision; it is not inferred
from whichever normal market tick happens to arrive last.

The result popup, trade notification, recent-trade row, and chart marker can
therefore show the settlement digit and quote. The previous proposal is cleared
immediately after settlement. A single fresh proposal subscription then loads
the next price, while repeated final settlement messages are ignored so they
cannot reset or delay the next-trade flow.

## Main implementation files

- `lib/market-scanner.ts` — digit windows, classification, thresholds, ledger, persistence, live sockets, and backtest helper.
- `components/market-scanner-widget.tsx` — floating scanner panel, threshold controls, tracking display, alert detection, sound, and actionable toast handling.
- `components/notification-system.tsx` — global notification action dispatch and visible-toast cap.
- `app/globals.css` — scanner cards, threshold controls, tracking results, alert button, and toast presentation.
- `__tests__/market-scanner.test.ts` — digit rules, thresholds, settlement semantics, and incremental/batch equivalence.

## Verification

The scanner implementation is verified with TypeScript and the Jest suite. The scanner tests cover exact threshold boundaries, Under 8 and Over 1 settlement outcomes, empty/no-signal streams, all-qualifying streams, capped recent history, and a 300-tick incremental-vs-simulation comparison.
