"""
Deriv DigitBot v1.3 - Dynamic Prediction + Martingale + Take Profit
Contracts: DIGITOVER / DIGITUNDER on 1-tick duration
Safety: max 2 loss halt, session halt, balance floor, cooldown
Features: dynamic prediction, martingale tiers, take-profit, prediction sweep
"""
import asyncio, json, os, sys, time, math
from collections import deque, Counter
import argparse

from DerivClient import DerivClient, configure

parser = argparse.ArgumentParser(description="Deriv DigitBot - MACD + Digit Stats")
parser.add_argument("-s", "--symbol", default=os.environ.get("SYMBOL", "R_25"))
parser.add_argument("--symbols", default=os.environ.get("SYMBOLS", ""),
                    help="Comma-separated multi-symbol (e.g. R_10,R_25,R_50). Overrides -s.")
parser.add_argument("--stake", type=float, default=float(os.environ.get("STAKE", "0.35")))
parser.add_argument("--min-stake", type=float, default=float(os.environ.get("MIN_STAKE", "0.35")),
                    help="Bot-level minimum stake (never below Deriv's 0.35 hard floor)")
parser.add_argument("--account", default=os.environ.get("ACCOUNT_TYPE", "demo"), choices=["demo", "real"])
parser.add_argument("--dry-run", action="store_true")
parser.add_argument("--collect", action="store_true",
                    help="Data-collection mode: log every signal + outcome to JSONL, place no trades")
parser.add_argument("--prediction", type=int, default=5)
parser.add_argument("--max-loss-streak", type=int, default=int(os.environ.get("MAX_LOSS_STREAK", "2")))
parser.add_argument("--loss-cooldown", type=int, default=int(os.environ.get("LOSS_COOLDOWN", "30")))
parser.add_argument("--min-balance", type=float, default=float(os.environ.get("MIN_BALANCE", "5.0")))
parser.add_argument("--max-session-loss", type=float, default=float(os.environ.get("MAX_SESSION_LOSS", "5.0")))
parser.add_argument("--min-skew", type=float, default=float(os.environ.get("MIN_SKEW", "1.5")))
parser.add_argument("--max-skew", type=float, default=float(os.environ.get("MAX_SKEW", "2.0")))
parser.add_argument("--macd-fast", type=int, default=int(os.environ.get("MACD_FAST", "12")))
parser.add_argument("--macd-slow", type=int, default=int(os.environ.get("MACD_SLOW", "26")))
parser.add_argument("--macd-signal", type=int, default=int(os.environ.get("MACD_SIGNAL", "9")))
parser.add_argument("--macd-threshold", type=float, default=float(os.environ.get("MACD_THRESHOLD", "0.001")))
parser.add_argument("--digit-window", type=int, default=int(os.environ.get("DIGIT_WINDOW", "100")))
parser.add_argument("--cooldown-ticks", type=int, default=int(os.environ.get("COOLDOWN_TICKS", "30")))
parser.add_argument("--min-hist", type=float, default=float(os.environ.get("MIN_HIST", "0.02")))
parser.add_argument("--min-confidence", type=float, default=float(os.environ.get("MIN_CONFIDENCE", "35")))
# --- NEW: opt-in features ---
parser.add_argument("--prediction-sweep", action="store_true",
                    help="Log expected value for pred=3/5/7 at each signal (no extra trades)")
parser.add_argument("--correlation-analysis", action="store_true",
                    help="Track cross-symbol signal timing correlation (requires --symbols)")
# --- v1.3: dynamic prediction + martingale ---
parser.add_argument("--martingale", action="store_true",
                    help="Enable dynamic prediction + martingale tier system")
parser.add_argument("--take-profit", type=float, default=float(os.environ.get("TAKE_PROFIT", "2.00")),
                    help="Session profit target - stop trading when reached")
parser.add_argument("--max-consecutive-losses", type=int, default=int(os.environ.get("MAX_CONSEC_LOSSES", "2")),
                    help="Max consecutive losses before halt (martingale circuit breaker)")
parser.add_argument("--base-stake", type=float, default=float(os.environ.get("BASE_STAKE", "0.35")),
                    help="Base stake for martingale Tier 0")
parser.add_argument("--smart-barrier", action="store_true",
                    help="Pick over/under barrier from the observed digit distribution instead of a fixed 5")
parser.add_argument("--smart-min-edge", type=float, default=float(os.environ.get("SMART_MIN_EDGE", "0.05")),
                    help="Smart barrier: min edge (win prob minus uniform baseline) required to trade")
parser.add_argument("--smart-min-samples", type=int, default=int(os.environ.get("SMART_MIN_SAMPLES", "50")),
                    help="Smart barrier: min digits in the window before smart-barrier trades are allowed")
args = parser.parse_args()

# Config
DERIV_MIN_STAKE = 0.35  # Deriv minimum stake per contract - proposals below this are rejected
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
MAX_SKEW = args.max_skew
MAX_LOSS_STREAK = args.max_loss_streak
LOSS_CD = args.loss_cooldown
MIN_BAL = args.min_balance
MAX_SESS_LOSS = args.max_session_loss
COOLDOWN_TICKS = args.cooldown_ticks
MIN_HIST = args.min_hist
MIN_CONFIDENCE = args.min_confidence
PRED_SWEEP = args.prediction_sweep
CORR_ANALYSIS = args.correlation_analysis
COLLECT_MODE = args.collect
MARTINGALE = args.martingale
SMART_BARRIER = args.smart_barrier
SMART_MIN_EDGE = args.smart_min_edge
SMART_MIN_SAMPLES = args.smart_min_samples
TAKE_PROFIT = args.take_profit
MAX_CONSEC_LOSSES = args.max_consecutive_losses
BASE_STAKE = args.base_stake

# Resolve symbol list
if args.symbols:
    SYMBOL_LIST = [s.strip() for s in args.symbols.split(",") if s.strip()]
else:
    SYMBOL_LIST = [args.symbol]

GRN = "\033[92m"; RED = "\033[91m"; YLW = "\033[93m"; CYN = "\033[96m"
MAG = "\033[95m"; DIM = "\033[2m"; BLD = "\033[1m"; RST = "\033[0m"


# ========== SYMBOL STATE ==========

class SymbolState:
    """Per-symbol trading state. Each symbol gets its own instance."""
    def __init__(self, symbol):
        self.symbol = symbol
        self.closes = deque(maxlen=500)
        self.digits = deque(maxlen=DIG_WIN)
        self.macd_v = deque(maxlen=100)
        self.sig_v = deque(maxlen=100)
        self.hist_v = deque(maxlen=100)
        self.active_contract = None
        self.active_contract_id = None
        self.pending_proposal = None
        self._pending_buy = None
        self._tick_count = 0
        self._session_pnl = 0.0
        self._halt_until = 0
        self._consec_losses = 0
        self._cooldown_until = 0
        self._last_trade_tick = 0
        self._trade_log = []
        self._s_wins = 0
        self._s_losses = 0
        self._s_staked = 0.0
        self._s_payout = 0.0
        self.session_start = time.time()
        self._signal_times = []  # for correlation analysis
        # v1.3: martingale state
        self._martingale_tier = 0
        self._take_profit_hit = False
        self._current_prediction = 5
        self._current_stake = BASE_STAKE
        # data-collection mode (--collect)
        self.digits_true = deque(maxlen=DIG_WIN)
        self._collect_pending = None

    def reset_ac(self):
        self.active_contract = None
        self.active_contract_id = None
        self.pending_proposal = None

    def has_active(self):
        return self.active_contract is not None or self.pending_proposal is not None

    def eff_stake(self, balance, confidence=75):
        if MARTINGALE:
            amt = martingale_stake(self._consec_losses, self._current_prediction, BASE_STAKE)
            self._current_stake = amt
            return amt
        b = balance
        if b >= 50: bal_mult = 1.0
        elif b >= 20: bal_mult = 0.80
        elif b >= 10: bal_mult = 0.60
        elif b >= 5: bal_mult = 0.50
        else: bal_mult = 0.40
        conf_mult = max(0.35, min(1.0, 0.2 + (confidence / 100) * 0.8))
        amt = round(STAKE * bal_mult * conf_mult, 2)
        # Clamp to Deriv's hard minimum - proposals below 0.35 are rejected
        return max(MIN_STAKE, DERIV_MIN_STAKE, amt)


# Shared state
_balance = 0.0
ws_global = None  # current session socket, set by handle_msg for place_trade
SESSION_START = time.time()
symbol_states = {}  # symbol -> SymbolState
_correlation_signals = {}  # symbol -> list of (timestamp, direction, score)
_collect_records = []  # data-collection mode: resolved signal records (session summary)

# Pip-size decimals per symbol - the true last digit is the last digit of the
# quote at the symbol's pip precision (float repr loses trailing zeros).
PIP_DECIMALS = {
    "R_10": 3, "R_25": 3, "R_50": 4, "R_75": 4, "R_100": 2,
    "1HZ10V": 2, "1HZ25V": 2, "1HZ50V": 2, "1HZ75V": 2, "1HZ100V": 2,
}


class RawFloat(float):
    """Float that remembers the exact JSON wire string it was parsed from.

    Used as json.loads(parse_float=...) so digit extraction can read the
    quote exactly as Deriv sent it instead of Python's shortest float repr,
    which drops trailing zeros (2732.02000 -> '2732.02' -> wrong digit).
    Behaves as a plain float everywhere else (math, comparison, format)."""
    __slots__ = ("raw",)

    def __new__(cls, s):
        x = super().__new__(cls, s)
        x.raw = s
        return x


# Shared transport: auth/authorize/proposal/buy/POC/keepalive/reconnect
# plumbing. account_type wins over the ACCOUNT_TYPE env var so an explicit
# --account choice is honoured. parse_float=RawFloat preserves each quote's
# exact wire string so digit extraction is pip-accurate.
configure(account_type=args.account)
client = DerivClient(symbols=SYMBOL_LIST, probe_contracts=False, parse_float=RawFloat)


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


def calc_confidence(h, sk, p_tm, p_other, rsi, d):
    """Compute 0-100 confidence score from signal components."""
    hist_score = min(30, (abs(h) / 0.10) * 30)
    skew_score = min(25, ((sk - 1.0) / 4.0) * 25)
    tm_margin = max(0, p_tm - 0.50)
    tm_score = min(25, (tm_margin / 0.15) * 25)
    if rsi is None:
        rsi_score = 10
    elif d == "over" and rsi < 40:
        rsi_score = min(20, ((40 - rsi) / 20) * 20)
    elif d == "under" and rsi > 60:
        rsi_score = min(20, ((rsi - 60) / 20) * 20)
    else:
        rsi_score = 5
    return round(hist_score + skew_score + tm_score + rsi_score, 1)


# ========== v1.3: DYNAMIC PREDICTION + MARTINGALE ==========

PAYOUT_TABLE = {
    3:  (0.30, 3.17, 2.17),
    4:  (0.40, 2.33, 1.33),
    5:  (0.50, 1.86, 0.86),
    6:  (0.60, 1.55, 0.55),
    7:  (0.70, 1.33, 0.33),
    8:  (0.80, 1.17, 0.17),
    9:  (0.90, 1.06, 0.06),
}


def pick_prediction(dist, direction, rsi):
    """Dynamically pick best prediction based on digit distribution.
    Prefers 30-60% win rate predictions for optimal martingale recovery."""
    total = sum(dist.values()) if dist else 0
    if total < 10:
        return 5
    freq = {d: dist.get(d, 0) / total for d in range(10)}
    best_pred = 5
    best_score = -999
    for pred in range(3, 9):
        if direction == "under":
            win_digits = set(range(pred))
        else:
            win_digits = set(range(pred + 1, 10))
        win_freq = sum(freq[d] for d in win_digits)
        # Base win probability is direction-dependent: UNDER pred=p wins on
        # p of 10 digits, OVER pred=p wins on 10-p. The old code used the
        # UNDER value for both, mis-ranking every OVER trade.
        base_win = pred / 10.0 if direction == "under" else (10 - pred) / 10.0
        edge = win_freq - base_win
        payout = PAYOUT_TABLE[pred][1] if direction == "under" else round(0.96 / max(base_win, 0.01), 2)
        payout_bonus = (payout - 1.0) * 0.3
        rsi_bonus = 0
        if rsi is not None:
            if direction == "under" and rsi > 60:
                rsi_bonus = 0.1
            elif direction == "over" and rsi < 40:
                rsi_bonus = 0.1
        score = edge + payout_bonus + rsi_bonus
        if base_win > 0.65:
            score -= 0.15
        if base_win < 0.25:
            score -= 0.10
        if score > best_score:
            best_score = score
            best_pred = pred
    return best_pred


def martingale_stake(consec_losses, prediction, base_stake=0.35):
    """Compute stake for current martingale tier.
    Tier 0: base_stake. Tier 1: recovery. After 2L: HALT (caller handles)."""
    if prediction not in PAYOUT_TABLE:
        prediction = 5
    _, payout, profit_per_dollar = PAYOUT_TABLE[prediction]
    if consec_losses == 0:
        return max(DERIV_MIN_STAKE, base_stake)
    elif consec_losses == 1:
        tier1 = base_stake / profit_per_dollar
        tier1 = round(tier1 + 0.05, 2)
        tier1 = min(tier1, base_stake * 4)
        return max(DERIV_MIN_STAKE, tier1)
    else:
        return max(DERIV_MIN_STAKE, base_stake)


def pick_barrier(dist, direction):
    """Smart barrier: pick the over/under barrier whose winning-digit mass
    most exceeds the uniform baseline in the observed window.

    Frequencies are Laplace-shrunk toward uniform (pseudo-count of 10) so a
    lucky streak in a short window cannot fake an edge. Returns
    (pred, edge) for the best barrier, or None if no barrier clears
    SMART_MIN_EDGE or the sample is too small. Barriers are limited to
    3-7 so the base win probability stays in the 30-70% band.
    """
    total = sum(dist.values()) if dist else 0
    if total < SMART_MIN_SAMPLES:
        return None
    best = None
    for pred in range(3, 8):
        if direction == "under":
            base = pred / 10.0
            wins = sum(dist.get(i, 0) for i in range(pred))
        else:
            base = (10 - pred) / 10.0
            wins = sum(dist.get(i, 0) for i in range(pred + 1, 10))
        p = (wins + 10 * base) / (total + 10)
        edge = p - base
        if best is None or edge > best[1]:
            best = (pred, edge)
    if best and best[1] >= SMART_MIN_EDGE:
        return best
    return None


def get_payout_for_pred(prediction):
    """Return (base_win_pct, payout_ratio, profit_per_dollar) for a prediction."""
    return PAYOUT_TABLE.get(prediction, (0.50, 1.86, 0.86))


def digit_skew(dl):
    if len(dl) < 20:
        return 0, -1, -1, {}
    c = Counter(dl)
    freq = sorted(c.items(), key=lambda x: -x[1])
    mc = freq[0][1]
    lc = freq[-1][1]
    sk = mc / max(lc, 1)
    return sk, freq[0][0], freq[-1][0], dict(freq)


def transition_matrix(dl, window=200):
    if len(dl) < 10:
        return None, dl[-1] if dl else 0, 0.5, 0.5
    recent = list(dl)[-window:]
    mat = [[0]*10 for _ in range(10)]
    for i in range(len(recent)-1):
        mat[recent[i]][recent[i+1]] += 1
    cur = recent[-1]
    alpha = 1.0
    row = mat[cur]
    total = sum(row) + 10 * alpha
    p_over = (sum(row[6:10]) + 4 * alpha) / total
    p_under = (sum(row[0:5]) + 5 * alpha) / total
    return mat, cur, p_over, p_under


# ========== PREDICTION SWEEP ==========

def prediction_sweep(st, dist, h, sk, rsi, d):
    """Log expected value for pred=3,5,7 given current digit distribution.
    payout_ratio varies by prediction:
      pred=3: UNDER wins on 0,1,2 (3/10 base) → payout ~3.0x (actual ~2.9x)
      pred=5: UNDER wins on 0,1,2,3,4 (5/10) → payout ~1.8x (actual ~1.86x)
      pred=7: UNDER wins on 0..6 (7/10) → payout ~1.35x (actual ~1.33x)
    For OVER: mirror (pred=3 → wins on 4-9 = 7/10 → ~1.35x, etc.)
    """
    total = sum(dist.values()) if dist else 0
    if total < 10:
        return

    sweep = []
    for pred in [3, 5, 7]:
        if d == "under":
            win_count = sum(dist.get(i, 0) for i in range(pred))
            lose_count = total - win_count
        else:  # over
            win_count = sum(dist.get(i, 0) for i in range(pred, 10))
            lose_count = total - win_count

        win_prob = win_count / total
        lose_prob = lose_count / total

        # Approximate payout from Deriv's digit contract formula
        if d == "under":
            base_win_pct = pred / 10.0
        else:
            base_win_pct = (10 - pred) / 10.0
        # Deriv payout ≈ stake * (1 / win_prob) * margin (~0.96)
        payout_ratio = round(1.0 / max(base_win_pct, 0.01), 2) * 0.96
        ev = round(win_prob * payout_ratio - lose_prob, 4)
        sweep.append((pred, win_prob, payout_ratio, ev))

    label = "UNDER" if d == "under" else "OVER"
    swp_str = " | ".join(
        f"pred={p} WR={wp:.0%} pay={pr:.1f}x EV={e:+.3f}" for p, wp, pr, e in sweep
    )
    print(f"  {MAG}[SWEEP] {label} | {swp_str}{RST}")


# ========== TRADE LOG ==========

def log_trade(st, d, dig, rsi, mh, sk, reason, confidence=0):
    e = {
        "id": len(st._trade_log) + 1, "bot": "digitbot", "symbol": st.symbol,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "epoch": time.time(),
        "direction": d, "stake": st._current_stake if (MARTINGALE or SMART_BARRIER) else STAKE, "prediction": st._current_prediction if (MARTINGALE or SMART_BARRIER) else PREDICTION,
        "digit_at_entry": dig,
        "signal": {"rsi": round(rsi, 2) if rsi else None,
                   "macd_hist": round(mh, 6) if mh else None,
                   "skew": round(sk, 2), "reason": reason,
                   "confidence": round(confidence, 1)},
        "result": {"status": "pending"}
    }
    st._trade_log.append(e)
    save_log(st)
    return e


def log_result(st, entry, res, prof, pay, ex_d, bal):
    entry["result"] = {
        "status": res, "contract_id": st.active_contract_id,
        "exit_digit": ex_d, "profit": prof, "payout": pay,
        "balance": bal, "settled_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    actual_stake = st._current_stake if (MARTINGALE or SMART_BARRIER) else STAKE
    st._session_pnl += prof; st._s_staked += actual_stake; st._s_payout += pay
    if res == "won":
        st._s_wins += 1
    elif res == "lost":
        st._s_losses += 1
    save_log(st)


def save_log(st):
    fn = f"trade_log_digitbot_{st.symbol}.json"
    with open(fn, "w") as f:
        json.dump({"trades": st._trade_log, "balance": _balance}, f, indent=2, default=str)


def mark_failed(st, r):
    for t in reversed(st._trade_log):
        if t["result"]["status"] == "pending":
            t["result"] = {"status": "failed", "fail_reason": r}
            save_log(st)
            break


# ========== DISPLAY ==========

def print_header():
    mode = "COLLECT" if args.collect else ("DRY RUN" if args.dry_run else "LIVE")
    syms = ",".join(SYMBOL_LIST)
    print(f"\n{CYN}+========================================================+{RST}")
    print(f"{CYN}|{RST}  {BLD}Deriv DigitBot v1.3{RST}                                  {CYN}|{RST}")
    strat = ("MACD + SmartBarrier" if SMART_BARRIER
             else f"MACD({MACD_FAST},{MACD_SLOW},{MACD_SIG}) + DynPred + Martingale")
    print(f"{CYN}|{RST}  {strat:<55}{CYN}|{RST}")
    print(f"{CYN}+========================================================+{RST}")
    pred_label = "SMART" if SMART_BARRIER else ("DYNAMIC" if MARTINGALE else str(PREDICTION))
    print(f"{CYN}|{RST}  Symbols: {BLD}{syms}{RST}  Dur: {BLD}{DURATION}t{RST}  Pred: {BLD}{pred_label}{RST}  Mode: {BLD}{mode}{RST}  {CYN}|{RST}")
    if MARTINGALE:
        print(f"{CYN}|{RST}  Stake: ${BLD}{BASE_STAKE}{RST} (martingale)  Skew: {BLD}{MIN_SKEW}-{MAX_SKEW}{RST}  TP: ${BLD}{TAKE_PROFIT}{RST}  MaxL: {BLD}{MAX_CONSEC_LOSSES}{RST}  {CYN}|{RST}")
    else:
        print(f"{CYN}|{RST}  Stake: ${BLD}{STAKE}{RST}  Skew: {BLD}{MIN_SKEW}-{MAX_SKEW}{RST}  MinHist: {BLD}{MIN_HIST}{RST}  MinConf: {BLD}{MIN_CONFIDENCE}{RST}  {CYN}|{RST}")
    flags = []
    if SMART_BARRIER: flags.append(f"SMART(edge>={SMART_MIN_EDGE:.0%},n>={SMART_MIN_SAMPLES})")
    if PRED_SWEEP: flags.append("SWEEP")
    if CORR_ANALYSIS and len(SYMBOL_LIST) > 1: flags.append("CORR")
    if len(SYMBOL_LIST) > 1: flags.append(f"MULTI({len(SYMBOL_LIST)})")
    if flags:
        print(f"{CYN}|{RST}  {YLW}Flags: {', '.join(flags)}{RST}{' ' * (40 - len(','.join(flags)))}{CYN}|{RST}")
    print(f"{CYN}+========================================================+{RST}\n")


def print_tick(st, price, tn):
    dig = true_digit(price, st.symbol)
    a = "^" if len(st.closes) >= 2 and st.closes[-1] > st.closes[-2] else "v" if len(st.closes) >= 2 else " "
    m = st.macd_v[-1] if st.macd_v else 0
    s = st.sig_v[-1] if st.sig_v else 0
    h = st.hist_v[-1] if st.hist_v else 0
    rsi = calc_rsi(list(st.closes), 14)
    sk, mo, le, _ = digit_skew(list(st.digits))
    rsi_s = f"{rsi:.1f}" if rsi else "---"
    sym_tag = f" {BLD}{st.symbol}{RST}" if len(SYMBOL_LIST) > 1 else ""
    print(f"  #{tn:>4d} {a} {BLD}{price:.5f}{RST}{sym_tag} [{dig}]"
          f"  MACD:{m:+.6f}  Sig:{s:+.6f}  H:{h:+.6f}  RSI:{rsi_s}"
          f"  Skew:{sk:.1f} H/M/L:{mo}/{le}")


def print_macd_bar(st):
    if not st.hist_v:
        return
    h = st.hist_v[-1]
    w = 40; mid = w // 2
    pos = max(0, min(w - 1, mid + int(h * mid * 500)))
    bar = list("." * w); bar[mid] = "|"
    if h > 0:
        for i in range(mid + 1, pos + 1): bar[i] = "#"
    elif h < 0:
        for i in range(pos, mid): bar[i] = "-"
    print(f"  {DIM}MACD: [{''.join(bar)}] {h:+.6f}{RST}")


def print_digit_dist(st):
    if len(st.digits) < 10:
        return
    sk, mo, le, dist = digit_skew(list(st.digits))
    mx = max(dist.values()) if dist else 1
    print(f"\n  {CYN}--- {st.symbol} Digit Dist ({len(st.digits)}t) | Skew: {sk:.2f} (min: {MIN_SKEW}) ---{RST}")
    for d in range(10):
        cnt = dist.get(d, 0)
        bar = "#" * int((cnt / mx) * 20) if mx > 0 else ""
        tag = " <-- MOST" if d == mo else (" <-- LEAST" if d == le else "")
        print(f"    {d}: {bar:20s} {cnt:3d}{tag}")


def print_result(st, res, prof, pay, ex):
    sym_tag = f" [{st.symbol}]" if len(SYMBOL_LIST) > 1 else ""
    tier_info = f" T{st._martingale_tier}" if MARTINGALE and st._martingale_tier > 0 else ""
    pred_info = f" pred={st._current_prediction}" if MARTINGALE else ""
    if res == "won":
        print(f"\n  {GRN}+--- WON +${prof:.2f} | Payout ${pay:.2f} | Digit: {ex}{pred_info}{tier_info}{sym_tag} ---+{RST}")
    else:
        print(f"\n  {RED}+--- LOST ${prof:.2f} | Digit: {ex}{pred_info}{tier_info}{sym_tag} ---+{RST}")


def print_session_stats(st):
    t = st._s_wins + st._s_losses
    wr = (st._s_wins / t * 100) if t > 0 else 0
    pnl_c = GRN if st._session_pnl >= 0 else RED
    pnl_s = f"{pnl_c}${st._session_pnl:+.2f}{RST}"
    streak = st._consec_losses
    streak_s = f"{YLW} streak:{streak}L{RST}" if streak > 0 else f"{GRN} streak:{st._s_wins}W{RST}" if st._s_wins > 0 else ""
    elapsed = int(time.time() - st.session_start)
    m, s = divmod(elapsed, 60)
    h, m = divmod(m, 60)
    ts = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    bal_s = f"${_balance:.2f}" if _balance > 0 else "---"
    sym_tag = f" {BLD}{st.symbol}{RST}" if len(SYMBOL_LIST) > 1 else ""
    print(f"  {DIM}--- {st.symbol} Session {ts} | #{t} | W:{st._s_wins} L:{st._s_losses} WR:{wr:.0f}% | PnL: {pnl_s} | Bal: {bal_s}{streak_s} ---{RST}")


def print_transition_info(mat, cur, p_over, p_under, direction):
    if mat is None:
        return
    agree = (direction == "over" and p_over > 0.50) or (direction == "under" and p_under > 0.50)
    tag = f"{GRN}AGREE{RST}" if agree else f"{RED}SKIP{RST}"
    print(f"  {DIM}Trans[{cur}]: Over5={p_over:.1%} Under5={p_under:.1%} | {tag}{RST}")


# ========== DATA COLLECTION MODE (--collect) ==========
#
# No-trade mode that logs every signal candidate and its outcome so real
# win rate per strategy bucket can be measured offline. Each tick where the
# signal pipeline has a direction candidate writes one JSONL record with all
# filter inputs/results; it is resolved on the NEXT tick (1-tick contract
# semantics) using the true last digit of the settlement quote. Both the true
# digit (quote at pip precision) and the live bot's float-repr digit are
# recorded, so the extraction bug's distortion can be quantified too.

def true_digit(price, symbol=None):
    """Last digit of the quote at the symbol's pip precision (correct extraction).

    Prefers the raw wire string when json parsing preserved it (RawFloat) and
    its decimal count exactly matches the pip size; otherwise formats the
    float at pip precision. Never uses str(price): the float repr drops
    trailing zeros and corrupted every digit in v1.2 (digit 0 ~absent)."""
    dec = PIP_DECIMALS.get(symbol, 3)
    raw = getattr(price, "raw", None)
    if isinstance(raw, str) and "." in raw:
        frac = raw.split(".")[-1]
        if len(frac) == dec and frac and frac[-1].isdigit():
            return int(frac[-1])
    return int(f"{float(price):.{dec}f}"[-1])


def bot_digit(price):
    """Replica of the live bot's extraction (float repr) for comparison."""
    s = str(price)
    return int(s.split(".")[-1][-1]) if "." in s else 0


def collect_file(st):
    return f"signal_log_digitbot_{st.symbol}.jsonl"


def collect_resolve(st, exit_true, exit_bot):
    """Resolve the pending signal record against this tick's digits."""
    p = st._collect_pending
    if p is None:
        return
    pred = p["pred"]
    if p["direction"] == "over":
        p["win_true"] = exit_true > pred
        p["win_bot"] = exit_bot > pred
    else:
        p["win_true"] = exit_true < pred
        p["win_bot"] = exit_bot < pred
    p["exit_tick"] = st._tick_count
    p["exit_digit_true"] = exit_true
    p["exit_digit_bot"] = exit_bot
    _collect_records.append(p)
    try:
        with open(collect_file(st), "a") as f:
            f.write(json.dumps(p) + "\n")
    except Exception as e:
        print(f"  {RED}X COLLECT write: {e}{RST}")
    res_c = GRN if p["win_true"] else RED
    print(f"  {DIM}[DATA] #{p['tick']} {p['direction'].upper()} pred={pred} "
          f"exit={exit_true} -> {res_c}{'WIN' if p['win_true'] else 'LOSS'}{RST}"
          f"{DIM} ({p['bucket']}){RST}")
    st._collect_pending = None


def collect_signal(st, h, ml, dig_bot):
    """Evaluate the full signal pipeline for logging only (never trades)."""
    td_true = true_digit(st.closes[-1], st.symbol)
    st.digits_true.append(td_true)

    # A pending record from the previous tick settles on this tick
    collect_resolve(st, td_true, dig_bot)

    # Warmup guards identical to the live path
    if len(st.closes) < MACD_SLOW + MACD_SIG + 5: return
    if len(st.digits) < 30: return
    if h is None or ml is None: return

    rsi = calc_rsi(list(st.closes), 14)
    sk, mo, le, dist = digit_skew(list(st.digits))
    sk_true, _, _, dist_true = digit_skew(list(st.digits_true))
    ph = st.hist_v[-2] if len(st.hist_v) >= 2 else 0

    cross_up = ph is not None and ph <= 0 and h > 0
    cross_down = ph is not None and ph >= 0 and h < 0
    bull = h > MACD_THRESH
    bear = h < -MACD_THRESH
    d = None
    if cross_up or (bull and rsi is not None and rsi < 40):
        d = "over"
    elif cross_down or (bear and rsi is not None and rsi > 60):
        d = "under"

    # Research direction: live direction if any, else histogram sign, so
    # gated buckets (skew/hist) still carry a betable direction
    d_prov = d if d else ("over" if h > 0 else "under")

    mat, cur_dig, p_over, p_under = transition_matrix(list(st.digits))
    tm_agree = mat is None or (
        (d_prov == "over" and p_over > 0.50) or
        (d_prov == "under" and p_under > 0.50)
    )
    tm_prob = p_over if d_prov == "over" else p_under
    tm_other = p_under if d_prov == "over" else p_over
    score = calc_confidence(h, sk, tm_prob, tm_other, rsi, d_prov)
    rsi_pass = not (
        (d_prov == "over" and rsi is not None and rsi > 65) or
        (d_prov == "under" and rsi is not None and rsi < 35)
    )

    pass_skew = MIN_SKEW <= sk < MAX_SKEW
    pass_hist = abs(h) >= MIN_HIST
    pass_score = score >= MIN_CONFIDENCE

    # First gate the live bot would fail at (live evaluation order)
    if not pass_skew: bucket = "skew_gate"
    elif not pass_hist: bucket = "hist_weak"
    elif d is None: bucket = "no_signal_live"
    elif not rsi_pass: bucket = "rsi_extreme"
    elif not tm_agree: bucket = "tm_disagree"
    elif not pass_score: bucket = "score_low"
    else: bucket = "trade"

    st._collect_pending = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "epoch": time.time(),
        "symbol": st.symbol, "tick": st._tick_count,
        "direction": d_prov, "direction_live": d, "pred": PREDICTION,
        "hist": round(h, 6), "skew": round(sk, 2), "skew_true": round(sk_true, 2),
        "rsi": round(rsi, 2) if rsi is not None else None,
        "tm_over": round(p_over, 4), "tm_under": round(p_under, 4),
        "score": score,
        "pass_skew": pass_skew, "pass_hist": pass_hist,
        "pass_rsi": rsi_pass, "pass_tm": bool(tm_agree),
        "pass_score": pass_score,
        "bucket": bucket,
        "entry_digit_true": td_true, "entry_digit_bot": dig_bot,
        "in_cooldown": (st._tick_count - st._last_trade_tick) < COOLDOWN_TICKS,
    }


def print_collect_summary():
    """Per-bucket win-rate summary from records collected this session."""
    resolved = [r for r in _collect_records if "win_true" in r]
    print(f"\n{CYN}+{'=' * 60}+{RST}")
    print(f"{CYN}|{RST}  {BLD}DATA COLLECTION SUMMARY{RST}")
    print(f"{CYN}|{RST}  Signals logged: {len(_collect_records)} | Resolved: {len(resolved)}")
    if not resolved:
        print(f"{CYN}+{'=' * 60}+{RST}")
        return
    wr_true = sum(1 for r in resolved if r["win_true"]) / len(resolved)
    wr_bot = sum(1 for r in resolved if r["win_bot"]) / len(resolved)
    print(f"{CYN}|{RST}  WR (true digits): {wr_true:.1%}   WR (bot float-repr digits): {wr_bot:.1%}")
    print(f"{CYN}+{'=' * 60}+{RST}")

    print(f"\n  {BLD}Win rate by live bucket (true digits){RST}")
    by_bucket = {}
    for r in resolved:
        by_bucket.setdefault(r["bucket"], []).append(r["win_true"])
    for b, wins in sorted(by_bucket.items(), key=lambda kv: -len(kv[1])):
        wr = sum(wins) / len(wins)
        print(f"    {b:15s} n={len(wins):5d}  WR={wr:6.1%}")

    print(f"\n  {BLD}Win rate by prediction (true digits){RST}")
    for pred in range(3, 10):
        n = len(resolved)
        if n == 0: continue
        w = 0
        for r in resolved:
            ok = r["exit_digit_true"] > pred if r["direction"] == "over" else r["exit_digit_true"] < pred
            w += ok
        print(f"    pred={pred}  n={n:5d}  WR={w / n:6.1%}")

    print(f"\n  {BLD}Entry digit distribution (true vs bot float-repr){RST}")
    bt = Counter(r["entry_digit_true"] for r in _collect_records)
    bb = Counter(r["entry_digit_bot"] for r in _collect_records)
    print("    " + " ".join(f"{d}:{bt.get(d, 0)}/{bb.get(d, 0)}" for d in range(10)))
    if dist_true:
        tot_t = sum(dist_true.values())
        print(f"    last-100 true digits: " + " ".join(f"{d}:{dist_true.get(d, 0)}" for d in range(10)) + f" (n={tot_t})")


# ========== TRADE EXECUTION ==========

async def place_trade(st, d, confidence=75):
    ct = "DIGITOVER" if d == "over" else "DIGITUNDER"
    amt = st.eff_stake(_balance, confidence)
    pred = st._current_prediction if (MARTINGALE or SMART_BARRIER) else PREDICTION
    st.pending_proposal = {"direction": d}
    st._pending_buy = {"direction": d, "signal_ts": time.time()}
    tier_s = f" T{st._consec_losses}" if MARTINGALE and st._consec_losses > 0 else ""
    print(f"  {DIM}[PROPOSAL] {ct} pred={pred} amt=${amt:.2f} conf={confidence:.0f}{tier_s} [{st.symbol}]{RST}")
    await client.request_proposal(
        ws_global,
        contract_type=ct,
        amount=amt,
        barrier=str(pred),
        underlying_symbol=st.symbol,
        duration=DURATION,
        duration_unit=DURATION_UNIT,
    )


# ========== WEBSOCKET ==========
# Auth (bridge -> PAT/OTP fallback), authorize, tick/balance subscriptions,
# POC resume, keepalive pings and the reconnect loop all live in DerivClient.


# ========== TICK PROCESSING ==========

async def process_tick(st, td):
    global _balance

    st._tick_count += 1
    price = td["quote"]
    st.closes.append(price)
    # v1.3.1: pip-precision extraction (wire string when available) - the old
    # float-repr extraction corrupted ~10% of digits and erased digit 0
    dig = true_digit(price, st.symbol)
    st.digits.append(dig)

    ml, sl, h = calc_macd(list(st.closes))
    if ml is not None: st.macd_v.append(ml)
    if sl is not None: st.sig_v.append(sl)
    if h is not None: st.hist_v.append(h)

    print_tick(st, price, st._tick_count)
    if st._tick_count % 20 == 0: print_digit_dist(st)
    if st._tick_count % 5 == 0: print_macd_bar(st)

    # === DATA COLLECTION MODE: log every signal, never trade ===
    if COLLECT_MODE:
        collect_signal(st, h, ml, bot_digit(price))
        return

    # === SAFETY ===
    if MAX_SESS_LOSS > 0 and st._session_pnl < -MAX_SESS_LOSS:
        if st._halt_until == 0:
            st._halt_until = time.time() + 300
            print(f"\n  {RED}! HALT [{st.symbol}]: Lost ${abs(st._session_pnl):.2f}. Pausing 5 min.{RST}")
        if time.time() < st._halt_until: return
        st._halt_until = 0; st._session_pnl = 0

    if st._consec_losses >= MAX_LOSS_STREAK:
        if st._cooldown_until == 0:
            st._cooldown_until = time.time() + LOSS_CD
            print(f"\n  {YLW}! STREAK [{st.symbol}] ({st._consec_losses}L): Cool {LOSS_CD}s{RST}")
        if time.time() < st._cooldown_until: return
        st._consec_losses = 0; st._cooldown_until = 0

    # v1.3: take-profit check
    if MARTINGALE and TAKE_PROFIT > 0 and st._session_pnl >= TAKE_PROFIT and not st._take_profit_hit:
        st._take_profit_hit = True
        print(f"\n  {GRN}! TAKE PROFIT [{st.symbol}]: Hit ${TAKE_PROFIT:.2f} target! PnL: ${st._session_pnl:+.2f}{RST}")
        print_session_stats(st)
        return
    # v1.3: martingale halt after max consecutive losses
    if MARTINGALE and st._consec_losses >= MAX_CONSEC_LOSSES:
        if st._cooldown_until == 0:
            st._cooldown_until = time.time() + 120
            print(f"\n  {RED}! MARTINGALE HALT [{st.symbol}]: {st._consec_losses}L streak. PnL: ${st._session_pnl:+.2f} | Cooldown 2min{RST}")
        if time.time() < st._cooldown_until: return
        st._consec_losses = 0
        st._martingale_tier = 0
        st._cooldown_until = 0

    if _balance > 0 and _balance < MIN_BAL: return
    if st._tick_count - st._last_trade_tick < COOLDOWN_TICKS: return
    if st.has_active(): return
    if st._pending_buy and time.time() - st._pending_buy.get("signal_ts", 0) > 30:
        st._pending_buy = None

    # === SIGNAL ===
    if len(st.closes) < MACD_SLOW + MACD_SIG + 5: return
    if len(st.digits) < 30: return
    if h is None or ml is None: return

    sk, mo, le, dist = digit_skew(list(st.digits))
    if sk < MIN_SKEW: return
    if sk >= MAX_SKEW: return

    # === HISTOGRAM MAGNITUDE GUARD ===
    if abs(h) < MIN_HIST: return

    rsi = calc_rsi(list(st.closes), 14)
    ph = st.hist_v[-2] if len(st.hist_v) >= 2 else 0

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

    if d is None: return

    if d == "over" and rsi is not None and rsi > 65: return
    if d == "under" and rsi is not None and rsi < 35: return

    # === SMART BARRIER: require real edge in the observed distribution ===
    smart_pred, smart_edge = None, 0.0
    if SMART_BARRIER:
        sb = pick_barrier(dist if dist else {}, d)
        if sb is None:
            print(f"  {DIM}BARRIER SKIP [{st.symbol}]: no {d} edge >= {SMART_MIN_EDGE:.0%} "
                  f"in last {len(st.digits)} digits{RST}")
            return
        smart_pred, smart_edge = sb

    # === TRANSITION MATRIX CONFIRMATION ===
    mat, cur_dig, p_over, p_under = transition_matrix(list(st.digits))
    if mat is not None:
        tm_agree = (
            (d == "over" and p_over > 0.50) or
            (d == "under" and p_under > 0.50)
        )
        if not tm_agree:
            print(f"  {DIM}TM SKIP [{st.symbol}]: {d.upper()} but Trans[{cur_dig}] Over5={p_over:.1%} Under5={p_under:.1%} - disagree{RST}")
            return

    # === COMPOSITE CONFIDENCE SCORE ===
    tm_prob = p_over if d == "over" else p_under
    tm_other = p_under if d == "over" else p_over
    score = calc_confidence(h, sk, tm_prob, tm_other, rsi, d)

    if score < MIN_CONFIDENCE:
        print(f"  {DIM}SCORE SKIP [{st.symbol}]: {d.upper()} conf={score:.0f}/{MIN_CONFIDENCE:.0f}"
              f" hist={h:+.6f} skew={sk:.1f} TM={tm_prob:.1%}{RST}")
        return

    # === PREDICTION SWEEP (opt-in) ===
    if PRED_SWEEP:
        prediction_sweep(st, dist, h, sk, rsi, d)

    # === RECORD SIGNAL for correlation ===
    if CORR_ANALYSIS and len(SYMBOL_LIST) > 1:
        if st.symbol not in _correlation_signals:
            _correlation_signals[st.symbol] = []
        _correlation_signals[st.symbol].append((time.time(), d, score))

    # Score tier coloring
    if score >= 70: sc_c = GRN
    elif score >= 50: sc_c = YLW
    else: sc_c = RED

    print(f"\n  {GRN}============================================================{RST}")
    print(f"  {GRN}SIGNAL [{st.symbol}]: {d.upper()} | {reason}{RST}")
    print(f"  {GRN}Digit: {dig} | RSI: {rsi:.1f} | MACD: {ml:+.6f} | {sc_c}Score: {score:.0f}/100{RST}")
    if mat is not None:
        print_transition_info(mat, cur_dig, p_over, p_under, d)

    # v1.3: dynamic prediction selection
    if MARTINGALE:
        pred = pick_prediction(dist if dist else {}, d, rsi)
        st._current_prediction = pred
        stake = martingale_stake(st._consec_losses, pred, BASE_STAKE)
        tier_info = f"Tier{st._consec_losses}"
        print(f"  {MAG}[DYN] pred={pred} ({d.upper()}) stake=${stake:.2f} {tier_info} conf={score:.0f}{RST}")
    else:
        pred = PREDICTION
        stake = st.eff_stake(_balance, score)
    if SMART_BARRIER and smart_pred is not None:
        pred = smart_pred
        st._current_prediction = pred
        print(f"  {MAG}[SMART] barrier={pred} ({d.upper()}) edge={smart_edge:+.1%} "
              f"window={len(st.digits)} conf={score:.0f}{RST}")

    entry = log_trade(st, d, dig, rsi, h, sk, reason, score)

    if args.dry_run:
        print(f"  {DIM}[DRY RUN] Would place {d.upper()} pred={pred} stake=${stake:.2f} conf={score:.0f} [{st.symbol}]{RST}")
        return

    await place_trade(st, d, score)
    st._last_trade_tick = st._tick_count


# ========== MESSAGE HANDLER ==========

def find_symbol_state(msg_type, data):
    """Route incoming message to the correct SymbolState."""
    if msg_type == "tick":
        sym = data.get("tick", {}).get("symbol", "")
        return symbol_states.get(sym)
    # For proposal/buy/poc messages, find by active contract
    if msg_type in ("proposal", "buy", "proposal_open_contract"):
        for sym, st in symbol_states.items():
            if st.has_active() or st.pending_proposal:
                return st
    return None


async def handle_msg(ws, data):
    global _balance, ws_global
    ws_global = ws

    mt = data.get("msg_type", "?")

    if mt == "error":
        print(f"\n  {RED}X ERR: {data.get('error', {})}{RST}")

    elif mt == "tick":
        t = data.get("tick", {})
        if t:
            sym = t.get("symbol", "")
            st = symbol_states.get(sym)
            if st:
                return await process_tick(st, t)

    elif mt == "balance":
        _balance = data.get("balance", {}).get("balance", _balance)

    elif mt == "proposal":
        p = data.get("proposal", {})
        st = find_symbol_state("proposal", data)
        if "error" in data:
            err = data.get("error", {})
            err_code = err.get("code", "?") if isinstance(err, dict) else "?"
            err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            print(f"  {RED}X PROPOSAL ERR [{err_code}]: {err_msg}{RST}")
            if st:
                mark_failed(st, f"proposal_err:{err_code}")
                st._pending_buy = None; st.reset_ac()
        elif p and st and st.pending_proposal:
            pid = p.get("id")
            if pid:
                print(f"  {DIM}[PROP] id={pid} payout={p.get('payout', '?')} [{st.symbol}]{RST}")
                await client.buy(ws, pid, p.get("ask_price", 0))

    elif mt == "buy":
        bd = data.get("buy", {})
        st = find_symbol_state("buy", data)
        if "error" in data:
            err = data.get("error", {})
            err_code = err.get("code", "?") if isinstance(err, dict) else "?"
            err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            print(f"  {RED}X BUY ERR [{err_code}]: {err_msg}{RST}")
            if st:
                mark_failed(st, f"buy_err:{err_code}")
                st._pending_buy = None; st.reset_ac()
        elif bd and bd.get("contract_id") and st:
            cid = bd["contract_id"]
            d = (st.pending_proposal["direction"] if st.pending_proposal
                 else (st._pending_buy["direction"] if st._pending_buy else "?"))
            st.active_contract_id = cid
            st.active_contract = {"direction": d, "contract_id": cid}
            print(f"\n  {GRN}+ CONTRACT {cid} bought [{st.symbol}]{RST}")
            st._pending_buy = None
            await client.subscribe_open_contract(ws, cid)

    elif mt == "proposal_open_contract":
        poc = data.get("proposal_open_contract", {})
        if poc and poc.get("is_sold"):
            # Find the right symbol state for this contract
            contract_id = poc.get("contract_id")
            for sym, st in symbol_states.items():
                if st.active_contract_id == contract_id or (not contract_id and st.has_active()):
                    prof = float(poc.get("profit", 0) or 0)
                    pay = float(poc.get("payout", 0) or 0)
                    es = poc.get("exit_spot") or 0
                    # Settlement digit from the wire string / pip precision -
                    # the old float-repr read almost never matched the true exit digit
                    ex_d = true_digit(es, st.symbol)
                    res = "won" if prof > 0 else "lost"
                    for t in reversed(st._trade_log):
                        if t["result"]["status"] == "pending":
                            log_result(st, t, res, prof, pay, ex_d, _balance)
                            break
                    print_result(st, res, prof, pay, ex_d)
                    print_session_stats(st)
                    if res == "won":
                        st._consec_losses = 0
                        st._martingale_tier = 0
                    else:
                        st._consec_losses += 1
                        st._martingale_tier = st._consec_losses
                    st.reset_ac()
                    break

    return None


# ========== CORRELATION ANALYSIS ==========

def print_correlation_report():
    """Analyze cross-symbol signal timing correlation."""
    if len(SYMBOL_LIST) < 2:
        return
    print(f"\n{CYN}+{'=' * 60}+{RST}")
    print(f"{CYN}|{RST}  {BLD}CORRELATION ANALYSIS{RST}")
    print(f"{CYN}+{'=' * 60}+{RST}")

    for sym in SYMBOL_LIST:
        signals = _correlation_signals.get(sym, [])
        print(f"  {BLD}{sym}{RST}: {len(signals)} signals")
        if len(signals) >= 2:
            dirs = [s[1] for s in signals]
            overs = dirs.count("over")
            unders = dirs.count("under")
            print(f"    Over: {overs}  Under: {unders}")

    # Cross-symbol overlap: how many signals fire within 5 seconds of each other
    if len(SYMBOL_LIST) >= 2:
        all_signals = []
        for sym, sigs in _correlation_signals.items():
            for ts, d, sc in sigs:
                all_signals.append((ts, sym, d, sc))
        all_signals.sort()

        overlaps = 0
        for i in range(len(all_signals)):
            for j in range(i + 1, len(all_signals)):
                dt = all_signals[j][0] - all_signals[i][0]
                if dt > 5.0:
                    break
                if all_signals[i][1] != all_signals[j][1]:  # different symbols
                    if all_signals[i][2] == all_signals[j][2]:  # same direction
                        overlaps += 1

        total = sum(len(v) for v in _correlation_signals.values())
        corr_pct = (overlaps / max(total, 1)) * 100
        print(f"\n  {BLD}Signal overlap{RST} (same direction within 5s): {overlaps} of {total} signal pairs")
        if corr_pct > 60:
            print(f"  {RED}HIGH correlation ({corr_pct:.0f}%) — multi-vol adds limited diversification{RST}")
        elif corr_pct > 30:
            print(f"  {YLW}MODERATE correlation ({corr_pct:.0f}%) — some diversification benefit{RST}")
        else:
            print(f"  {GRN}LOW correlation ({corr_pct:.0f}%) — good diversification{RST}")

    print(f"{CYN}+{'=' * 60}+{RST}\n")


# ========== MAIN LOOP ==========

async def trading_loop():
    global ws_global

    async def on_session_open(ws):
        global ws_global
        ws_global = ws
        for st in symbol_states.values():
            st._tick_count = 0; st._last_trade_tick = 0
            # Resume any contract that was open when the last session dropped
            if st.active_contract_id:
                await client.subscribe_open_contract(ws, st.active_contract_id)
        print(f"  {DIM}{'-' * 60}{RST}")
        print(f"  {DIM}Watching MACD crossovers + digit skew on {','.join(SYMBOL_LIST)}...{RST}")
        print(f"  {DIM}{'-' * 60}{RST}")

    try:
        await client.run(handle_message=handle_msg, pre_subscribe=on_session_open)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"\n  {RED}X {e}{RST}")
        import traceback
        traceback.print_exc()


def print_summary():
    if COLLECT_MODE:
        print_collect_summary()
        return
    print(f"\n{CYN}+{'=' * 50}+{RST}")
    print(f"{CYN}|{RST}  {BLD}SESSION SUMMARY{RST}")
    for sym, st in symbol_states.items():
        t = st._s_wins + st._s_losses
        wr = (st._s_wins / t * 100) if t > 0 else 0
        print(f"{CYN}|{RST}  {BLD}{sym}{RST}: Trades {t} | W: {st._s_wins} | L: {st._s_losses} | WR: {wr:.1f}% | PnL: ${st._session_pnl:+.2f}")
    total_w = sum(st._s_wins for st in symbol_states.values())
    total_l = sum(st._s_losses for st in symbol_states.values())
    total_t = total_w + total_l
    total_pnl = sum(st._session_pnl for st in symbol_states.values())
    if total_t > 0:
        print(f"{CYN}|{RST}  {BLD}ALL{RST}:     Trades {total_t} | W: {total_w} | L: {total_l} | PnL: ${total_pnl:+.2f}")
    print(f"{CYN}+{'=' * 50}+{RST}")

    if CORR_ANALYSIS and len(SYMBOL_LIST) > 1:
        print_correlation_report()


async def main():
    # Initialize per-symbol state
    for sym in SYMBOL_LIST:
        symbol_states[sym] = SymbolState(sym)

    print_header()
    for sym in SYMBOL_LIST:
        symbol_states[sym]._trade_log = []  # fresh log per symbol
    try:
        await trading_loop()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print(f"\n  {YLW}> Stopped{RST}")
        print_summary()
        for st in symbol_states.values():
            save_log(st)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, asyncio.CancelledError):
        print(f"\n  {YLW}> Stopped{RST}")
        print_summary()
        for st in symbol_states.values():
            save_log(st)
