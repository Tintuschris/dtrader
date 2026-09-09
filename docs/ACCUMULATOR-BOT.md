# Deriv Accumulator Bot

`Deriv-Accumulator-Bot.py` is a separate, demo-first experiment. It does not
change the Video bot, Soft bot, 1-second bot, DigitBot, or web trader.

## What it trades

The bot uses Deriv's `ACCU` contract. It does not predict Higher/Lower or a
last digit. It looks for a calm, compressed market with no strong short-term
trend, then requests an Accumulator proposal. The growth rate is fixed when a
contract is opened and must be one of `0.01`, `0.02`, `0.03`, `0.04`, or `0.05`.

Before requesting a proposal, the bot reads the market's ACCU entry from
`contracts_for`. ACCU positions do not use a fixed tick expiry: the position
stays open until a knockout, a take-profit, or the bot's early-exit rule sells
it. The legacy `--duration` option is retained so older commands do not break,
but it is deliberately not sent in the ACCU proposal. Deriv's moving barriers are read from the proposal and
`proposal_open_contract` responses. The bot does not reuse the fixed barriers
from the existing digital bots.

## Safety defaults

- Demo account is the default.
- The bot is paper/dry-run unless `--live-demo` is supplied.
- Real account mode requires both `--account real` and `--allow-real`.
- Default growth rate is 1%.
- Default stake is `$1.00`, which is the minimum currently accepted for live
  ACCU buys on this account/product. Do not lower it for live mode.
- One open contract is allowed.
- Martingale is not implemented.
- Trading stops after two knockouts or `$0.70` session loss by default.
- The default target is five safe ticks, with a `$0.05` take-profit request.
- A proposal is skipped only when its nearest returned barrier is less than
  two recent median tick moves away. This is a market-scaled safety check, not
  an RSI/StochRSI tightening.
- The live danger exit begins at 30% of the current barrier band by default,
  giving the sell request more time to arrive before a knockout.
- Small-profit protection is intentionally disabled. The bot does not sell
  merely because profit reaches a few cents; it exits on the configured safe
  tick target or a genuine barrier-room warning.
- The shock-cluster filter is deliberately narrow: it rejects a candidate only
  when at least two short-term warnings agree and RSI is near the edge of the
  stability band (`>=55` or `<=45` by default). This keeps the normal signal
  flow broad while filtering the most visibly unstable setups.
- A mirrored directional-edge guard skips an entry when RSI is near an edge
  and the recent slope is pushing outward from that edge. It is enabled by
  default with a slope threshold of `0.30` and is intentionally independent
  of contract direction, so it protects both upward and downward shocks.
- A directional-cluster gate is enabled by default. It rejects an entry when
  the absolute movement of the last three ticks is at least `2.50x` the recent
  median tick move, even when RSI is not yet at an edge. This is separate from
  the multi-warning shock filter because a strong short cluster can precede a
  reversal without triggering two other warnings. Disable it with
  `--no-directional-cluster-gate` or tune it with
  `--max-directional-cluster-ratio`.
- An optional stable-market scanner can rank several symbols from recent public
  tick history and switch the bot only while it is flat. It is disabled by
  default. When enabled, the scanner keeps each market's log separate and
  rebuilds the signal history after a switch; it never abandons an active
  ACCU position.

## Standalone PAT command

Use a demo PAT and keep the token out of shell history when possible:

```bash
USE_BRIDGE=0 PAT_TOKEN="YOUR_DEMO_PAT" DERIV_APP_ID="YOUR_APP_ID" python Deriv-Accumulator-Bot.py --symbol R_25 --growth-rate 0.01 --duration 45 --target-safe-ticks 5 --take-profit 0.05 --live-demo
```

Without `--live-demo`, the bot only creates paper trades using the
`--paper-band-pct` approximation. Paper barriers are explicitly approximate;
live trades use barriers returned by Deriv.

## Recommended demo sequence

1. Run without `--live-demo` and confirm that stable signals are being found.
2. Run one market at a time with `--live-demo`.
3. Start with 1% growth and a short target.
4. Compare at least 100 settled trades per market/configuration.
5. Review knockout rate, safe-tick streaks, take-profit rate, average profit,
   and maximum consecutive knockouts. Do not judge the bot by entry count or
   win rate alone.

## Main options

| Option | Default | Purpose |
|---|---:|---|
| `--symbol` | `R_25` | One market per process/log |
| `--stake` | `1.00` | Initial stake; live ACCU buys require at least `$1.00` |
| `--growth-rate` | `0.01` | Accumulator growth rate |
| `--duration` | `45` | Legacy compatibility only; not sent because ACCU has no fixed expiry |
| `--target-safe-ticks` | `5` | Early profit-taking target |
| `--take-profit` | `0.05` | Deriv take-profit amount; `0` disables it |
| `--min-entry-room-moves` | `2.0` | Minimum proposal barrier distance in recent median tick moves |
| `--early-exit-room` | `0.30` | Sell threshold as a fraction of the current barrier band |
| `--shock-cluster-filter` | on | Require multiple short-term warnings before rejecting an entry |
| `--shock-cluster-min-warnings` | `2` | Number of combined warnings required |
| `--shock-cluster-last-tick-ratio` | `1.45` | Last tick shock threshold in median moves |
| `--shock-cluster-expansion` | `1.50` | Recent expansion threshold |
| `--shock-cluster-peak-ratio` | `2.50` | Recent peak-move threshold |
| `--shock-cluster-slope` | `0.20` | Normalized slope warning threshold |
| `--shock-cluster-macd` | `0.50` | Normalized MACD warning threshold |
| `--shock-cluster-directional-ratio` | `2.50` | Last-three-tick directional cluster threshold |
| `--shock-cluster-rsi-edge` | `55` / `45` | RSI edge context required for the veto |
| `--directional-edge-filter` | on | Skip outward pressure at an RSI edge |
| `--directional-edge-rsi` | `55` / `45` | RSI edge for the mirrored directional guard |
| `--directional-edge-slope` | `0.30` | Minimum outward normalized slope |
| `--directional-cluster-gate` | on | Reject unusually strong last-three-tick directional clusters |
| `--max-directional-cluster-ratio` | `2.50` | Maximum last-three-tick cluster in recent median-move units |
| `--stable-market-scan` | off | Opt in to periodic stability ranking and flat-position switching |
| `--scan-symbols` | `R_10,R_25,R_50,R_75,R_100` | Symbols considered by the optional scanner |
| `--scan-ticks` | `500` | Historical ticks sampled per market |
| `--scan-interval` | `900` | Seconds between scans; minimum runtime interval is 30 seconds |
| `--live-demo` | off | Enables demo proposals and buys |
| `--dry-run` | off | Forces paper mode |
| `--record` | per-market | Override the JSON log path |

The stability filters are configurable with `--lookback`, `--rsi-min`,
`--rsi-max`, `--srsi-min`, `--srsi-max`, `--max-expansion`,
`--max-tick-multiple`, and `--max-slope`. The optional `--macd-filter` adds a
trend-strength veto using the MACD histogram normalized by the market's median
tick move; `--max-macd-hist-ratio` controls its threshold. It is off by default
until a separate demo comparison is complete.

The risk guards do not change the stability signal. They act after a signal:
the entry guard compares the actual proposal barriers with recent tick size,
the shock-cluster guard rejects only when multiple short-term warnings agree
near the RSI edge, the directional-edge guard catches a single clear outward
pressure pattern, the directional-cluster gate catches a strong short cluster
regardless of RSI, and the danger guard watches the live barrier room. Because
ACCU barriers can be hit between API updates, none of these rules can guarantee prevention of a
knockout; they are intended to reduce avoidable exposure without eliminating
normal qualifying trades.

The stable-market scanner is opt-in and uses a separate public WebSocket for
recent tick history. It ranks markets using normalized 3x-shock frequency,
95th-percentile movement, recent expansion, and the latest directional cluster.
Lower score is preferred. It is a screening tool, not a proven trading edge.
The bot switches only when there is no active contract and no pending proposal.
Without `--stable-market-scan`, the bot remains single-market and does not make
any extra history requests.

## Logs

The default log is `trade_log_accu_<symbol>.json`. It records:

- every qualifying signal and indicator snapshot;
- growth rate, stake, and requested duration;
- proposal and contract IDs;
- the full proposal response and first open-contract response for later audit;
- entry spot and barrier values;
- current spot and barrier distances;
- shock-cluster filter events, including the indicator warnings that caused a
  candidate to be skipped;
- locally measured elapsed ticks, the raw Deriv tick-count field, and whether
  Deriv marked the contract valid to sell;
- contract value/profit;
- early-exit reason, knockout side/status, settlement spot, and PnL;
- session stop reason and session PnL.

At startup the terminal now prints the ACCU expiry type and confirms that the
position is open-ended. Each entry uses a one-shot proposal quote and allows
only one buy request, so a stream of quote updates cannot submit duplicate
buys. If Deriv returns a buy-validation or open-position error, the bot pauses
new proposals for 30 seconds instead of retrying every tick.

On startup the bot also checks the account portfolio. If an ACCU contract for
the selected symbol is already open, it recovers monitoring for that contract
and will not open a second position.

The Deriv UI's ACCU Stats panel shows historical consecutive in-range tick
streaks. The public API does not expose that panel as a documented statistics
endpoint. The closest reproducible data is `ticks_history` plus the live
`proposal_open_contract` barrier and validity fields; the bot records its own
elapsed tick count and raw Deriv tick-count field for this reason.

Use `--history` to print the selected log. Knockouts that occur after a sell
request are recorded as `knockout_after_barrier_room` rather than being
mistaken for successful early exits, and they count toward the knockout stop.

## Important limitation

The paper-mode barrier is only an approximation for screening. It is not a
substitute for Deriv's live proposal barriers. Any serious backtest should
capture actual proposal/open-contract barrier data and replay the real tick
stream before changing growth rates or moving to a funded account.

## Current experiment status

The current default entry protections are enabled without extra flags:

- directional-edge filtering at RSI `55`/`45` with outward slope `0.30`;
- the directional-cluster gate at `2.50x` the recent median move;
- MACD, shock-cluster, proposal-room, and live barrier-room checks when their
  corresponding options are enabled by the command.

For the next controlled demo experiment, the edge-slope threshold can be
relaxed slightly to `0.25` with `--directional-edge-slope 0.25`. Replay of the
recorded R_25/R_50 comparison logs showed that this would have filtered the
recent R_25 loss while rejecting only a small fraction of recorded entries.
This remains a test setting, not a guarantee against future knockouts.

The bot does not yet apply a post-loss recovery pause based on a fresh stable
tick window. That is intentionally a separate follow-up change: normal entry
flow should remain broad, while a market that has just knocked out should be
requalified before trading resumes. Dynamic staking and loss-recovery staking
are not implemented.
