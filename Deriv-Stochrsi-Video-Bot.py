"""
Deriv Video Strategy - Exact Clone (Maconny L-Shape)
Video: Volatility 25 Index, 1-tick chart, STOCHRSI(14) with 0.3/0.7 levels
Trade: Higher/Lower 5 ticks with barrier offset -0.23 / +0.23

AUTH: Two modes supported:
  1. BRIDGE MODE (default) — piggybacks on the DTrader web app OAuth session.
     Run the Next.js app first, log in, then start this bot. It calls
     localhost:3000/api/deriv/bot-session to get an authenticated WS URL.
  2. PAT MODE — standalone auth with a Personal Access Token.
     Set PAT_TOKEN and APP_ID below (or in .env.local).

Install: pip install websockets aiohttp
"""

import asyncio
import json
import os
import time
from collections import deque
import aiohttp
import websockets

# ============ CONFIG ============
# Bridge mode: point to the running DTrader Next.js app
BRIDGE_URL = os.environ.get("DTRADER_BRIDGE_URL", "http://localhost:3000")
USE_BRIDGE = os.environ.get("USE_BRIDGE", "1") == "1"  # set to "0" for PAT mode

# PAT mode: only used when USE_BRIDGE=0
PAT_TOKEN = os.environ.get("PAT_TOKEN", "")
APP_ID = os.environ.get("DERIV_APP_ID", "")

ACCOUNT_TYPE = os.environ.get("ACCOUNT_TYPE", "demo")  # "demo" or "real"
SYMBOL = "R_25"  # Volatility 25 Index

STAKE = 1  # USD
CURRENCY = "USD"

# Barrier offset - THIS IS WHAT YOU CHANGE PER VIDEO
BARRIER_HIGHER = "-0.23"
BARRIER_LOWER = "+0.23"

DURATION = 5
DURATION_UNIT = "t"  # t = ticks

# STOCHRSI Settings - exactly as video
RSI_PERIOD = 14
STOCH_PERIOD = 14
K_SMOOTH = 3
D_SMOOTH = 3
LEVEL_LOW = 0.3
LEVEL_HIGH = 0.7

# L-Shape detection settings
FLAT_LOOKBACK = 6
FLAT_THRESHOLD = 0.06
BREAKOUT_MIN = 0.12
# =============================================

REST_BASE = "https://api.derivws.com"
WS_URL = None

# Buffers
closes = deque(maxlen=200)
rsi_vals = deque(maxlen=200)
stochrsi_vals = deque(maxlen=200)
k_vals = deque(maxlen=200)
d_vals = deque(maxlen=200)


def calc_rsi(prices, period=14):
    if len(prices) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def calc_stochrsi(rsi_list, stoch_period=14):
    if len(rsi_list) < stoch_period:
        return None
    recent = list(rsi_list)[-stoch_period:]
    lowest = min(recent)
    highest = max(recent)
    if highest == lowest:
        return 0
    return (recent[-1] - lowest) / (highest - lowest)


def sma(vals, period):
    if len(vals) < period:
        return None
    return sum(list(vals)[-period:]) / period


def is_flat(values, lookback, threshold):
    if len(values) < lookback + 1:
        return False
    recent = list(values)[-lookback - 1 : -1]
    return (max(recent) - min(recent)) < threshold


# ============ AUTH: BRIDGE MODE ============


async def get_ws_url_via_bridge():
    """Get authenticated WS URL from the DTrader web app bridge endpoint."""
    url = f"{BRIDGE_URL}/api/deriv/bot-session?type={ACCOUNT_TYPE}"
    print(f"[Bridge] Requesting WS session from {url}")
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"Bridge error: {data.get('error', resp.status)}")
            ws_url = data.get("url")
            account_id = data.get("accountId", "?")
            print(f"[Bridge] Got WS URL for account {account_id}")
            return ws_url


# ============ AUTH: PAT MODE (standalone) ============


async def get_accounts():
    url = f"{REST_BASE}/trading/v1/options/accounts"
    headers = {
        "Authorization": f"Bearer {PAT_TOKEN}",
        "Deriv-App-ID": APP_ID,
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"Accounts fetch failed: {data}")
            return data


def select_account(accounts_data):
    accounts = []
    if "data" in accounts_data:
        d = accounts_data["data"]
        if isinstance(d, dict) and "accounts" in d:
            accounts = d["accounts"]
        elif isinstance(d, list):
            accounts = d
    elif "accounts" in accounts_data:
        accounts = accounts_data["accounts"]
    else:
        accounts = accounts_data if isinstance(accounts_data, list) else []

    if not accounts:
        return None

    selected = None
    for acc in accounts:
        acc_id = acc.get("accountId") or acc.get("id") or acc.get("loginid")
        is_virtual = acc.get("isVirtual") or acc.get("is_virtual") or False
        acc_type = acc.get("accountType") or ("demo" if is_virtual else "real")
        is_demo = is_virtual or acc_type == "demo" or str(acc_id).startswith("VR")
        if ACCOUNT_TYPE == "demo" and is_demo:
            selected = acc
            break
        if ACCOUNT_TYPE == "real" and not is_demo:
            selected = acc
            break
    if not selected and accounts:
        selected = accounts[0]

    acc_id = selected.get("accountId") or selected.get("id") or selected.get("loginid")
    print(f"SELECTED ACCOUNT: {acc_id} ({ACCOUNT_TYPE})")
    confirm = input(f"Type YES to confirm trading on {acc_id}: ")
    if confirm.strip() != "YES":
        raise Exception("User did not confirm account")
    return acc_id


async def get_otp_url(account_id):
    url = f"{REST_BASE}/trading/v1/options/accounts/{account_id}/otp"
    headers = {
        "Authorization": f"Bearer {PAT_TOKEN}",
        "Deriv-App-ID": APP_ID,
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json={}) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"OTP failed: {data}")
            ws_url = None
            if "data" in data and isinstance(data["data"], dict):
                ws_url = data["data"].get("url") or data["data"].get("otpUrl")
            if not ws_url and "url" in data:
                ws_url = data["url"]
            return ws_url


# ============ TRADE PLACEMENT ============


async def place_trade(ws, direction, barrier):
    """Place a Higher or Lower trade with L-shape strategy parameters."""
    contract_type = "CALL" if direction == "higher" else "PUT"
    proposal = {
        "buy": 1,
        "price": STAKE,
        "parameters": {
            "amount": STAKE,
            "basis": "stake",
            "contract_type": contract_type,
            "currency": CURRENCY,
            "duration": DURATION,
            "duration_unit": DURATION_UNIT,
            "symbol": SYMBOL,
            "barrier": barrier,
        },
    }
    print(f">>> PLACING {direction.upper()} | barrier={barrier} | stake=${STAKE}")
    await ws.send(json.dumps(proposal))


async def process_tick(ws, tick_data, last_trade_time):
    """Process a single tick: update indicators, detect L-shape, place trade."""
    price = tick_data["quote"]
    epoch = tick_data["epoch"]
    closes.append(price)

    # Calculate RSI
    rsi = calc_rsi(list(closes), RSI_PERIOD)
    if rsi is not None:
        rsi_vals.append(rsi)

        # Calculate StochRSI
        stochrsi = calc_stochrsi(list(rsi_vals), STOCH_PERIOD)
        if stochrsi is not None:
            stochrsi_vals.append(stochrsi)

            # Calculate K and D lines (SMA smoothing)
            k = sma(list(stochrsi_vals), K_SMOOTH)
            d = sma(list(stochrsi_vals), D_SMOOTH) if len(stochrsi_vals) >= D_SMOOTH else k

            if k is not None:
                k_vals.append(k)
            if d is not None:
                d_vals.append(d)

            if len(k_vals) < 2 or len(d_vals) < 2:
                return

            k_now = k_vals[-1]
            k_prev = k_vals[-2]
            d_now = d_vals[-1]

            # Print current state
            print(
                f"  price={price:.4f} | RSI={rsi:.2f} | StochRSI={stochrsi:.4f} "
                f"| K={k_now:.4f} D={d_now:.4f}",
                end="",
            )

            # Cooldown: don't trade more than once per duration period
            now = time.time()
            cooldown = DURATION + 2
            if now - last_trade_time < cooldown:
                print(" | [cooldown]")
                return

            # === L-SHAPE DETECTION ===

            # Buy signal: K was flat near LOW, now breaks UP
            k_was_flat_low = (
                is_flat(list(k_vals), FLAT_LOOKBACK, FLAT_THRESHOLD)
                and k_prev <= LEVEL_LOW + FLAT_THRESHOLD
            )
            k_breaking_up = k_now > k_prev and (k_now - k_prev) >= BREAKOUT_MIN

            # Sell signal: K was flat near HIGH, now breaks DOWN
            k_was_flat_high = (
                is_flat(list(k_vals), FLAT_LOOKBACK, FLAT_THRESHOLD)
                and k_prev >= LEVEL_HIGH - FLAT_THRESHOLD
            )
            k_breaking_down = k_now < k_prev and (k_prev - k_now) >= BREAKOUT_MIN

            if k_was_flat_low and k_breaking_up:
                print(" | >>> L-SHAPE LONG <<<")
                await place_trade(ws, "higher", BARRIER_HIGHER)
                last_trade_time = now
            elif k_was_flat_high and k_breaking_down:
                print(" | >>> L-SHAPE SHORT <<<")
                await place_trade(ws, "lower", BARRIER_LOWER)
                last_trade_time = now
            else:
                print(" | [waiting]")


# ============ TRADING LOOP ============


async def trading_loop():
    global WS_URL

    use_bridge = USE_BRIDGE

    if use_bridge:
        try:
            WS_URL = await get_ws_url_via_bridge()
        except Exception as e:
            print(f"[Bridge] Failed: {e}")
            if not PAT_TOKEN:
                print("No PAT_TOKEN configured for fallback. Exiting.")
                return
            print("Falling back to PAT mode...")
            use_bridge = False

    if not use_bridge or not WS_URL:
        try:
            acc_data = await get_accounts()
            acc_id = select_account(acc_data)
            WS_URL = await get_otp_url(acc_id)
        except Exception as e:
            print(f"PAT auth error: {e}")
            return

    if not WS_URL:
        print("Could not obtain WebSocket URL. Exiting.")
        return

    print(f"\nConnecting to WS...")

    async with websockets.connect(WS_URL) as ws:
        if ("binaryws.com" in WS_URL or "otp" not in WS_URL) and PAT_TOKEN:
            await ws.send(json.dumps({"authorize": PAT_TOKEN}))
            auth_resp = json.loads(await ws.recv())
            print(f"Auth response: {auth_resp}")
            if "error" in auth_resp:
                raise Exception(f"Authorize failed: {auth_resp['error']}")

        await ws.send(json.dumps({"ticks": SYMBOL, "subscribe": 1}))
        print(f"Subscribed to {SYMBOL} ticks - waiting for STOCHRSI L-shape...")
        await ws.send(json.dumps({"balance": 1, "subscribe": 1}))

        last_trade_time = 0

        async for msg in ws:
            data = json.loads(msg)

            if data.get("msg_type") == "tick":
                tick = data.get("tick", {})
                if tick:
                    await process_tick(ws, tick, last_trade_time)

            elif data.get("msg_type") == "proposal":
                contract = data.get("proposal", {})
                ptype = contract.get("contract_type", "?")
                payout = contract.get("payout", "?")
                print(f"  [proposal] {ptype} payout=${payout}")

            elif data.get("msg_type") == "buy":
                buy = data.get("buy", {})
                if "error" in data:
                    print(f"  [BUY ERROR] {data['error']}")
                elif buy:
                    contract_id = buy.get("contract_id", "?")
                    cost = buy.get("buy_price", "?")
                    print(f"  [BOUGHT] contract_id={contract_id} cost=${cost}")
                    await ws.send(json.dumps({
                        "proposal_open_contract": 1,
                        "contract_id": contract_id,
                    }))

            elif data.get("msg_type") == "proposal_open_contract":
                poc = data.get("proposal_open_contract", {})
                if poc:
                    status = poc.get("status", "")
                    profit = poc.get("profit", 0)
                    if status in ("expired", "sold"):
                        result = "WIN" if profit >= 0 else "LOSS"
                        print(f"  [{result}] profit=${profit:.2f}")
                    elif status == "open":
                        cur = poc.get("current_tick", "?")
                        total = poc.get("tick_count", "?")
                        print(f"  [open] tick {cur}/{total}", end="\r")

            elif data.get("msg_type") == "balance":
                bal = data.get("balance", {})
                amount = bal.get("balance", "?")
                print(f"  [balance] ${amount}")

            elif data.get("msg_type") == "ping":
                await ws.send(json.dumps({"pong": 1}))


# ============ MAIN ============


if __name__ == "__main__":
    print("=" * 50)
    print("Deriv STOCHRSI L-Shape Bot")
    print(f"Mode: {'BRIDGE' if USE_BRIDGE else 'PAT'}")
    print(f"Symbol: {SYMBOL} | Stake: ${STAKE} | Duration: {DURATION}{DURATION_UNIT}")
    print(f"Barrier: H={BARRIER_HIGHER} / L={BARRIER_LOWER}")
    print("=" * 50)
    asyncio.run(trading_loop())
