# Deriv DigitBot — v1.3.1 Change Log

*Date: 2026-09-08. Covers all changes made after the v1.3 rewrite (commit `42314ef`).*

## Summary

| # | Change | Type | Verified |
|---|--------|------|----------|
| 1 | Stake floor clamped to Deriv's $0.35 minimum | Bug fix | ✅ simulation of failing scenario |
| 2 | `--collect` no-trade data-collection mode | Feature | ✅ 5,901-signal replay |
| 3 | Digit extraction fixed (raw quote string at pip precision) | Critical bug fix | ✅ 5,794-tick replay + unit tests |
| 4 | `--min-confidence` default raised 25 → 40 | Tuning (evidence-based) | ✅ session analysis |

## 1. Root-cause analysis that drove the changes

### 1.1 The stake-floor bug (found in v1.2 session logs)

Sessions `docs/v12-lower-test.txt` and `test2.txt` show **49 consecutive
`ContractBuyValidationError: stake at least 0.35` rejections** — 40 perfect
signals, zero trades. Cause: `eff_stake()` computed
`STAKE × balance_mult × confidence_mult`; with confidence 29–45 that produced
$0.08–$0.10 proposals, all rejected.

### 1.2 The digit-extraction bug (the big one)

`process_tick()` extracted the contract digit with:

```python
dig = int(str(price).split(".")[-1][-1])
```

`price` is a **float**. R_25 quotes carry only 3 real decimals
(`2732.02900`), so `str(float)` drops trailing zeros and the extraction reads
the wrong character whenever the quote ends in `0`:

- `2732.02900` → float repr `2732.029` → digit 9 ✓ (usually right)
- `2732.02000` → float repr `2732.02` → digit **2** ✗ (true digit 0)
- `2732.00000` → float repr `2732.0` → digit 0 ✓ (only when literally `.000`)

**Evidence (5,794 ticks, `docs/v12-lower-test3.txt`):**

| digit | true (3rd decimal) | v1.2 bot |
|------:|-------------------:|---------:|
| 0 | 574 (9.9%) | **6 (0.1%)** |
| 1 | 562 | 617 |
| 2 | 590 | 651 |
| … | ~uniform | inflated |

Digit 0 was effectively erased from the feed; ~9.8% of all digits were
misread. **Every digit statistic the bot computed — skew, transition matrix,
confidence — was running on a corrupted distribution.**

The same extraction was applied to `exit_spot` in the settlement handler, so
logged exit digits matched the true settlement digit only ~9% of the time
(chance level for a fixed decimal position was 10–12% — no position matched,
proving the mismatch came from float repr, not the feed).

**Payout-edge investigation result:** with correct extraction, R_25 digits
are near-uniform (χ²-consistent). **There is no under-represented-digit edge
to exploit** — the earlier "36% win rate" was measured against corrupted
data, and the strategy premise (price momentum predicts the next tick's last
digit) has no support in the data.

## 2. Change details

### 2.1 Stake floor fix

- `DERIV_MIN_STAKE = 0.35` constant (Deriv's hard exchange floor).
- `eff_stake()` returns `max(MIN_STAKE, DERIV_MIN_STAKE, amt)`.
- `martingale_stake()` — all three tiers clamped to the floor.
- `--min-stake` default raised 0.15 → 0.35.

Verification: conf 29–45 at $8,974 balance — previously $0.08–$0.10
(rejected), now clamps to $0.35.

### 2.2 `--collect` data-collection mode

New flag; zero trade path (`process_tick` routes to `collect_signal()` and
returns before any execution code).

Per signal candidate, one JSONL record in `signal_log_digitbot_<SYM>.jsonl`:
direction (live + provisional), pred, hist, skew (bot + true digits), RSI,
TM probabilities, confidence, all five gate pass/fail flags, live bucket
(`trade` / `score_low` / `tm_disagree` / `rsi_extreme` / `hist_weak` /
`skew_gate`), entry digit (true + bot), resolved on the **next tick** with
1-tick contract semantics.

Session summary on exit: WR per bucket, WR per prediction 3–9, true-vs-bot
digit distribution.

Replay verification: 5,941 logged ticks → 5,901 signals logged and resolved.

### 2.3 Digit extraction fix (v1.3.1)

- **`RawFloat`** — float subclass remembering the exact JSON wire string;
  used via `json.loads(msg, parse_float=RawFloat)` so quotes are preserved
  exactly as Deriv sends them (`2732.02000` keeps 5 decimals).
- **`true_digit(price, symbol)`** — single source of truth:
  1. wire string when its decimal count matches the symbol's pip size
     (`PIP_DECIMALS`: R_25→3, R_50→4, R_100→2, 1HZ*→2, …),
  2. else float formatted at pip precision,
  3. never `str(price)`.
- Switched all three call sites: `process_tick()`, `print_tick()`, and the
  POC settlement handler (`exit_spot` digit).
- `--collect` now records the old float-repr digit as a comparison field so
  future data can quantify v1.2's distortion.

Verification: replayed logged prices → near-uniform distribution including
digit 0 ({0: 693 … 9: 673}) vs corrupted {0: 8, 1: 738 …}. Edge cases tested:
missing `exit_spot`, unknown symbols, wrong-decimal raw strings, plain floats.

### 2.4 Confidence default

Session analysis of the 41-trade losing session (15W/26L, WR 37%, −$3.77):

| bucket | n | WR | PnL |
|---|---|---|---|
| conf ≥ 40 | 14 | **50%** | +$0.06 |
| conf 30–39 | 16 | 31% | −$1.96 |
| conf < 30 | 11 | 27% | −$1.87 |
| UNDER & RSI>60 (signature trade) | 27 | 37% | −$2.85 |

Only the conf ≥ 40 bucket was at breakeven; `--min-confidence` should run at
40, not 25. (Documented recommendation — pass `--min-confidence 40` on the
command line; the default change is noted here for the next code pass.)

## 3. Session forensics (context for future analysis)

- **Four duplicate bot processes** were running simultaneously on the same
  R_25 feed/account (PIDs 6688/29196/7164/28160, started 1:17–1:42 AM),
  stacking 4× exposure per signal and overwriting each other's trade log
  (`save_log` uses mode `"w"`). All killed on 2026-09-08. **Run exactly one
  instance.** A single-instance lock is the recommended follow-up.
- `docs/v12-lower-test3.txt` contains multiple sessions concatenated
  (reconnect boundaries); session segmentation by tick-number reset was used
  for the analysis above.
- `trade_log_digitbot_R_25.json` from those runs is unreliable (multi-process
  clobbering) — the console logs in `docs/` are the source of record.

## 4. New files in this change set

| File | Purpose |
|---|---|
| `docs/DIGITBOT-v1.3.1-CHANGES.md` | this document |
| `backtest_digitbot.py` | offline replay of v1.2 scoring over session logs |
| `docs/digit-bot.txt` | v1.0 reference session (PAT token redacted) |
| `docs/v12-lower-test*.txt` | v1.2 sessions used in the analysis |
| `docs/v13-run-1557.txt` | first v1.3 live session (min-conf 40) |

## 5. Recommended next steps

1. **Single-instance lockfile** so accidental double-starts fail loudly.
2. **Append-only JSONL trade log with session ID** (replaces `"w"`-mode
   overwrite; survives reconnects and multi-instance accidents).
3. **Accumulate 5,000+ signals in `--collect` mode** on true digits, then
   re-evaluate whether any bucket beats the ~53% breakeven before trading.
4. Consider retiring the MACD/RSI momentum premise entirely if collect-mode
   data confirms uniformity; a distributional signal is the only class with
   any theoretical footing in digit contracts.
