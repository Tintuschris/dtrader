# Strategy Tuning Guide

This document explains how to tune the bot's filters and parameters to optimize for different market conditions and risk preferences.

---

## Filter Hierarchy (Order of Strictness)

The filters are applied in order. Earlier filters are cheaper to check (faster), later filters are more expensive computationally.

```
1. Circuit Breaker   (cheapest - just checks a counter)
2. RSI Alignment     (cheap - reads one number)
3. SRSI Peak Check   (cheap - reads one number)
4. Reversal Confirm  (medium - checks last N ticks)
5. Adaptive Flat Cap (medium - checks flat duration + breakout)
6. Price Direction   (medium - checks last 5 ticks)
```

---

## Preset Profiles

### Conservative (95%+ Win Rate Target)

Maximizes win rate by being very selective. Fewer trades, higher conviction.

```bash
python Deriv-Stochrsi-Video-Bot.py \
  --rsi-long-max 30 \
  --rsi-short-min 80 \
  --reversal-ticks 4 \
  --srsi-short-peak 0.95 \
  --srsi-long-peak 0.05 \
  --adaptive-flat-max 6 \
  --adaptive-breakout-min 0.25 \
  --price-dir-min 4 \
  --barrier-strong -0.20 \
  --barrier-weak -0.30
```

**Expected:** ~1-3 trades per hour, 95%+ win rate, lower total P&L per session.

### Balanced (Default - 90%+ Win Rate)

Good balance between trade frequency and win rate.

```bash
python Deriv-Stochrsi-Video-Bot.py
```

**Expected:** ~3-6 trades per hour, 90%+ win rate, moderate P&L per session.

### Aggressive (More Trades, ~85% Win Rate)

Relaxes filters to capture more opportunities. Higher risk.

```bash
python Deriv-Stochrsi-Video-Bot.py \
  --rsi-long-max 45 \
  --rsi-short-min 65 \
  --reversal-ticks 2 \
  --srsi-short-peak 0.80 \
  --srsi-long-peak 0.15 \
  --adaptive-flat-max 10 \
  --adaptive-breakout-min 0.15 \
  --price-dir-min 2
```

**Expected:** ~5-10 trades per hour, 85% win rate, higher total P&L but higher variance.

### Ultra-Conservative (98%+ Win Rate)

Only trades in extreme conditions. Very few signals but extremely high conviction.

```bash
python Deriv-Stochrsi-Video-Bot.py \
  --rsi-long-max 25 \
  --rsi-short-min 85 \
  --reversal-ticks 5 \
  --srsi-short-peak 0.98 \
  --srsi-long-peak 0.02 \
  --adaptive-flat-max 5 \
  --adaptive-breakout-min 0.30 \
  --price-dir-min 4 \
  --barrier-strong -0.18 \
  --barrier-weak -0.35
```

---

## Individual Filter Tuning

### Filter 1: Circuit Breaker

**Purpose:** Prevents cascade losses after 2+ consecutive losses.

| Setting | Effect |
|---------|--------|
| `--max-loss-streak 1` | Stop after ANY single loss (very conservative) |
| `--max-loss-streak 2` | Default - stop after 2 losses |
| `--max-loss-streak 3` | Allow 3 losses before stopping |
| `--max-loss-streak 99` | Effectively disabled |

**When to adjust:**
- Raise to 3 if you're seeing losses in clusters of 3+ (market regime change)
- Lower to 1 if you want zero tolerance for losses
- Set to 99 to disable if you trust the other filters completely

### Filter 2: RSI Alignment

**Purpose:** Only trades when RSI is in extreme zones (deeply oversold/overbought).

| Setting | Effect |
|---------|--------|
| `--rsi-long-max 25` | Only LONG when RSI < 25 (extremely oversold) |
| `--rsi-long-max 35` | Default - LONG when RSI < 35 |
| `--rsi-long-max 45` | More permissive - LONG when RSI < 45 |
| `--rsi-short-min 80` | Only SHORT when RSI > 80 |
| `--rsi-short-min 75` | Default - SHORT when RSI > 75 |
| `--rsi-short-min 65` | More permissive - SHORT when RSI > 65 |

**When to adjust:**
- Tighten if losing in choppy markets (RSI 40-60 zone)
- Widen if bot is too quiet and you want more trades
- The R_25 index tends to have wider RSI swings than R_75/R_100

### Filter 3: SRSI Peak Check

**Purpose:** Ensures SRSI reached extreme levels during the flat zone, confirming a genuine oversold/overbought condition.

| Setting | Effect |
|---------|--------|
| `--srsi-short-peak 0.95` | SRSI must peak above 0.95 during flat (very strict) |
| `--srsi-short-peak 0.90` | Default - SRSI must peak above 0.90 |
| `--srsi-short-peak 0.80` | More permissive |
| `--srsi-long-peak 0.05` | SRSI must dip below 0.05 during flat (very strict) |
| `--srsi-long-peak 0.10` | Default - SRSI must dip below 0.10 |
| `--srsi-long-peak 0.15` | More permissive |

**When to adjust:**
- Tighten if SRSI signals are unreliable (market not reaching true extremes)
- Widen if bot misses too many good setups

### Filter 4: Reversal Confirmation

**Purpose:** Waits for price to actually start moving in the trade direction before entering.

| Setting | Effect |
|---------|--------|
| `--reversal-ticks 2` | 2 consecutive ticks in trade direction (default from earlier) |
| `--reversal-ticks 3` | 3 consecutive ticks (current default - stricter) |
| `--reversal-ticks 4` | 4 consecutive ticks (very strict) |
| `--reversal-ticks 1` | 1 tick (essentially disabled) |

**When to adjust:**
- Raise to 4 if still seeing "was winning then reversed" losses
- Lower to 2 if bot enters too late and misses the move
- The contract is 5 ticks - confirmation should cover 40-60% of the duration

### Filter 5: Adaptive Flat Cap

**Purpose:** Requires stronger breakout when the flat zone was long (stale signal).

| Setting | Effect |
|---------|--------|
| `--adaptive-flat-max 6` | Flat > 6 ticks triggers adaptive cap |
| `--adaptive-flat-max 8` | Default - flat > 8 ticks triggers |
| `--adaptive-flat-max 10` | More permissive |
| `--adaptive-breakout-min 0.20` | Default - need breakout >= 0.20 for stale signals |
| `--adaptive-breakout-min 0.25` | Stricter - need breakout >= 0.25 |
| `--adaptive-breakout-min 0.15` | More permissive |

**When to adjust:**
- Lower the flat max if stale signals are causing losses
- Raise the breakout min if stale signal losses are frequent

### Filter 6: Price Direction

**Purpose:** Ensures price momentum is already moving in the trade direction.

| Setting | Effect |
|---------|--------|
| `--price-dir-min 2` | 2 of last 5 ticks in trade direction |
| `--price-dir-min 3` | Default - 3 of last 5 ticks |
| `--price-dir-min 4` | 4 of last 5 ticks (very strict) |

**When to adjust:**
- Raise to 4 if catching falling knife / rising knife entries
- Lower to 2 if bot enters too late after the move has passed

---

## Barrier Tuning

### Fixed Barrier (Default)

```bash
--barrier-higher -0.23 --barrier-lower +0.23
```

This is the standard barrier. At $1 stake on R_25, payout is ~$1.32 (32% return).

### Adaptive Barrier (Recommended)

```bash
--barrier-strong -0.20  # Tight barrier for strong signals (RSI < 25 or > 85)
--barrier-weak -0.30    # Wide barrier for weaker signals (RSI 25-35 or 65-85)
```

**Tradeoff:** Tighter barrier = higher payout but harder to win. Wider barrier = lower payout but easier to win.

### Barrier Offset vs Payout

| Barrier | Payout | Return | Notes |
|---------|--------|--------|-------|
| 0.15 | ~$1.50 | 50% | Very tight, hard to win |
| 0.20 | ~$1.40 | 40% | Tight, good for strong signals |
| 0.23 | ~$1.32 | 32% | Default, balanced |
| 0.30 | ~$1.18 | 18% | Wide, easier to win |
| 0.35 | ~$1.12 | 12% | Very wide, almost always wins |

---

## Duration Tuning

The contract duration (in ticks) affects how much time price has to reach the barrier.

| Duration | Ticks | Payout | Notes |
|----------|-------|--------|-------|
| 3t | 3 | ~$1.18 | Very short, quick resolution |
| 5t | 5 | ~$1.32 | Default, balanced |
| 7t | 7 | ~$1.45 | Longer, more room |
| 10t | 10 | ~$1.55 | Long, highest payout but more risk |

**Tradeoff:** Longer duration = more time for price to reach barrier (higher win rate) but more time for price to reverse (lower win rate). The sweet spot depends on market volatility.

---

## Market-Specific Tuning

### R_25 (Volatility 25)
- Default settings work well
- Higher frequency of signals (more volatile)
- Tends to have wider RSI swings

### R_75 (Volatility 75)
- Consider relaxing RSI thresholds (--rsi-long-max 40, --rsi-short-min 70)
- Signals are less frequent but often stronger
- Price moves are smoother

### R_100 (Volatility 100)
- Consider relaxing further (--rsi-long-max 45, --rsi-short-min 65)
- Very smooth price action
- L-shape patterns are c
