"""
Deriv Video Strategy - Enhanced CLI
Maconny L-Shape with rich terminal output.
"""

import asyncio
import json
import os
import sys
import time
from collections import deque

import aiohttp
import websockets

# ============ CONFIG ============
BRIDGE_URL = os.environ.get("DTRADER_BRIDGE_URL", "http://localhost:3000")
USE_BRIDGE = os.environ.get("USE_BRIDGE", "1") == "1"
PAT_TOKEN = os.environ.get("PAT_TOKEN", "")
APP_ID = os.environ.get("DERIV_APP_ID", "")
ACCOUNT_TYPE = os.environ.get("ACCOUNT_TYPE", "demo")
SYMBOL = "R_25"
STAKE = 1
CURRENCY = "USD"
BARRIER_HIGHER = "-0.23"
BARRIER_LOWER = "+0.23"
DURATION = 5
DURATION_UNIT = "t"
RSI_PERIOD = 14
STOCH_PERIOD = 14
K_SMOOTH = 3
D_SMOOTH = 3
LEVEL_LOW = 0.3
LEVEL_HIGH = 0.7
FLAT_LOOKBACK = 6
FLAT_THRESHOLD = 0.06
BREAKOUT_MIN = 0.12
REST_BASE_URL = "https://api.derivws.com"
WS_URL = None

# ============ ANSI COLORS ============
RST = "\033[0m"
BLD = "\033[1m"
DIM = "\033[2m"
GRN = "\033[92m"
RED = "\033[91m"
YLW = "\033[93m"
CYN = "\033[96m"
MAG = "\033[95m"
WHT = "\033[97m"

# Buffers
closes = deque(maxlen=200)
rsi_vals = deque(maxlen=200)
stochrsi_vals = deque(maxlen=200)
k_vals = deque(maxlen=200)
d_vals = deque(maxlen=200)
tick_history = deque(maxlen=60)

# Stats
stats = {"trades": 0, "wins": 0, "losses": 0, "total_pnl": 0.0, "balance": 0.0}
active_contract = None
_tick_count = 0
_in_cooldown = False


# ============ INDICATOR MATH ============

def calc_rsi(prices, period=14):
    if len(prices) < period + 1:
        return None
    gains, losses = [], []
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


def calc_stochrsi(rsi_list, period=14):
    if len(rsi_list) < period:
        return None
    recent = list(rsi_list)[-period:]
    lo, hi = min(recent), max(recent)
    if hi == lo:
        return 0
    return (recent[-1] - lo) / (hi - lo)


def sma(vals, period):
    if len(vals) < period:
        return None
    return sum(list(vals)[-period:]) / period


def is_flat(values, lookback, threshold):
    if len(values) < lookback + 1:
        return False
    recent = list(values)[-lookback - 1 : -1]
    return (max(recent) - min(recent)) < threshold


# ============ UI HELPERS ============

def mini_spark(values, width=20):
    if len(values) < 2:
        return "." * width
    recent = list(values)[-width:]
    lo, hi = min(recent), max(recent)
    rng = hi - lo if hi != lo else 1
    blocks = ["_", ".", "o", "O", "0", "X", "#", "@"]
    result = []
    for v in recent:
        idx = int(((v - lo) / rng) * (len(blocks) - 1))
        result.append(blocks[idx])
    return "".join(result)


def signal_bar(k_now):
    w = 30
    pos = max(0, min(1, k_now))
    filled = int(pos * w)
    low_pos = int(LEVEL_LOW * w)
    high_pos = int(LEVEL_HIGH * w)
    parts = []
    for i in range(w):
        if i == low_pos or i == high_pos:
            parts.append("|")
        elif i < filled:
            if i < low_pos:
                parts.append(RED + "#" + RST)
            elif i < high_pos:
                parts.append(YLW + "#" + RST)
            else:
                parts.append(GRN + "#" + RST)
        else:
            parts.append(DIM + "." + RST)
    return "".join(parts) + " " + f"{k_now:.4f}"


def print_header():
    print()
    print(f"{BLD}{CYN}+{'='*56}+{RST}")
    print(f"{CYN}|{RST}  {BLD}Deriv STOCHRSI L-Shape Bot{RST}  {DIM}v2.0 Enhanced CLI{RST}")
    print(f"{CYN}+{'='*56}+{RST}")
    print(f"{CYN}|{RST}  Symbol:    {BLD}{SYMBOL}{RST}                          Duration: {BLD}{DURATION}{DURATION_UNIT}{RST}")
    print(f"{CYN}|{RST}  Stake:     {GRN}${STAKE} {CURRENCY}{RST}                       Barrier:  {BLD}{BARRIER_HIGHER}/{BARRIER_LOWER}{RST}")
    print(f"{CYN}|{RST}  Mode:      {BLD}{'BRIDGE' if USE_BRIDGE else 'PAT'}{RST}")
    print(f"{CYN}|{RST}  Strategy:  {MAG}STOCHRSI({RSI_PERIOD}) {LEVEL_LOW}/{LEVEL_HIGH} L-shape{RST}")
    print(f"{CYN}+{'='*56}+{RST}")
    print()


def print_dashboard():
    n = len(k_vals)
    if n < 2:
        rsi_n = len(rsi_vals)
        stoch_n = len(stochrsi_vals)
        needed = max(0, RSI_PERIOD + 1 - rsi_n) + max(0, STOCH_PERIOD - stoch_n)
        print(f"  {DIM}+--- WARMUP -------------------------------------+{RST}")
        print(f"  {DIM}|{RST}  RSI: {YLW}{rsi_n:2d}{RST}/{RSI_PERIOD+1}  StochRSI: {YLW}{stoch_n:2d}{RST}/{STOCH_PERIOD}  {DIM}~{needed} ticks left{RST}")
        print(f"  {DIM}+------------------------------------------------+{RST}")
        return

    k_now = k_vals[-1]
    k_prev = k_vals[-2]
    rsi_now = rsi_vals[-1] if rsi_vals else 0
    stoch_now = stochrsi_vals[-1] if stochrsi_vals else 0
    d_now = d_vals[-1] if d_vals else 0

    k_color = GRN if k_now > LEVEL_HIGH else (RED if k_now < LEVEL_LOW else YLW)
    rsi_color = GRN if rsi_now > 55 else (RED if rsi_now < 45 else YLW)

    k_diff = k_now - k_prev
    if k_diff > 0.001:
        trend = GRN + f"UP +{k_diff:.4f}" + RST
    elif k_diff < -0.001:
        trend = RED + f"DN {k_diff:.4f}" + RST
    else:
        trend = DIM + "FLAT" + RST

    print(f"  {DIM}+--- INDICATORS ----------------------------------+{RST}")
    print(f"  {DIM}|{RST}  RSI({RSI_PERIOD}):  {rsi_color}{BLD}{rsi_now:6.2f}{RST}  |  StochRSI: {MAG}{BLD}{stoch_now:6.4f}{RST}  |  {trend}")
    print(f"  {DIM}|{RST}  K({K_SMOOTH}):    {k_color}{BLD}{k_now:6.4f}{RST}  |  D({D_SMOOTH}):    {CYN}{BLD}{d_now:6.4f}{RST}")
    print(f"  {DIM}|{RST}  K line:  {DIM}{mini_spark(k_vals, 30)}{RST}")
    print(f"  {DIM}|{RST}  Signal:  {signal_bar(k_now)}")
    print(f"  {DIM}|{RST}  Levels:  {RED}0.3{RST}{DIM}---------{YLW}MID{YLW}{DIM}---------{GRN}0.7{RST}")
    print(f"  {DIM}+------------------------------------------------+{RST}")


def print_tick(price, tick_num):
    if len(closes) >= 2:
        prev = list(closes)[-2]
        arrow = GRN + "^" + RST if price > prev else (RED + "v" + RST if price < prev else DIM + "-" + RST)
    else:
        arrow = DIM + "." + RST

    digit = int(str(price).split(".")[-1][-1]) if "." in str(price) else 0
    digit_color = GRN if digit >= 5 else RED
    spark = mini_spark(tick_history, 30)

    print(f"  {DIM}#{tick_num:>4d}{RST} {arrow} {BLD}{price:.4f}{RST}  {digit_color}[{digit}]{RST}  {DIM}{spark}{RST}")


def print_signal(direction, k_val, reason):
    if direction == "higher":
        print(f"  {BLD}{GRN}{'='*56}{RST}")
        print(f"  {BLD}{GRN}  >>>  L-SHAPE LONG SIGNAL  <<<{RST}")
        print(f"  {BLD}{GRN}  K={k_val:.4f} broke UP from oversold zone{RST}")
        print(f"  {GRN}  Reason: {reason}{RST}")
        print(f"  {GRN}  Barrier: {BARRIER_HIGHER} | Contract: HIGHER | Stake: ${STAKE}{RST}")
        print(f"  {BLD}{GRN}{'='*56}{RST}")
    else:
        print(f"  {BLD}{RED}{'='*56}{RST}")
        print(f"  {BLD}{RED}  <<<  L-SHAPE SHORT SIGNAL  >>>{RST}")
        print(f"  {BLD}{RED}  K={k_val:.4f} broke DOWN from overbought zone{RST}")
        print(f"  {RED}  Reason: {reason}{RST}")
        print(f"  {RED}  Barrier: {BARRIER_LOWER} | Contract: LOWER | Stake: ${STAKE}{RST}")
        print(f"  {BLD}{RED}{'='*56}{RST}")


def print_trade_placed(contract_id, direction, cost, payout):
    print(f"  {BLD}{YLW}+--- TRADE PLACED --------------------------------+{RST}")
    print(f"  {YLW}|{RST}  Contract:   {BLD}{contract_id}{RST}")
    print(f"  {YLW}|{RST}  Direction:  {BLD}{direction.upper()}{RST}")
    print(f"  {YLW}|{RST}  Cost:       {RED}${cost}{RST}")
    print(f"  {YLW}|{RST}  Payout:     {GRN}${payout}{RST}")
    print(f"  {YLW}|{RST}  Duration:   {DURATION}{DURATION_UNIT} ({DURATION} ticks)")
    print(f"  {YLW}|{RST}  {DIM}Waiting for {DURATION} ticks to settle...{RST}")
    print(f"  {YLW}+------------------------------------------------+{RST}")


def print_trade_progress(current, total, entry_price, barrier):
    pct = current / total if total > 0 else 0
    bar_w = 20
    filled = int(pct * bar_w)
    bar = GRN + "#" * filled + DIM + "." * (bar_w - filled) + RST
    print(f"  {CYN}>> [{bar}] {current}/{total} ticks  {DIM}entry={entry_price:.4f} barrier={barrier}{RST}", end="\r", flush=True)


def print_trade_result(status, profit, entry_price, exit_price, direction, contract_id):
    is_win = profit >= 0
    rc = GRN if is_win else RED
    txt = "WIN" if is_win else "LOSS"

    stats["trades"] += 1
    stats["total_pnl"] += profit
    if is_win:
        stats["wins"] += 1
    else:
        stats["losses"] += 1

    wr = (stats["wins"] / stats["trades"] * 100) if stats["trades"] > 0 else 0

    print()
    print(f"  {rc}{'='*56}{RST}")
    print(f"  {BLD}{rc}  TRADE {txt}  {RST}")
    print(f"  {rc}{'='*56}{RST}")
    print(f"  {DIM}|{RST}  Contract:   {BLD}{contract_id}{RST}")
    print(f"  {DIM}|{RST}  Direction:  {BLD}{direction.upper()}{RST}")
    print(f"  {DIM}|{RST}  Entry:      {entry_price:.4f}")
    print(f"  {DIM}|{RST}  Exit:       {exit_price:.4f}")
    print(f"  {DIM}|{RST}  Barrier:    {BARRIER_HIGHER if direction == 'higher' else BARRIER_LOWER}")
    print(f"  {DIM}|{RST}  Profit:     {rc}{BLD}${profit:+.2f}{RST}")
    print(f"  {DIM}|{RST}  Balance:    {BLD}${stats['balance']:.2f}{RST}")
    print(f"  {DIM}|{RST}")
    print(f"  {DIM}|{RST}  Session:  {stats['trades']} trades  |  {GRN}{stats['wins']}W{RST} {RED}{stats['losses']}L{RST}  |  WR: {BLD}{wr:.0f}%{RST}  |  PnL: {rc}${stats['total_pnl']:+.2f}{RST}")
    print(f"  {rc}{'='*56}{RST}")


def print_balance(amount):
    stats["balance"] = float(amount) if amount != "?" else stats["balance"]
    print(f"  {DIM}Balance: ${stats['balance']:.2f}{RST}")


# ============ AUTH ============

async def get_ws_url_via_bridge():
    url = f"{BRIDGE_URL}/api/deriv/bot-session?type={ACCOUNT_TYPE}"
    print(f"  {CYN}>{RST} Requesting WS session from bridge...")
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"Bridge error: {data.get('error', resp.status)}")
            print(f"  {GRN}+{RST} Got WS URL for account {data.get('accountId', '?')}")
            return data.get("url")


async def get_accounts():
    url = f"{REST_BASE_URL}/trading/v1/options/accounts"
    headers = {"Authorization": f"Bearer {PAT_TOKEN}", "Deriv-App-ID": APP_ID, "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"Accounts fetch failed: {data}")
            return data


def select_account(accounts_data):
    d = accounts_data.get("data") if isinstance(accounts_data, dict) else None
    if isinstance(d, list):
        accounts = d
    elif isinstance(d, dict) and "accounts" in d:
        accounts = d["accounts"]
    elif isinstance(accounts_data, list):
        accounts = accounts_data
    else:
        accounts = []
    if not accounts:
        return None
    selected = None
    for acc in accounts:
        acc_id = acc.get("account_id") or acc.get("accountId") or acc.get("id") or acc.get("loginid")
        is_virtual = acc.get("is_virtual") or acc.get("isVirtual") or (acc.get("account_type") == "demo")
        acc_type = acc.get("account_type") or acc.get("accountType") or ("demo" if is_virtual else "real")
        is_demo = is_virtual or acc_type == "demo" or str(acc_id).startswith("VR") or str(acc_id).startswith("DOT")
        if ACCOUNT_TYPE == "demo" and is_demo:
            selected = acc
            break
        if ACCOUNT_TYPE == "real" and not is_demo:
            selected = acc
            break
    if not selected and accounts:
        selected = accounts[0]
    return selected.get("account_id") or selected.get("accountId") or selected.get("id") or selected.get("loginid")


async def get_otp_url(account_id):
    url = f"{REST_BASE_URL}/trading/v1/options/accounts/{account_id}/otp"
    headers = {"Authorization": f"Bearer {PAT_TOKEN}", "Deriv-App-ID": APP_ID, "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json={}) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise Exception(f"OTP failed: {data}")
            if "data" in data and isinstance(data["data"], dict):
                return data["data"].get("url") or data["data"].get("otpUrl")
            return data.get("url")


# ============ TRADE PLACEMENT ============

async def place_trade(ws, direction, barrier):
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
    await ws.send(json.dumps(proposal))


# ============ TICK PROCESSING ============

async def process_tick(ws, tick_data, last_trade_time):
    global _tick_count, _in_cooldown, active_contract
    _tick_count += 1
    price = tick_data["quote"]
    closes.append(price)
    tick_history.append(price)

    print_tick(price, _tick_count)

    # Calculate indicators
    rsi = calc_rsi(list(closes), RSI_PERIOD)
    if rsi is not None:
        rsi_vals.append(rsi)
        stochrsi = calc_stochrsi(list(rsi_vals), STOCH_PERIOD)
        if stochrsi is not None:
            stochrsi_vals.append(stochrsi)
            k = sma(list(stochrsi_vals), K_SMOOTH)
            d = sma(list(stochrsi_vals), D_SMOOTH) if len(stochrsi_vals) >= D_SMOOTH else k
            if k is not None:
                k_vals.append(k)
            if d is not None:
                d_vals.append(d)

    print_dashboard()

    if len(k_vals) < 2 or active_contract:
        return last_trade_time

    k_now = k_vals[-1]
    k_prev = k_vals[-2]

    # Cooldown
    now = time.time()
    if now - last_trade_time < (DURATION + 2):
        if not _in_cooldown:
            remaining = int((DURATION + 2) - (now - last_trade_time))
            print(f"  {DIM}Cooldown: {remaining}s remaining{RST}")
            _in_cooldown = True
        return last_trade_time
    _in_cooldown = False

    # === L-SHAPE DETECTION ===
    k_was_flat_low = (
        is_flat(list(k_vals), FLAT_LOOKBACK, FLAT_THRESHOLD)
        and k_prev <= LEVEL_LOW + FLAT_THRESHOLD
    )
    k_breaking_up = k_now > k_prev and (k_now - k_prev) >= BREAKOUT_MIN

    k_was_flat_high = (
        is_flat(list(k_vals), FLAT_LOOKBACK, FLAT_THRESHOLD)
        and k_prev >= LEVEL_HIGH - FLAT_THRESHOLD
    )
    k_breaking_down = k_now < k_prev and (k_prev - k_now) >= BREAKOUT_MIN

    if k_was_flat_low and k_breaking_up:
        reason = f"K flat at {k_prev:.4f} (near {LEVEL_LOW}), breakout +{k_now - k_prev:.4f}"
        print_signal("higher", k_now, reason)
        active_contract = {"direction": "higher", "entry_price": price}
        await place_trade(ws, "higher", BARRIER_HIGHER)
        return now

    if k_was_flat_high and k_breaking_down:
        reason = f"K flat at {k_prev:.4f} (near {LEVEL_HIGH}), breakout -{k_prev - k_now:.4f}"
        print_signal("lower", k_now, reason)
        active_contract = {"direction": "lower", "entry_price": price}
        await place_trade(ws, "lower", BARRIER_LOWER)
        return now

    return last_trade_time


# ============ TRADING LOOP ============

async def trading_loop():
    global WS_URL, stats

    print_header()
    print(f"  {CYN}>{RST} Authenticating...")
    use_bridge = USE_BRIDGE
    if use_bridge:
        try:
            WS_URL = await get_ws_url_via_bridge()
        except Exception as e:
            print(f"  {RED}X Bridge failed: {e}{RST}")
            if not PAT_TOKEN:
                print(f"  {RED}No PAT_TOKEN for fallback. Exiting.{RST}")
                return
            print(f"  {YLW}> Falling back to PAT mode...{RST}")
            use_bridge = False

    if not use_bridge or not WS_URL:
        try:
            acc_data = await get_accounts()
            acc_id = select_account(acc_data)
            if not acc_id:
                print(f"  {RED}X No matching {ACCOUNT_TYPE} account found{RST}")
                return
            print(f"  {GRN}+{RST} Account: {BLD}{acc_id}{RST} ({ACCOUNT_TYPE})")
            WS_URL = await get_otp_url(acc_id)
        except Exception as e:
            print(f"  {RED}X PAT auth error: {e}{RST}")
            return

    if not WS_URL:
        print(f"  {RED}X Could not obtain WebSocket URL{RST}")
        return

    print(f"  {CYN}>{RST} Connecting to Deriv WebSocket...")
    async with websockets.connect(WS_URL) as ws:
        if ("binaryws.com" in WS_URL or "otp" not in WS_URL) and PAT_TOKEN:
            await ws.send(json.dumps({"authorize": PAT_TOKEN}))
            auth_resp = json.loads(await ws.recv())
            if "error" in auth_resp:
                print(f"  {RED}X Auth failed: {auth_resp['error']}{RST}")
                return
            print(f"  {GRN}+{RST} Authenticated")

        await ws.send(json.dumps({"ticks": SYMBOL, "subscribe": 1}))
        await ws.send(json.dumps({"balance": 1, "subscribe": 1}))
        print(f"  {GRN}+{RST} Subscribed to {SYMBOL}")
        print(f"  {DIM}{'-'*56}{RST}")
        print(f"  {DIM}Watching for L-shape signals...{RST}")
        print(f"  {DIM}{'-'*56}{RST}")
        print()

        last_trade_time = 0

        async for msg in ws:
            data = json.loads(msg)

            if data.get("msg_type") == "tick":
                tick = data.get("tick", {})
                if tick:
                    result = await process_tick(ws, tick, last_trade_time)
                    if isinstance(result, (int, float)):
                        last_trade_time = result

            elif data.get("msg_type") == "proposal":
                contract = data.get("proposal", {})
                ptype = contract.get("contract_type", "?")
                payout = contract.get("payout", "?")
                cost = contract.get("ask_price", "?")
                print(f"  {YLW}Proposal: {ptype} | Cost: ${cost} | Payout: ${payout}{RST}")

            elif data.get("msg_type") == "buy":
                buy = data.get("buy", {})
                if "error" in data:
                    print(f"  {RED}X BUY ERROR: {data['error']}{RST}")
                    active_contract = None
                elif buy:
                    cid = buy.get("contract_id", "?")
                    cost = buy.get("buy_price", "?")
                    payout = buy.get("payout", "?")
                    direction = active_contract["direction"] if active_contract else "?"
                    print_trade_placed(cid, direction, cost, payout)
                    if active_contract:
                        active_contract["contract_id"] = cid
                    await ws.send(json.dumps({"proposal_open_contract": 1, "contract_id": cid}))

            elif data.get("msg_type") == "proposal_open_contract":
                poc = data.get("proposal_open_contract", {})
                if poc:
                    status = poc.get("status", "")
                    profit = poc.get("profit", 0)
                    entry = poc.get("entry_tick", 0)
                    exit_p = poc.get("exit_tick", 0)
                    cur = poc.get("current_tick", 0)
                    total = poc.get("tick_count", DURATION)
                    cid = poc.get("contract_id", "?")

                    if status in ("expired", "sold"):
                        direction = active_contract["direction"] if active_contract else "?"
                        entry_price = active_contract["entry_price"] if active_contract else entry
                        print_trade_result(status, profit, entry_price, exit_p, direction, cid)
                        active_contract = None
                        last_trade_time = time.time()
                    elif status == "open" and total:
                        direction = active_contract["direction"] if active_contract else "?"
                        barrier = BARRIER_HIGHER if direction == "higher" else BARRIER_LOWER
                        print_trade_progress(cur, total, entry, barrier)

            elif data.get("msg_type") == "balance":
                bal = data.get("balance", {})
                amount = bal.get("balance", "?")
                print_balance(amount)

            elif data.get("msg_type") == "ping":
                await ws.send(json.dumps({"pong": 1}))


if __name__ == "__main__":
    try:
        asyncio.run(trading_loop())
    except KeyboardInterrupt:
        print(f"\n\n  {YLW}Bot stopped by user{RST}")
        if stats["trades"] > 0:
            wr = stats["wins"] / stats["trades"] * 100
            print(f"  {DIM}Session: {stats['trades']} trades | {stats['wins']}W {stats['losses']}L | WR: {wr:.0f}% | PnL: ${stats['total_pnl']:+.2f}{RST}")
        print()
