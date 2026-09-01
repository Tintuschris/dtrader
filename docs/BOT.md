# Deriv STOCHRSI L-Shape Bot v3.0

An automated trading bot for Deriv's Volatility Indices (R_25, R_75, R_100, etc.) that detects **L-shaped patterns** on the Stochastic RSI indicator and places short-term tick trades.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [The L-Shape Strategy](#the-l-shape-strategy)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Quick Start](#quick-start)
6. [Authentication Modes](#authentication-modes)
7. [CLI Reference](#cli-reference)
8. [Terminal UI](#terminal-ui)
9. [Recording & Backtesting](#recording--backtesting)
10. [Bridge Endpoint (Next.js)](#bridge-endpoint-nextjs)
11. [Configuration Reference](#configuration-reference)
12. [Troubleshooting](#troubleshooting)
13. [File Structure](#file-structure)

---

## What It Does

The bot connects to Deriv's WebSocket API, streams real-time tick data for a volatility index, and runs a **Stochastic RSI** indicator pipeline. When it detects a specific **slanted L-shape** pattern on the raw StochRSI line, it automatically places a trade betting that the next few ticks will move in the expected direction.

**Key behaviors:**
- Streams live ticks and computes RSI → StochRSI → K/D indicators in real-time
- Detects L-shape patterns using a state machine that operates on **raw (unsmoothed) StochRSI** values
- Places tick trades (default: 5 ticks, $1 stake) on HIGHER or LOWER contracts
- Tracks trade resolution, win/loss, and session P&L
- Automatically reconnects if the WebSocket drops (exponential backoff)
- Sends keepalive pings every 30 seconds to prevent disconnection
- Shows a rich terminal UI with spark charts, indicator values, and detection phases

---

## The L-Shape Strategy

The strategy identifies a specific pattern on the **Stochastic RSI** oscillator:

### The Slanted L Pattern

```
StochRSI
1.0 |    /
    |   /
    |  /
0.8 | /
    |/___________  <- Flat zone (oversold/overbought)
    |             
0.2 |
    |______________
```

The pattern has three phases:

1. **Slope** — Raw StochRSI makes a sharp directional move (drops from high zone or rises from low zone)
2. **Flat** — Raw StochRSI goes flat near the oversold zone (≤0.20) or overbought zone (≥0.80) for at least 3 ticks
3. **Breakout** — Raw StochRSI suddenly reverses by ≥0.10 in a single tick

### Why Raw StochRSI (not smoothed K)?

The original implementation used SMA(3)-smoothed K values for detection. This **erased the sharp corner** of the L-shape, making the pattern invisible to the bot. TradingView shows the raw StochRSI line where the L-shape is clearly visible — the bot now uses the same data.

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `RAW_LEVEL_LOW` | 0.20 | Oversold zone threshold |
| `RAW_LEVEL_HIGH` | 0.80 | Overbought zone threshold |
| `RAW_FLAT_LOOKBACK` | 3 ticks | Minimum flat duration (6 seconds at R_25) |
| `RAW_FLAT_THRESHOLD` | 0.08 | Max variance during flat zone |
| `RAW_BREAKOUT_MIN` | 0.10 | Minimum single-tick reversal magnitude |
| `RAW_SLOPE_MIN` | -0.15 | Minimum downward slope threshold |
| `RAW_SLOPE_MAX` | 0.15 | Minimum upward slope threshold |

### Signal → Trade Mapping

| Pattern | Signal | Deriv Contract |
|---------|--------|----------------|
| Flat low + breakout UP | `HIGHER` (LONG) | CALL with barrier -0.23 |
| Flat high + breakout DOWN | `LOWER` (SHORT) | PUT with barrier +0.23 |

---

## Architecture

```
Deriv-Stochrsi-Video-Bot.py   ← Standalone Python bot
        │
        ├── PAT Mode ──────────→ REST API (api.derivws.com) → OTP WS URL → WebSocket
        │
        └── Bridge Mode ───────→ localhost:3000/api/deriv/bot-session → OTP WS URL → WebSocket
                                        │
                                        └── Next.js web app (OAuth session cookie)
```

### Authentication Flow

**PAT Mode** (recommended for local testing):
1. Bot calls `GET /trading/v1/options/accounts` with PAT token
2. Bot calls `POST /trading/v1/options/accounts/{id}/otp` to get OTP WebSocket URL
3. Bot connects to WebSocket and subscribes to ticks

**Bridge Mode** (shares web app's login):
1. Bot calls `GET localhost:3000/api/deriv/bot-session`
2. Bridge endpoint reads `dtrader_session` cookie from OAuth login
3. Bridge calls Deriv API with OAuth headers, returns OTP WebSocket URL
4. Bot connects to WebSocket

### Data Flow

```
Tick (every ~2s)
    → RSI(14) calculation
        → StochRSI(14) calculation
            → Raw SRSI detection state machine
                → L-shape signal? → Place trade
            → SMA(3) K/D smoothing (display only)
    → Terminal UI update
```

---

## Prerequisites

- **Python 3.9+** with `pip`
- **Deriv account** (demo or real)
- For Bridge mode: **Node.js** with the Next.js web app running

### Python Dependencies

```bash
pip install websockets aiohttp
```

---

## Quick Start

### Option 1: PAT Mode (Easiest)

1. Get a Personal Access Token from [Deriv API Dashboard](https://app.deriv.com/account/api-token)
   - Enable **Read** and **Trade** permissions

2. Set environment variables:

   ```bash
   # Linux/Mac
   export USE_BRIDGE=0
   export PAT_TOKEN="pat_your_token_here"
   export DERIV_APP_ID="your_app_id"
   ```

   ```powershell
   # Windows PowerShell
   $env:USE_BRIDGE="0"
   $env:PAT_TOKEN="pat_your_token_here"
   $env:DERIV_APP_ID="your_app_id"
   ```

   Or add to `.env.local`:
   ```
   USE_BRIDGE=0
   PAT_TOKEN=pat_your_token_here
   DERIV_APP_ID=your_app_id
   ```

3. Run the bot:
   ```bash
   python Deriv-Stochrsi-Video-Bot.py
   ```

### Option 2: Bridge Mode

1. Start the Next.js web app:
   ```bash
   npm run dev
   ```

2. Log in via the browser at `http://localhost:3000`

3. In a separate terminal:
   ```bash
   python Deriv-Stochrsi-Video-Bot.py
   ```

---

## Authentication Modes

| Feature | PAT Mode | Bridge Mode |
|---------|----------|-------------|
| Standalone (no web app) | ✅ | ❌ |
| Needs PAT token | ✅ | ❌ |
| Shares web app login | ❌ | ✅ |
| Works on deployed Vercel | ❌ (bot can't run on Vercel) | ✅ (web app on Vercel, bot on local/PC) |
| Best for | Local dev/testing | Production with shared auth |

**Note:** Vercel cannot run the bot — it only supports serverless functions that terminate after ~60 seconds. The bot needs a persistent WebSocket connection. Run it on your PC or a VPS.

---

## CLI Reference

```
usage: Deriv-Stochrsi-Video-Bot.py [-h] [-s SYMBOL] [--stake STAKE]
                                     [--duration DURATION]
                                     [--barrier-higher BARRIER_HIGHER]
                                     [--barrier-lower BARRIER_LOWER]
                                     {--account ACCOUNT} [--dry-run]
                                     [--record FILE] [--replay FILE]
                                     [--speed SPEED]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--symbol` | `-s` | `R_25` | Deriv symbol (R_25, R_75, R_100, etc.) |
| `--stake` | | `1` | Stake amount in USD |
| `--duration` | | `5` | Contract duration in ticks |
| `--barrier-higher` | | `-0.23` | Barrier for HIGHER (CALL) contract |
| `--barrier-lower` | | `+0.23` | Barrier for LOWER (PUT) contract |
| `--account` | | `demo` | Account type: `demo` or `real` |
| `--dry-run` | | off | Detect signals but don't place trades |
| `--record FILE` | | | Save live ticks to JSON for backtesting |
| `--replay FILE` | | | Replay recorded ticks through detection |
| `--speed N` | | `1.0` | Replay speed multiplier |

### Priority Chain

CLI args > Environment variables > Defaults

### Examples

```bash
# Default settings (R_25, $1, demo)
python Deriv-Stochrsi-Video-Bot.py

# R_75 with $5 stake on real account
python Deriv-Stochrsi-Video-Bot.py -s R_75 --stake 5 --account real

# Dry run — see signals without trading
python Deriv-Stochrsi-Video-Bot.py --dry-run

# Record ticks for later backtesting
python Deriv-Stochrsi-Video-Bot.py --record ticks.json --dry-run

# Replay at 50x speed
python Deriv-Stochrsi-Video-Bot.py --replay ticks.json --speed 50

# Custom barriers
python Deriv-Stochrsi-Video-Bot.py --barrier-higher -0.50 --barrier-lower +0.50

### Examples

```bash
# Default settings (R_25, $1, demo)
python Deriv-Stochrsi-Video-Bot.py

# R_75 with $5 stake on real account
python Deriv-Stochrsi-Video-Bot.py -s R_75 --stake 5 --account real

# Dry run — see signals without trading
python Deriv-Stochrsi-Video-Bot.py --dry-run

# Record ticks for later backtesting
python Deriv-Stochrsi-Video-Bot.py --record ticks.json --dry-run

# Replay at 50x speed
python Deriv-Stochrsi-Video-Bot.py --replay ticks.json --speed 50

# Custom barriers
python Deriv-Stochrsi-Video-Bot.py --barrier-higher -0.50 --barrier-lower +0.50
```

---

## Terminal UI

The bot displays a rich terminal interface with:

- **Header box** — Configuration summary (symbol, stake, duration, barriers, mode)
- **Tick lines** — `#NNN ^/v price [digit] SRSI:val sparkchart`
  - `^`/`v`/`-` = price direction (up/down/unchanged)
  - `[5]` = last digit (green ≥5, red <5)
  - `SRSI:0.124` = raw StochRSI value
  - Spark chart = ASCII price visualization
- **Detection panel** — Raw SRSI, K/D values, signal bar with 0.20/0.80 markers
- **Phase indicator** — State machine phase: `IDLE → SLOPE DN/UP → FLAT LOW/HIGH → READY-L/S`
- **Trade panels** — Signal alerts, contract details, progress bar, win/loss results with session stats

---

## Recording and Backtesting

### Record Live Ticks

```bash
python Deriv-Stochrsi-Video-Bot.py --record ticks.json --dry-run
```

- Records every tick to `ticks.json`
- Auto-saves every 10 ticks (survives crashes)
- Output: `{"symbol": "R_25", "ticks": [{"epoch": ..., "quote": ...}], "config": {...}}`

### Replay for Backtesting

```bash
python Deriv-Stochrsi-Video-Bot.py --replay ticks.json --speed 50
```

- Replays recorded ticks through the L-shape detector
- Simulates trade placement and win/loss based on barrier math
- Shows backtest statistics: signals found, trades, wins, losses, win rate, P&L
- `--speed 50` = 50x faster than real-time

---

## Bridge Endpoint (Next.js)

### `GET /api/deriv/bot-session`

Allows the Python bot to share the web app's OAuth session.

**Query Parameters:**
- `type` — `demo` (default) or `real`
- `accountId` — Specific account ID (optional, auto-selects if omitted)

**Response (200):** `{"url": "wss://...?token=...", "accountId": "VR12345", "type": "demo"}`

**Response (401):** `{"error": "Not authenticated. Log in via the web app first."}`

**Requirements:** Next.js app running + user logged in via browser.

---

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAT_TOKEN` | PAT mode | Personal Access Token from Deriv |
| `DERIV_APP_ID` | PAT mode | App ID from Deriv developer portal |
| `USE_BRIDGE` | No | `1` = bridge (default), `0` = PAT mode |
| `DTRADER_BRIDGE_URL` | No | Bridge URL (default: `http://localhost:3000`) |
| `ACCOUNT_TYPE` | No | `demo` (default) or `real` |
| `SYMBOL` | No | Override default symbol |
| `STAKE` | No | Override default stake |

### Indicator Parameters (in bot source)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `RAW_LEVEL_LOW` | 0.20 | Oversold zone threshold |
| `RAW_LEVEL_HIGH` | 0.80 | Overbought zone threshold |
| `RAW_FLAT_LOOKBACK` | 3 | Min flat ticks before breakout check |
| `RAW_FLAT_THRESHOLD` | 0.08 | Max variance during flat zone |
| `RAW_BREAKOUT_MIN` | 0.10 | Min single-tick reversal magnitude |
| `RAW_SLOPE_MIN` | -0.15 | Min downward slope trigger |
| `RAW_SLOPE_MAX` | 0.15 | Min upward slope trigger |

### Reconnection Settings

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_RECONNECT_ATTEMPTS` | 10 | Max retries before exiting |
| `RECONNECT_BASE_DELAY` | 2 | Base delay (seconds) |
| `PING_INTERVAL` | 30 | Keepalive ping interval (seconds) |

Backoff: `min(2 * 2^(attempts-1), 60)` seconds

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Bridge failed: Not authenticated" | Web app not running/logged in | Run `npm run dev` + log in, or use PAT mode |
| "No PAT_TOKEN for fallback" | Bridge failed + no PAT set | Set `USE_BRIDGE=0` + `PAT_TOKEN=...` |
| `ConnectionResetError` / `ConnectionClosedError` | Deriv closed WS (OTP expired) | Auto-reconnects in v3.0. Check network. |
| No signals fire for a long time | L-shape is rare by design | Try R_75/R_100, use `--dry-run`, record+replay |
| Windows asyncio errors | Python 3.14+ on Windows | Use Python 3.9-3.13, run with `python -u` |

---

## Running 24/7

The bot **cannot run on Vercel** (serverless timeout). Options:

- **Your PC** — `python -u Deriv-Stochrsi-Video-Bot.py` (free)
- **VPS** — `nohup python -u Deriv-Stochrsi-Video-Bot.py > bot.log 2>&1 &` ($5/mo on DigitalOcean)
- **Docker** — `FROM python:3.11-slim` + `pip install websockets aiohttp` (on VPS)

---

## File Structure

```
project-root/
├── Deriv-Stochrsi-Video-Bot.py     # Main bot (~700 lines)
├── .env.local                        # Credentials (not committed)
├── .env.example                      # Template for credentials
├── app/api/deriv/
│   ├── bot-session/route.ts          # Bridge endpoint for bot auth
│   └── callback/route.ts             # OAuth callback for web app
├── lib/deriv-session.ts              # OAuth session management
├── components/
│   ├── trading-terminal.tsx          # Web app trading UI
│   ├── tick-chart.tsx                # TradingView chart
│   ├── trading-context.tsx           # Shared trading state
│   └── use-deriv-ws.ts              # WebSocket hook
└── docs/BOT.md                       # This file
```

### Git History (bot-related)

```
25fa0bf Add simulation mode: record ticks and replay for backtesting
c09e29e Add CLI arguments for symbol, stake, duration, barriers, dry-run
bd80815 Fix buy request: move symbol to top level per Deriv API spec
3cbeb0a Upgrade bot to v3.0: raw StochRSI detection + reconnection + keepalive
71a21b4 Enhance Python bot with rich terminal UI
7270bf3 Fix bot and bridge endpoint for Deriv snake_case API fields
559a4b5 Add Python STOCHRSI bot with bridge auth and PAT mode support
```
