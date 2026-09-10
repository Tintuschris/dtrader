# Deriv DigitBot — v1.4 Change Log

*Date: 2026-09-11. Covers the shared-transport refactor and the smart-barrier strategy update.*

## Summary

| # | Change | Type | Verified |
|---|--------|------|----------|
| 1 | Shared `DerivClient` transport module (new file) | Refactor | ✅ fake-socket dispatch harness, all 3 bots |
| 2 | DigitBot + Soft bot rebuilt on `DerivClient` (~150 / ~240 lines of duplicated plumbing removed) | Refactor | ✅ `py_compile` + offline dispatch simulation |
| 3 | Over-side EV bug in `pick_prediction()` | Bug fix | ✅ unit test |
| 4 | `--smart-barrier` distribution-driven barrier selection | Feature (opt-in) | ✅ unit + integration tests |

## 1. Shared DerivClient transport

`DerivClient.py` now owns everything the three bots used to duplicate: bridge/PAT
auth, authorize, tick/balance subscriptions, proposal → buy → POC settlement,
keepalive pings, and the reconnect loop.

Key API surface:

- `DerivClient(symbols=[...], probe_contracts=False, parse_float=..., max_reconnects=None, subscribe_portfolio=...)`
  - `symbols` — multi-symbol sessions (DigitBot)
  - `parse_float` — DigitBot passes `RawFloat` so quotes keep their exact wire
    string (pip-accurate digit extraction)
  - `probe_contracts=False` — skips the accumulator `contracts_for` handshake
  - `max_reconnects=None` — reconnect forever (previous bot behavior)
- `configure(account_type=...)` — an explicit `--account` flag overrides the
  `ACCOUNT_TYPE` env var (both bots honored the flag before; preserved)
- Message loop dispatches typed errors (proposal/buy responses carrying
  `error`) to the bot handler so pending trades get marked failed, routes
  `balance` updates, and centralizes the ping/pong rules.
- Fixed latent bug: `subscribe()` called `authorize_if_needed()` with a stale
  extra argument.

DigitBot also switched from the dead `/api/auth/pat` bridge route to the
working `/api/deriv/bot-session` endpoint as part of the refactor.

Behavioral note: the shared client uses app-level pings (30s, closes after 3
failures) instead of library-level pings. DigitBot's old behavior was
functionally equivalent.

## 2. Over-side EV fix in `pick_prediction()`

The dynamic-prediction scorer computed `edge = win_freq - PAYOUT_TABLE[pred][0]`
for **both** directions, but that table's base-win column is the UNDER
probability (`pred/10`). For an OVER `pred` contract the base win is
`(10-pred)/10`, so every OVER trade's edge was off by ~0.1 and predictions
were mis-ranked on the over side.

Fix: base win and payout are now direction-dependent; the payout for OVER
barriers is derived from Deriv's formula (`0.96 / base_win`) instead of the
under-only table.

## 3. Smart barrier (`--smart-barrier`)

Motivation: the 39-trade v1.3 sample on R_25 ran flat pred=5 at 51.3% WR —
below the ~53% breakeven for a ~1.88x payout. The skew gate detected digit
concentration but the bot always traded the same 50/50 barrier; the signal and
the bet were disconnected.

With `--smart-barrier`, at signal time the bot evaluates barriers 3–7 in the
trade direction and picks the one whose winning-digit mass most exceeds the
uniform baseline:

- **Laplace shrinkage** (pseudo-count 10 toward uniform) so a lucky streak in a
  short window cannot fake an edge
- Requires `--smart-min-samples` (default 50) digits in the window
- Requires `--smart-min-edge` (default 5%) above baseline, else the signal is
  skipped with a `BARRIER SKIP` line (fewer trades is the feature working)
- The chosen barrier flows into the proposal and the trade log
  (`prediction` field), so per-barrier win-rate analysis works on real data

Env vars: `SMART_MIN_EDGE`, `SMART_MIN_SAMPLES`.

### Expected effect

- Trade frequency drops (no-edge conditions are skipped, not traded)
- Average payout per win rises when it picks low barriers (over-3/under-4 pay
  ~3x vs 1.88x), so a slightly lower WR can still be profitable
- Honest caveat: Deriv synthetic digits are designed to be uniform; sustained
  edges are rare. The main value is refusing to trade when there is no edge —
  reduced exposure, not guaranteed wins. Validate on demo first.

## 4. Verification

- `py_compile` clean on `DerivClient.py`, `Deriv-DigitBot.py`,
  `Deriv-Stochrsi-SloppyL-Soft.py`
- Unit tests: picker picks over-3 (+13% edge) when high digits are hot, under
  barriers when low digits are hot; returns `None` for uniform / weak-edge /
  small-sample distributions
- Integration: fake-socket drive of the real `log_trade → place_trade →
  proposal → buy → POC settle` path with `--smart-barrier`; barrier,
  buy ack, POC subscribe, settlement and trade-log bookkeeping all verified
- Soft bot's `--history` mode still renders after its refactor

## Run command (v14)

```bash
export PAT_TOKEN=... && export USE_BRIDGE=0 && export DERIV_APP_ID=... && \
python -u Deriv-DigitBot.py --smart-barrier --account demo --stake 0.35 \
  --min-confidence 40 --min-hist 0.01 --min-skew 1.5 --max-skew 5.0 \
  2>&1 | tee docs/v14-run-$(date +%H%M).txt
```

## Performance baseline (pre-v1.4)

From `trade_log_digitbot_R_25.json` (Sep 8–9, R_25, flat pred=5, $0.35 stake):

| Trades | WR | P/L | Avg win | Avg loss |
|---|---|---|---|---|
| 39 (20W/19L) | 51.3% | +$0.23 | +$0.344 | −$0.35 |

Breakeven WR at pred=5 payout (~1.88x) is ~53.2% — the run was marginally
negative-EV, consistent with noise around a fair coin.
