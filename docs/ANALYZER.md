# AI Market Analyzer

## Overview
Real-time ML-powered system that analyzes digit distributions across Deriv volatility indices, predicts the next digit, and can automatically place trades.

## Architecture
```
Deriv v3 WS ──→ Terminal (chart + trading)
              ──→ Analyzer (independent WS, statistical + neural analysis)
                                        │
                                  ┌─────▼─────┐
                                  │ TF.js LSTM │
                                  │ (Web Worker)│
                                  └─────┬─────┘
                                        │
                            ┌───────────▼───────────┐
                            │   Auto-Trade Engine    │
                            │   (propose → buy →     │
                            │    track result)       │
                            └───────────────────────┘
```

## How It Works

### 1. Tick Ingestion (Real Deriv Data)
- Analyzer connects to `wss://ws.derivws.com/websockets/v3` (its own independent connection)
- Fetches 500 historical ticks via `ticks_history` on connect
- Subscribes to live `ticks` for real-time updates
- **No simulated data** — all ticks are real market data from Deriv

### 2. Statistical Analysis
For each volatility index (10V, 25V, 50V, 75V, 100V):
- Digit frequency distribution (0-9)
- Entropy (lower = more biased = more exploitable)
- Distribution skew (over/under advantage)
- Trend detection
- Constraint checks for trading criteria

### 3. Neural Network (TF.js LSTM)
- Architecture: LSTM(64) → Dropout → LSTM(32) → Dropout → Dense(32) → Dense(10, softmax)
- Input: Last 20 ticks as one-hot vectors
- Output: Probability distribution over next digit
- Online learning: validates predictions against actual outcomes
- Anti-forgetting: gradient clipping, EMA weights, conservative LR

### 4. Hybrid Scoring
- Statistical score (0-100) + neural boost
- Blend weight ramps 0→0.4 based on neural accuracy
- Recommends best trade (digit + direction) per market

### 5. Auto-Trading
When enabled, the engine:
1. Checks analyzer predictions every 3 seconds
2. If score > threshold AND confidence > minimum → requests proposal
3. Buys contract via Deriv WebSocket
4. Tracks result and P&L
5. Safety: daily loss limit, cooldown, max open contracts

## Usage

### Start Analysis
1. Click **Start Analysis** on Analyzer tab
2. Analyzer connects to all volatility indices
3. View rankings, scores, predictions across tabs

### Enable Auto-Trade
1. Go to Neural Net tab
2. Toggle Auto-Trade ON
3. Configure: contract type, stake, duration, thresholds
4. Engine places trades automatically when opportunities arise

### Safety Features
- Min score threshold (default: 65/100)
- Min confidence (default: 30%)
- Daily loss limit ($50)
- 15s cooldown between trades
- Max 1 open contract
- Ask price cap (1.5× stake)

## Files
| File | Purpose |
|------|---------|
| `lib/market-analyzer.ts` | Core analysis engine |
| `lib/digit-model.ts` | TF.js model proxy |
| `lib/auto-trade.ts` | Auto-trade engine |
| `public/tf-worker.js` | TF.js Web Worker |
| `docs/ANALYZER.md` | This file |
