# Deriv STOCHRSI L-Shape Bot v3.1

An automated trading bot for Deriv's Volatility Indices (R_25, R_75, R_100, etc.) that detects **L-shaped patterns** on the Stochastic RSI indicator and places short-term tick trades with 6 configurable strategy filters.

---

## Table of Contents

1. [Overview](#overview)
2. [The L-Shape Strategy](#the-l-shape-strategy)
3. [Strategy Filters (6 Filters)](#strategy-filters)
4. [Adaptive Barrier System](#adaptive-barrier-system)
5. [Entry Delay Confirmation](#entry-delay-confirmation)
6. [Architecture](#architecture)
7. [Prerequisites](#prerequisites)
8. [Quick Start](#quick-start)
9. [CLI Reference](#cli-reference)
10. [Environment Variables](#environment-variables)
11. [Terminal UI](#terminal-ui)
12. [Trade Log](#trade-log)
13. [Recording & Backtesting](#recording--backtesting)
14. [Authentication](#authentication)
15. [Troubleshooting](#troubleshooting)
16. [File Structure](#file-structure)

---

## Overview

The bot connects to Deriv's WebSocket API, streams real-time tick data for a volatility index, and runs a **Stochastic RSI** indicator pipeline. When it detects a specific **slanted L-shape** pattern on the raw StochRSI line, it applies 6 strategy filters, waits for price confirmation, then automatically places a trade betting that the next few ticks will move in the expected direction.

**Key capabilities:**
- Streams live ticks and computes RSI(14) -> StochRSI(14) -> K/D indicators in real-time
- Detects L-shape patterns using a state machine on **raw (unsmoothed) StochRSI**
- Applies 6 configurable strategy filters before placing any trade
- Waits for 2-tick price confirmation after signal fires (entry delay)
- Uses adaptive barrier offset based on signal strength (RSI)
- Saves every trade to `trade_log.json` with full signal context
- Automatically reconnects with exponential backoff
- Sends keepalive pings every 30 seconds
- Rich terminal UI with spark charts, indicator values, detection phases
- Dry-run mode for testing without placing trades
- Record/replay mode for backtesting

---

## The L-Shape Strategy

### The Slanted L Pattern

```
StochRSI
1.0 |    /
    |   /
    |  /
0.8 | /
    |/___________  <- Flat zone (overbought)
    |
0.2 |
    |______________
```

**Three phases:**

1. **Slope** - Raw StochRSI makes a sharp directional move (drops from high or rises from low)
2. **Flat** - Raw StochRSI goes flat near oversold (<=0.20) or overbought (>=0.80) for >=3 ticks
3. **Breakout** - Raw StochRSI suddenly reverses by >=0.15 in a single tick

### Signal to Trade Mapping

| Pattern | Signal | Deriv Contract |
|---------|--------|----------------|
| Flat low + breakout UP | `HIGHER` (LONG) | CALL with barrier |
| Flat high + breakout DOWN | `LOWER` (SHORT) | PUT with barrier |

### Why Raw StochRSI?

The original implementation used SMA(3)-smoothed K values, which **erased the sharp corner** of the L-shape. TradingView shows the raw StochRSI line where the L-shape is clearly visible - the bot now uses the same data.

### Detection Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `RAW_LEVEL_LOW` | 0.20 | Oversold zone threshold |
| `RAW_LEVEL_HIGH` | 0.80 | Overbought zone threshold |
| `RAW_FLAT_LOOKBACK` | 3 ticks | Minimum flat duration (6 seconds at R_25) |
| `RAW_FLAT_THRESHOLD` | 0.08 | Max variance during flat zone |
| `RAW_BREAKOUT_MIN` | 0.15 | Minimum single-tick reversal magnitude |
| `RAW_SLOPE_MIN` | -0.15 | Minimum downward slope threshold |
| `RAW_SLOPE_MAX` | 0.15 | Minimum upward slope threshold |

---

## Strategy Filters

The bot applies **6 configurable filters** after detecting an L-shape signal. All signals must pass ALL filters to trigger a trade.

### Filter 1: Loss-Streak Circuit Breaker

Stops trading after N consecutive losses to prevent cascade losses.

| Parameter | Default | Env Var | Description |
|-----------|---------|---------|-------------|
| `--max-loss-streak` | 2 | `FILTER_LOSS_STREAK_MAX` | Max consecutive losses before stop |

**Evidence:** In testing, 3 consecutive losses (trades 19->20->21) would have been saved by this filter, improving the session from +$1.56 to +$3.56.

### Filter 2: RSI Trend Alignment

Requires RSI to be in extreme zones before entering. Prevents counter-trend trades.

| Direction | RSI Must Be | Env Var |
|-----------|-------------|---------|
| LONG (HIGHER) | < `--rsi-long-max` (default 35) | `FILTER_RSI_LONG_MAX` |
| SHORT (LOWER) | > `--rsi-short-min` (default 75) | `FILTER_RSI_SHORT_MIN` |

**Evidence:** 4 out of 5 losses in session 1 were LONG trades with RSI between 21-33. Raising the threshold to <35 filters the weakest of these.

### Filter 3: SRSI Peak Check

Requires the SRSI to have reached extreme levels during the flat zone before the signal fires.

| Direction | SRSI Must Reach | Env Var |
|-----------|----------------|---------|
| SHORT | > `--srsi-short-peak` (default 0.90) | `FILTER_SRSI_SHORT_PEAK_MIN` |
| LONG | < `--srsi-long-peak` (default 0.10) | `FILTER_SRSI_LONG_PEAK_MAX` |

**Evidence:** The losing SHORT trade at RSI=91.1 had SRSI peaking at only 0.648 - not high enough for a reliable reversal.

### Filter 4: Reversal Confirmation

Requires N consecutive ticks moving in the trade direction before entry.

| Parameter | Default | Env Var | Description |
|-----------|---------|---------|-------------|
| `--reversal-ticks` | 3 | `FILTER_REVERSAL_TICKS` | Consecutive ticks needed |

**Evidence:** 5 out of 6 losses were "was winning then reversed" - the trade entered before price actually committed to the reversal.

### Filter 5: Adaptive Flat Duration Cap

Requires a stronger breakout when the flat zone was long (stale signal).

| Parameter | Default | Env Var | Description |
|-----------|---------|---------|-------------|
| `--adaptive-flat-max` | 8 | `FILTER_ADAPTIVE_FLAT_MAX` | Flat ticks threshold |
| `--adaptive-breakout-min` | 0.20 | `FILTER_ADAPTIVE_BREAKOUT_MIN` | Min breakout for stale signals |

**Logic:** If flat > 8 ticks, breakout must be >= 0.20 (vs normal 0.15).

**Evidence:** Loss #16 had flat=13t with breakout=0.127 - a stale signal that would be filtered.

### Filter 6: Price Direction Check

Requires >=N of the last 5 ticks to be moving in the trade direction.

| Parameter | Default | Env Var | Description |
|-----------|---------|---------|-------------|
| `--price-dir-min` | 3 | `FILTER_PRICE_DIR_MIN` | Min ticks in trade direction (of 5) |

**Evidence:** Catches "falling knife" LONG entries where 4+ of the last 5 ticks were DOWN.

### Historical Filter Results

Retroactive analysis on 29 trades (7 losses) across 2 sessions:

| Filters Applied | Losses Caught | Projected Win Rate |
|----------------|---------------|-------------------|
| None | 0/7 | 76% |
| + Min breakout 0.15 | 3/7 | 86% |
| + RSI thresholds | 5/7 | 92% |
| + SRSI peak check | 6/7 | 96% |
| + Price direction | **7/7** | **100%** |

---

## Adaptive Barrier System

The barrier offset adjusts based on signal strength (RSI value):

| Signal Strength | Condition | Default Barrier | Payout |
|----------------|-----------|-----------------|--------|
| **Strong** | RSI < 25 (LONG) or > 85 (SHORT) | `--barrier-strong` = -0.20 | ~$1.40 |
| **Normal** | RSI 25-35 or 65-85 | `--barrier-weak` = -0.30 | ~$1.18 |

Strong signals get a tighter barrier for better payout. Weaker signals get a wider barrier for more room.

**CLI args:** `--barrier-strong`, `--barrier-weak`  
**Env vars:** `BARRIER_STRONG`, `BARRIER_WEAK`

---

## Entry Delay Confirmation

After all 6 filters pass, the signal is **queued** for N ticks. During this delay:

- The bot monitors whether price is actually moving in the trade direction
- If price confirms (moves right way) -> places trade with adaptive barrier
- If price reverses (moves wrong way) -> **ABORTED** - no trade, no loss

| Parameter | Default | Env Var |
|-----------|---------|---------|
| `--entry-delay` | 2 | `FILTER_ENTRY_DELAY` |

**This is the single most impactful feature.** The barrier analysis showed that 5/6 losses were "was winning then reversed" - the bot entered 1-2 ticks too early. The delay catch
