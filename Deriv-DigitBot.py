"""
Deriv DigitBot v1.0 - MACD + Digit Statistics Strategy
Contracts: DIGITOVER / DIGITUNDER on 1-tick duration
Safety: session halt, loss streak breaker, balance floor, cooldown
"""
import asyncio, json, os, sys, time
from collections import deque, Counter
import argparse, aiohttp, websockets

parser = argparse.ArgumentParser(description="Deriv DigitBot - MACD + Digit Stats")
parser.add_argument("-s", "--symbol", default=os.environ.get("SYMBOL", "R_25"))
parser.add_argument("--stake", type=float, default=float(os.environ.get("STAKE", "0.35")))
parser.add_argument("--min-stake", type=float, default=float(os.environ.get("MIN_STAKE", "0.15")))
parser.add_argument("--account", default=os.environ.get("ACCOUNT_TYPE", "demo"), choices=["demo", "real"])
parser.add_argument("--dry-run", action="store_true")
parser.add_argument("--prediction", type=int, default=5)
parser.add_argument("--max-loss-streak", type=int, default=int(os.environ.get("MAX_LOSS_STREAK", "3")))
parser.add_argument("--loss-cooldown", type=int, default=int(os.environ.get("LOSS_COOLDOWN", "30")))
parser.add_argument("--min-balance", type=float, default=float(os.environ.get("MIN_BALANCE", "5.0")))
parser.add_argument("--max-session-loss", type=float, default=float(os.environ.get("MAX_SESSION_LOSS", "5.0")))
parser.add_argument("--min-skew", type=float, default=float(os.environ.get("MIN_SKEW", "1.5")))
parser.add_argument("--macd-fast", type=int, default=int(os.environ.get("MACD_FAST", "12")))
parser.add_argument("--macd-slow", type=int, default=int(os.environ.get("MACD_SLOW", "26")))
parser.add_argument("--macd-signal", type=int, default=int(os.environ.get("MACD_SIGNAL", "9")))
parser.add_argument("--macd-threshold", type=float, default=float(os.environ.get("MACD_THRESHOLD", "0.001")))
parser.add_argument("--digit-window", type=int, default=int(os.environ.get("DIGIT_WINDOW", "100")))
parser.add_argument("--cooldown-ticks", type=int, default=int(os.environ.get("COOLDOWN_TICKS", "3")))
args = parser.parse_args()

# Config
REST_BASE_URL = "https://api.derivws.com"
BRIDGE_URL = os.environ.get("DTRADER_BRIDGE_URL", "http://localhost:3000")
USE_BRIDGE = os.environ.get("USE_BRIDGE", "1") == "1"
PAT_TOKEN = os.environ.get("PAT_TOKEN", "")
APP_ID = os.environ.get("DERIV_APP_ID", "")
ACCOUNT_TYPE = args.account
SYMBOL = args.symbol
STAKE = args.stake
MIN_STAKE = args.min_stake
PREDICTION = args.prediction
CURRENCY = "USD"
DURATION = 1
DURATION_UNIT = "t"
MACD_FAST = args.macd_fast
MACD_SLOW = args.macd_slow
MACD_SIG = args.macd_signal
MACD_THRESH = args.macd_threshold
DIG_WIN = args.digit_window
MIN_SKEW = args.min_skew
MAX_LOSS_STREAK = args.max_loss_streak
LOSS_CD = args.loss_cooldown
MIN_BAL = args.min_balance
MAX_SESS_LOSS = args.max_session_loss
COOLDOWN_TICKS = args.cooldown_ticks

GRN = "\033[92m"; RED = "\033[91m"; YLW = "\033[93m"; CYN = "\033[96m"
DIM = "\033[2m"; BLD = "\033[1m"; RST = "\033[0m"

# State
closes = deque(maxlen=500)
digits = deque(maxlen=DIG_WIN)
macd_v = deque(maxlen=100)
sig_v = deque(maxlen=100)
hist_v = deque(maxlen=100)
active_contract = None
active_contract_id = None
pending_proposal = None
_pending_buy = None
_tick_count = 0
_balance = 0.0
_session_pnl = 0.0
_halt_until = 0
_consec_losses = 0
_cooldown_until = 0
_last_trade_tick = 0
WS_URL = None
ws_global = None
_trade_log = []
_s_wins = 0
_s_losses = 0
_s_staked = 0.0
_s_payout = 0.0
SESSION_START = time.time()


# ========== INDICATORS ==========

def ema(data, period):
    if len(data) < period:
        return None
    k = 2.0 / (period + 1)
    v = sum(data[:period]) / period
    for p in data[period:]:
        v = p * k + v * (1 - k)
    return v


def calc_macd(prices):
    if len(prices) < MACD_SLOW + MACD_SIG:
        return None, None, None
    fe = ema(list(prices), MACD_FAST)
    se = ema(list(prices), MACD_SLOW)
    if fe is None or se is None:
        return None, None, None
    ml = fe - se
    ms = []
    for i in range(MACD_SLOW, len(prices) + 1):
        f = ema(list(prices)[:i], MACD_FAST)
        s = ema(list(prices)[:i], MACD_SLOW)
        if f is not None and s is not None:
            ms.append(f - s)
    if len(ms) < MACD_SIG:
        return ml, None, None
    sl = ema(ms, MACD_SIG)
    hist = ml - sl if sl is not None else None
    return ml, sl, hist


def calc_rsi(prices, period=14):
    if len(prices) < period + 1:
        return None
    g, lo = [], []
    for i in range(-period, 0):
        d = prices[i] - prices[i - 1]
        g.append(d if d > 0 else 0)
        lo.append(-d if d < 0 else 0)
    ag = sum(g) / period
    al = sum(lo) / period
    if al == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + ag / al))


def digit_skew(dl):
    if len(dl) < 20:
        return 0, -1, -1, {}
    c = Counter(dl)
    freq = sorted(c.items(), key=lambda x: -x[1])
    mc = freq[0][1]
    lc = freq[-1][1]
    sk = mc / max(lc, 1)
    return sk, freq[0][0], freq[-1][0], dict(freq)


# ========== TRADE LOG ==========

def log_trade(d, dig, rsi, mh, sk, reason):
    e = {
        "id": len(_trade_log) + 1, "bot": "digitbot",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "epoch": time.time(),
        "symbol": SYMBOL, "direction": d, "stake": STAKE, "prediction": PREDICTION,
        "digit_at_entry": dig,
        "signal": {"rsi": round(rsi, 2) if rsi else None,
                   "macd_hist": round(mh, 6) if mh else None,
                   "skew": round(sk, 2), "reason": reason},
        "result": {"status": "pending"}
    }
    _trade_log.append(e)
    save_log()
    return e


def log_result(e, st, prof, pay, ex_d, bal):
    e["result"] = {
        "status": st, "contract_id": active_contract_id,
        "exit_digit": ex_d, "profit": prof, "payout": pay,
        "balance": bal, "settled_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    global _session_pnl, _s_wins, _s_losses, _s_staked, _s_payout
    _session_pnl += prof; _s_staked += STAKE; _s_payout += pay
    if st == "won":
        _s_wins += 1
    elif st == "lost":
        _s_losses += 1
    save_log()


def save_log():
    fn = f"trade_log_digitbot_{SYMBOL}.json"
    with open(fn, "w") as f:
        json.dump({"trades": _trade_log, "balance": _balance}, f, indent=2, default=str)


def mark_failed(r):
    for t in reversed(_trade_log):
        if t["result"]["status"] == "pending":
            t["result"] = {"status": "failed", "fail_reason": r}
            save_log()
            break


def reset_ac():
    global active_contract, active_contract_id, pending_proposal
    active_contract = None
    active_contract_id = None
    pending_proposal = None


# ========== DISPLAY ==========

def print_header():
    mode = "DRY RUN" if args.dry_run else "LIVE"
    print(f"\n{CYN}+========================================================+{RST}")
    print(f"{CYN}|{RST}  {BLD}Deriv DigitBot v1.0{RST}                                  {CYN}|{RST}")
    print(f"{CYN}|{RST}  MACD({MACD_FAST},{MACD_SLOW},{MACD_SIG}) + Digit Statistics             {CYN}|{RST}")
    print(f"{CYN}+========================================================+{RST}")
    print(f"{CYN}|{RST}  Symbol: {BLD}{SYMBOL}{RST}  Dur: {BLD}{DURATION}t{RST}  Pred: {BLD}{PREDICTION}{RST}"
          f"  Mode: {BLD}{mode}{RST}  {CYN}|{RST}")
    print(f"{CYN}|{RST}  Stake: ${BLD}{STAKE}{RST}  MinSkew: {BLD}{MIN_SKEW}{RST}"
          f"  MACD-t: {BLD}{MACD_THRESH}{RST}          {CYN}|{RST}")
    print(f"{CYN}+========================================================+{RST}\n")


def print_tick(price, tn):
    dig = int(str(price).split(".")[-1][-1]) if "." in str(price) else 0
    a = "^" if len(closes) >= 2 and closes[-1] > closes[-2] else "v" if len(closes) >= 2 else " "
    m = macd_v[-1] if macd_v else 0
    s = sig_v[-1] if sig_v else 0
    h = hist_v[-1] if hist_v else 0
    rsi = calc_rsi(list(closes), 14)
    sk, mo, le, _ = digit_skew(list(digits))
    rsi_s = f"{rsi:.1f}" if rsi else "---"
    print(f"  #{tn:>4d} {a} {BLD}{price:.5f}{RST} [{dig}]"
          f"  MACD:{m:+.6f}  Sig:{s:+.6f}  H:{h:+.6f}  RSI:{rsi_s}"
          f"  Skew:{sk:.1f} H/M/L:{mo}/{le}")


def print_macd_bar():
    if not hist_v:
        return
    h = hist_v[-1]
    w = 40; mid = w // 2
    pos = max(0, min(w - 1, mid + int(h * mid * 500)))
    bar = list("." * w); bar[mid] = "|"
    if h > 0:
        for i in range(mid + 1, pos + 1):
            bar[i] = "#"
    elif h < 0:
        for i in range(pos, mid):
            bar[i] = "-"
    print(f"  {DIM}MACD: [{''.join(bar)}] {h:+.6f}{RST}")


def print_digit_dist():
    if len(digits) < 10:
        return
    sk, mo, le, dist = digit_skew(list(digits))
    mx = max(dist.values()) if dist else 1
    print(f"\n  {CYN}--- Digit Dist ({len(digits)}t) | Skew: {sk:.2f} (min: {MIN_SKEW}) ---{RST}")
    for d in range(10):
        cnt = dist.get(d, 0)
        bar = "#" * int((cnt / mx) * 20) if mx > 0 else ""
        tag = " <-- MOST" if d == mo else (" <-- LEAST" if d == le else "")
        print(f"    {d}: {bar:20s} {cnt:3d}{tag}")


def print_result(st, prof, pay, ex):
    if st == "won":
        print(f"\n  {GRN}+--- WON +${prof:.2f} | Payout ${pay:.2f} | Digit: {ex} ---+{RST}")
    else:
        print(f"\n  {RED}+--- LOST ${prof:.2f} | Digit: {ex} ---+{RST}")


# ========== TRADE EXECUTION ==========

def eff_stake():
    b = _balance
    if b >= 50:
        return round(STAKE, 2)
    elif b >= 20:
        return round(STAKE * 0.80, 2)
    elif b >= 10:
        return round(STAKE * 0.60, 2)
    elif b >= 5:
        return round(STAKE * 0.50, 2)
    else:
        return max(MIN_STAKE, round(STAKE * 0.40, 2))


async def place_trade(d):
    global pending_proposal, _pending_buy
    ct = "DIGITOVER" if d == "over" else "DIGITUNDER"
    amt = eff_stake()
    pending_proposal = {"direction": d}
    _pending_buy = {"direction": d, "signal_ts": time.time()}
    print(f"  {DIM}[PROPOSAL] {ct} pred={PREDICTION} amt={amt}{RST}")
    await ws_global.send(json.dumps({
        "proposal": 1, "amount": amt, "basis": "stake",
        "contract_type": ct, "currency": CURRENCY,
        "duration": DURATION, "duration_unit": DURATION_UNIT,
        "symbol": SYMBOL, "barrier": str(PREDICTION)
    }))


# ========== WEBSOCKET ==========

async def get_ws_url_bridge():
    async with aiohttp.ClientSession() as s:
        async with s.get(f"{BRIDGE_URL}/api/auth/pat") as r:
            return (await r.json()).get("wss_url")


async def get_accounts():
    url = f"{REST_BASE_URL}/trading/v1/options/accounts"
    headers = {"Authorization": f"Bearer {PAT_TOKEN}", "Deriv-App-ID": APP_ID, "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as s:
        async with s.get(url, headers=headers) as r:
            return await r.json()


def select_account(data):
    d = data.get("data") if isinstance(data, dict) else None
    if isinstance(d, list):
        accounts = d
    elif isinstance(d, dict) and "accounts" in d:
        accounts = d["accounts"]
    elif isinstance(data, list):
        accounts = data
    else:
        accounts = []
    if not accounts:
        return None
    for acc in accounts:
        acc_id = acc.get("account_id") or acc.get("accountId") or acc.get("id") or acc.get("loginid")
        is_virtual = acc.get("is_virtual") or acc.get("isVirtual") or (acc.get("account_type") == "demo")
        acc_type = acc.get("account_type") or acc.get("accountType") or ("demo" if is_virtual else "real")
        is_demo = is_virtual or acc_type == "demo" or str(acc_id).startswith("VR") or str(acc_id).startswith("DOT")
        if ACCOUNT_TYPE == "demo" and is_demo:
            return acc_id
        if ACCOUNT_TYPE == "real" and not is_demo:
            return acc_id
    if accounts:
        return accounts[0].get("account_id") or accounts[0].get("accountId") or accounts[0].get("loginid")
    return None


async def get_otp_url(acc_id):
    url = f"{REST_BASE_URL}/trading/v1/options/accounts/{acc_id}/otp"
    headers = {"Authorization": f"Bearer {PAT_TOKEN}", "Deriv-App-ID": APP_ID, "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as s:
        async with s.post(url, headers=headers, json={}) as r:
            data = await r.json()
            if r.status != 200:
                raise Exception(f"OTP failed: {data}")
            if "data" in data and isinstance(data["data"], dict):
                return data["data"].get("url") or data["data"].get("otpUrl") or ""
            return data.get("url", "")


async def get_ws_url():
    global WS_URL
    if USE_BRIDGE:
        try:
            WS_URL = await get_ws_url_bridge()
            return WS_URL
        except Exception as e:
            print(f"  {RED}X Bridge: {e}{RST}")
            if not PAT_TOKEN:
                print(f"  {RED}No PAT. Exiting.{RST}")
                return None
            print(f"  {YLW}> PAT fallback...{RST}")
    try:
        ad = await get_accounts()
        ai = select_account(ad)
        if not ai:
            print(f"  {RED}X No {ACCOUNT_TYPE} account{RST}")
            return None
        print(f"  {GRN}+{RST} Account: {BLD}{ai}{RST} ({ACCOUNT_TYPE})")
        WS_URL = await get_otp_url(ai)
        return WS_URL
    except Exception as e:
        print(f"  {RED}X Auth: {e}{RST}")
        return None


async def subscribe_ws(ws):
    if ("binaryws.com" in WS_URL or "otp" not in WS_URL) and PAT_TOKEN:
        await ws.send(json.dumps({"authorize": PAT_TOKEN}))
        auth = json.loads(await ws.recv())
        if "error" in auth:
            print(f"  {RED}X Auth failed{RST}")
            return False
        print(f"  {GRN}+{RST} Authenticated")
    await ws.send(json.dumps({"ticks": SYMBOL, "subscribe": 1}))
    await ws.send(json.dumps({"balance": 1, "subscribe": 1}))
    print(f"  {GRN}+{RST} Subscribed to {SYMBOL}")
    if active_contract_id:
        await ws.send(json.dumps({
            "proposal_open_contract": 1,
            "contract_id": active_contract_id, "subscribe": 1
        }))
    print(f"  {DIM}{'-' * 60}{RST}")
    print(f"  {DIM}Watching MACD crossovers + digit skew on {SYMBOL}...{RST}")
    print(f"  {DIM}{'-' * 60}{RST}")
    return True


# ========== TICK PROCESSING ==========

async def process_tick(ws, td):
    global _tick_count, _last_trade_tick, _consec_losses, _cooldown_until
    global _halt_until, _pending_buy, _session_pnl

    _tick_count += 1
    price = td["quote"]
    closes.append(price)
    dig = int(str(price).split(".")[-1][-1]) if "." in str(price) else 0
    digits.append(dig)

    ml, sl, h = calc_macd(list(closes))
    if ml is not None:
        macd_v.append(ml)
    if sl is not None:
        sig_v.append(sl)
    if h is not None:
        hist_v.append(h)

    print_tick(price, _tick_count)
    if _tick_count % 20 == 0:
        print_digit_dist()
    if _tick_count % 5 == 0:
        print_macd_bar()

    # === SAFETY ===
    if MAX_SESS_LOSS > 0 and _session_pnl < -MAX_SESS_LOSS:
        if _halt_until == 0:
            _halt_until = time.time() + 300
            print(f"\n  {RED}! HALT: Lost ${abs(_session_pnl):.2f}. Pausing 5 min.{RST}")
        if time.time() < _halt_until:
            return
        _halt_until = 0
        _session_pnl = 0

    if _consec_losses >= MAX_LOSS_STREAK:
        if _cooldown_until == 0:
            _cooldown_until = time.time() + LOSS_CD
            print(f"\n  {YLW}! STREAK ({_consec_losses}L): Cool {LOSS_CD}s{RST}")
        if time.time() < _cooldown_until:
            return
        _consec_losses = 0
        _cooldown_until = 0

    if _balance > 0 and _balance < MIN_BAL:
        return
    if _tick_count - _last_trade_tick < COOLDOWN_TICKS:
        return
    if active_contract or pending_proposal:
        return
    if _pending_buy and time.time() - _pending_buy.get("signal_ts", 0) > 30:
        _pending_buy = None

    # === SIGNAL ===
    if len(closes) < MACD_SLOW + MACD_SIG + 5:
        return
    if len(digits) < 30:
        return
    if h is None or ml is None:
        return

    sk, mo, le, dist = digit_skew(list(digits))
    if sk < MIN_SKEW:
        return

    rsi = calc_rsi(list(closes), 14)
    ph = hist_v[-2] if len(hist_v) >= 2 else 0

    # Crossover detection
    cross_up = ph is not None and ph <= 0 and h > 0
    cross_down = ph is not None and ph >= 0 and h < 0
    bull = h > MACD_THRESH
    bear = h < -MACD_THRESH

    d = None
    reason = ""

    if cross_up or (bull and rsi is not None and rsi < 40):
        d = "over"
        reason = f"MACD UP hist={h:+.6f} skew={sk:.1f}"
    elif cross_down or (bear and rsi is not None and rsi > 60):
        d = "under"
        reason = f"MACD DOWN hist={h:+.6f} skew={sk:.1f}"

    if d is None:
        return

    # RSI guard
    if d == "over" and rsi is not None and rsi > 65:
        return
    if d == "under" and rsi is not None and rsi < 35:
        return

    print(f"\n  {GRN}{'=' * 60}{RST}")
    print(f"  {GRN}SIGNAL: {d.upper()} | {reason}{RST}")
    print(f"  {GRN}Digit: {dig} | RSI: {rsi:.1f} | MACD: {ml:+.6f}{RST}")
    print(f"  {GRN}{'=' * 60}{RST}")

    entry = log_trade(d, dig, rsi, h, sk, reason)

    if args.dry_run:
        print(f"  {DIM}[DRY RUN] Would place {d.upper()} pred={PREDICTION}{RST}")
        return

    await place_trade(d)
    _last_trade_tick = _tick_count


# ========== MESSAGE HANDLER ==========

async def handle_msg(ws, data, lt):
    global active_contract, active_contract_id, pending_proposal, _pending_buy
    global _balance, _consec_losses, _session_pnl

    mt = data.get("msg_type", "?")

    if mt == "error":
        print(f"\n  {RED}X ERR: {data.get('error', {})}{RST}")

    elif mt == "tick":
        t = data.get("tick", {})
        if t:
            return await process_tick(ws, t)

    elif mt == "balance":
        _balance = data.get("balance", {}).get("balance", _balance)

    elif mt == "proposal":
        p = data.get("proposal", {})
        if "error" in data:
            mark_failed("proposal_err")
            _pending_buy = None
            reset_ac()
        elif p and pending_proposal:
            pid = p.get("id")
            if pid:
                print(f"  {DIM}[PROP] id={pid} payout={p.get('payout', '?')}{RST}")
                await ws.send(json.dumps({"buy": pid, "price": p.get("ask_price", 0)}))

    elif mt == "buy":
        bd = data.get("buy", {})
        if "error" in data:
            mark_failed("buy_err")
            _pending_buy = None
            reset_ac()
        elif bd and bd.get("contract_id"):
            cid = bd["contract_id"]
            d = (pending_proposal["direction"] if pending_proposal
                 else (_pending_buy["direction"] if _pending_buy else "?"))
            active_contract_id = cid
            active_contract = {"direction": d, "contract_id": cid}
            print(f"\n  {GRN}+ CONTRACT {cid} bought{RST}")
            _pending_buy = None
            await ws.send(json.dumps({
                "proposal_open_contract": 1, "contract_id": cid, "subscribe": 1
            }))

    elif mt == "proposal_open_contract":
        poc = data.get("proposal_open_contract", {})
        if poc and poc.get("is_sold"):
            prof = poc.get("profit", 0)
            pay = poc.get("payout", 0)
            es = poc.get("exit_spot", 0)
            ex_d = int(str(es).split(".")[-1][-1]) if "." in str(es) else 0
            st = "won" if prof > 0 else "lost"
            for t in reversed(_trade_log):
                if t["result"]["status"] == "pending":
                    log_result(t, st, prof, pay, ex_d, _balance)
                    break
            print_result(st, prof, pay, ex_d)
            _consec_losses = 0 if st == "won" else _consec_losses + 1
            reset_ac()

    return None


# ========== MAIN LOOP ==========

async def keepalive(ws):
    while True:
        try:
            await asyncio.sleep(30)
            await ws.send(json.dumps({"ping": 1}))
        except Exception:
            break


async def trading_loop():
    global ws_global, _tick_count, _last_trade_tick
    while True:
        try:
            url = await get_ws_url()
            if not url:
                print(f"  {RED}X No URL. Retry 5s...{RST}")
                await asyncio.sleep(5)
                continue
            async with websockets.connect(url, ping_interval=30, ping_timeout=10) as ws:
                ws_global = ws
                if not await subscribe_ws(ws):
                    continue
                _tick_count = 0
                _last_trade_tick = 0
                lt = 0
                ka = asyncio.create_task(keepalive(ws))
                try:
                    async for msg in ws:
                        try:
                            d = json.loads(msg)
                        except Exception:
                            continue
                        r = await handle_msg(ws, d, lt)
                        if isinstance(r, (int, float)):
                            lt = time.time()
                finally:
                    ka.cancel()
        except asyncio.CancelledError:
            break
        except (websockets.ConnectionClosed, ConnectionError, OSError) as e:
            print(f"\n  {YLW}> Conn err: {e}. Reconnect 3s...{RST}")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"\n  {RED}X {e}{RST}")
            import traceback
            traceback.print_exc()
            await asyncio.sleep(3)


def print_summary():
    t = _s_wins + _s_losses
    wr = (_s_wins / t * 100) if t > 0 else 0
    print(f"\n{CYN}+{'=' * 50}+{RST}")
    print(f"{CYN}|{RST}  {BLD}SESSION SUMMARY{RST}")
    print(f"{CYN}|{RST}  Trades: {t} | W: {_s_wins} | L: {_s_losses} | WR: {wr:.1f}%{RST}")
    print(f"{CYN}|{RST}  PnL: ${_session_pnl:.2f} | Staked: ${_s_staked:.2f} | Payout: ${_s_payout:.2f}{RST}")
    print(f"{CYN}+{'=' * 50}+{RST}")


async def main():
    print_header()
    save_log()
    try:
        await trading_loop()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print(f"\n  {YLW}> Stopped{RST}")
        print_summary()
        save_log()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, asyncio.CancelledError):
        print(f"\n  {YLW}> Stopped{RST}")
        print_summary()
        save_log()
