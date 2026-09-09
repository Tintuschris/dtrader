"""
Backtest: Replay digit-bot.txt through v1.2 scoring (histogram threshold + composite score).
Compares original v1.0 decisions vs v1.2 filter decisions.
"""
import re, sys
from collections import deque, Counter
from dataclasses import dataclass, field

# ===== v1.2 Parameters (matching defaults) =====
MACD_FAST, MACD_SLOW, MACD_SIG = 12, 26, 9
MIN_SKEW, MAX_SKEW = 1.5, 2.0
MIN_HIST = 0.02
MIN_CONFIDENCE = 35
MACD_THRESH = 0.001
PREDICTION = 5
STAKE = 0.35

# ===== Indicator Functions (copied from Deriv-DigitBot.py) =====

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

def calc_confidence(h, sk, p_tm, p_other, rsi, d):
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

# ===== Log Parsing =====

# Tick line: #  79 v 2718.23200 [2]  MACD:-0.096540  Sig:-0.088025  H:-0.008515  RSI:43.9  Skew:1.8 H/M/L:4/3
TICK_RE = re.compile(
    r'#\s+(\d+)\s+[v^ ]\s+'
    r'(\d+\.\d+)\s+\[(\d+)\]\s+'
    r'MACD:([+-]?\d+\.\d+)\s+'
    r'Sig:([+-]?\d+\.\d+)\s+'
    r'H:([+-]?\d+\.\d+)\s+'
    r'RSI:([\d.]+|---)\s+'
    r'Skew:([\d.]+)\s+'
    r'H/M/L:(-?\d+)/(-?\d+)'
)

# Signal line: SIGNAL: UNDER | MACD DOWN hist=-0.008515 skew=1.8
SIGNAL_RE = re.compile(r'SIGNAL:\s+(OVER|UNDER)\s+\|\s+.*hist=([+-]?\d+\.\d+)\s+skew=([\d.]+)')

# Trade outcome: +--- LOST $-0.35 | Digit: 6 ---+  or  +--- WON +$0.48 | Payout $0.83 | Digit: 6 ---+
OUTCOME_RE = re.compile(r'\+\-\-\-\s+(WON|LOST)\s+\$([+-]?\d+\.\d+).*?Digit:\s+(\d+)')

# TM SKIP: TM SKIP: OVER but Trans[6] Over5=37.5% Under5=56.2% - disagree
TM_SKIP_RE = re.compile(r'TM SKIP:\s+(OVER|UNDER)\s+but Trans\[(\d+)\]\s+Over5=([\d.]+)%\s+Under5=([\d.]+)%')

def parse_log(filepath):
    """Parse digit-bot.txt into structured tick data and trade events."""
    ticks = []  # list of (tick_num, price, digit, macd, sig, hist, rsi, skew)
    signals = []  # list of (tick_num, direction, hist, skew)
    outcomes = []  # list of (tick_num, result, pnl, digit)
    tm_skips = []  # list of (tick_num, direction)

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()

    for line in lines:
        line = line.rstrip('\r\n')

        m = TICK_RE.search(line)
        if m:
            tick_num = int(m.group(1))
            price = float(m.group(2))
            digit = int(m.group(3))
            macd = float(m.group(4))
            sig = float(m.group(5))
            hist = float(m.group(6))
            rsi_str = m.group(7)
            rsi = float(rsi_str) if rsi_str != '---' else None
            skew = float(m.group(8))
            ticks.append((tick_num, price, digit, macd, sig, hist, rsi, skew))
            continue

        m = SIGNAL_RE.search(line)
        if m:
            # Find the tick number from the line above (approximate)
            signals.append((len(ticks), m.group(1), float(m.group(2)), float(m.group(3))))
            continue

        m = OUTCOME_RE.search(line)
        if m:
            outcomes.append((len(ticks), m.group(1), float(m.group(2)), int(m.group(3))))
            continue

        m = TM_SKIP_RE.search(line)
        if m:
            tm_skips.append((len(ticks), m.group(1)))

    return ticks, signals, outcomes, tm_skips


def run_backtest(ticks, signals, outcomes):
    """Replay ticks through v1.2 scoring using log's pre-computed MACD values."""
    digits = deque(maxlen=100)
    hist_v = deque(maxlen=100)

    # Original trades (from log analysis)
    original_trades = [
        {"tick": 79,  "dir": "under", "result": "LOST", "pnl": -0.35, "exit_dig": 6},
        {"tick": 419, "dir": "under", "result": "LOST", "pnl": -0.35, "exit_dig": 9},
        {"tick": 773, "dir": "over",  "result": "WON",  "pnl": 0.48,  "exit_dig": 6},
        {"tick": 1345,"dir": "over",  "result": "WON",  "pnl": 0.48,  "exit_dig": 8},
        {"tick": 1621,"dir": "over",  "result": "LOST", "pnl": -0.35, "exit_dig": 1},
        {"tick": 1856,"dir": "under", "result": "LOST", "pnl": -0.35, "exit_dig": 8},
        {"tick": 1976,"dir": "over",  "result": "WON",  "pnl": 0.48,  "exit_dig": 8},
    ]

    print("=" * 70)
    print("BACKTEST: digit-bot.txt replayed through v1.2 scoring")
    print(f"Parameters: MIN_HIST={MIN_HIST} MIN_CONF={MIN_CONFIDENCE} MIN_SKEW={MIN_SKEW}-{MAX_SKEW}")
    print("=" * 70)
    print()

    # Use log's pre-computed MACD/signal/histogram values (fast!)
    v12_signals = []

    for tn, price, digit, macd_val, sig_val, hist_val, rsi, skew in ticks:
        digits.append(digit)
        hist_v.append(hist_val)

        if len(digits) < 30: continue
        if hist_val == 0 and macd_val == 0: continue  # still warming up

        sk, mo, le, dist = digit_skew(list(digits))
        if sk < MIN_SKEW or sk >= MAX_SKEW: continue

        # === v1.2 HISTOGRAM GUARD ===
        if abs(hist_val) < MIN_HIST: continue

        # Use log's RSI if available
        rsi_val = rsi

        # Check crossover using previous histogram
        ph = hist_v[-2] if len(hist_v) >= 2 else 0
        cross_up = ph <= 0 and hist_val > 0
        cross_down = ph >= 0 and hist_val < 0
        bull = hist_val > MACD_THRESH
        bear = hist_val < -MACD_THRESH

        d = None
        if cross_up or (bull and rsi_val is not None and rsi_val < 40):
            d = "over"
        elif cross_down or (bear and rsi_val is not None and rsi_val > 60):
            d = "under"

        if d is None: continue

        # RSI guard
        if d == "over" and rsi_val is not None and rsi_val > 65: continue
        if d == "under" and rsi_val is not None and rsi_val < 35: continue

        # TM check
        mat, cur_dig, p_over, p_under = transition_matrix(list(digits))
        if mat is not None:
            tm_agree = (
                (d == "over" and p_over > 0.50) or
                (d == "under" and p_under > 0.50)
            )
            if not tm_agree: continue

        # === v1.2 COMPOSITE SCORE ===
        tm_prob = p_over if d == "over" else p_under
        tm_other = p_under if d == "over" else p_over
        score = calc_confidence(hist_val, sk, tm_prob, tm_other, rsi_val, d)

        decision = "TRADE" if score >= MIN_CONFIDENCE else "SKIP"
        v12_signals.append((tn, d, score, hist_val, sk, decision))

    # Now compare original trades vs v1.2 decisions
    print("ORIGINAL v1.0 TRADES vs v1.2 FILTER DECISIONS")
    print("-" * 70)
    print(f"{'Trade':>6} {'Tick':>6} {'Dir':>6} {'v1.0':>6} {'v1.2':>6} {'Hist':>10} {'Skew':>6} {'Score':>7} {'Outcome':>8}")
    print("-" * 70)

    orig_wins = 0
    orig_losses = 0
    v12_kept_wins = 0
    v12_kept_losses = 0
    v12_avoided_losses = 0
    v12_missed_wins = 0

    for i, trade in enumerate(original_trades):
        tn = trade["tick"]
        d = trade["dir"]
        result = trade["result"]
        pnl = trade["pnl"]

        # Find v1.2 decision for this tick (nearest signal)
        v12_decision = "N/A"
        v12_score = 0
        v12_hist = 0
        v12_skew = 0
        for sig_tn, sig_d, sig_score, sig_hist, sig_skew, sig_dec in v12_signals:
            if abs(sig_tn - tn) <= 2 and sig_d == d:
                v12_decision = sig_dec
                v12_score = sig_score
                v12_hist = sig_hist
                v12_skew = sig_skew
                break

        if result == "WON":
            orig_wins += 1
        else:
            orig_losses += 1

        if v12_decision == "TRADE":
            if result == "WON":
                v12_kept_wins += 1
            else:
                v12_kept_losses += 1
        elif v12_decision == "SKIP":
            if result == "WON":
                v12_missed_wins += 1
            else:
                v12_avoided_losses += 1
        else:
            # v1.2 wouldn't have generated this signal at all
            if result == "WON":
                v12_missed_wins += 1
            else:
                v12_avoided_losses += 1

        result_marker = "W" if result == "WON" else "L"
        v12_marker = "TRADE" if v12_decision == "TRADE" else "SKIP" if v12_decision == "SKIP" else "N/A"
        print(f"  T{i+1:>3}  #{tn:>5} {d:>6} {result_marker:>6} {v12_marker:>8} {v12_hist:>+10.6f} {v12_skew:>6.1f} {v12_score:>6.1f}  {pnl:>+.2f}")

    print("-" * 70)
    print()

    # Summary
    print("=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)
    print()
    print(f"Original v1.0:")
    print(f"  Trades: {orig_wins + orig_losses}  |  W: {orig_wins}  L: {orig_losses}  |  WR: {orig_wins/(orig_wins+orig_losses)*100:.0f}%  |  PnL: ${orig_wins*0.48 - orig_losses*0.35:+.2f}")
    print()
    print(f"After v1.2 Filters:")
    print(f"  Trades kept:    {v12_kept_wins + v12_kept_losses}  |  W: {v12_kept_wins}  L: {v12_kept_losses}  |  WR: {v12_kept_wins/max(v12_kept_wins+v12_kept_losses,1)*100:.0f}%  |  PnL: ${v12_kept_wins*0.48 - v12_kept_losses*0.35:+.2f}")
    print(f"  Losses avoided: {v12_avoided_losses}  (saved ${v12_avoided_losses*0.35:.2f})")
    print(f"  Wins missed:    {v12_missed_wins}  (forgone ${v12_missed_wins*0.48:.2f})")
    print(f"  Net improvement: ${v12_avoided_losses*0.35 - v12_missed_wins*0.48:+.2f}")
    print()

    # Also count v1.2 signals that the old bot DIDN'T take
    extra_v12 = [s for s in v12_signals if s[5] == "TRADE" and not any(abs(s[0] - t["tick"]) <= 2 for t in original_trades)]
    if extra_v12:
        print(f"Extra v1.2 signals NOT in original log: {len(extra_v12)}")
        for tn, d, score, h, sk, dec in extra_v12[:5]:
            print(f"  #{tn:>5} {d:>6} hist={h:+.6f} skew={sk:.1f} score={score:.1f}")

    # Filter breakdown
    print("\nFILTER BREAKDOWN (what stopped each original trade):")
    print("-" * 70)
    for i, trade in enumerate(original_trades):
        tn = trade["tick"]
        d = trade["dir"]
        result = trade["result"]
        # Find the tick data
        tick_info = None
        for t in ticks:
            if t[0] == tn:
                tick_info = t
                break
        if tick_info is None:
            continue
        _, price, digit, macd_val, sig_val, hist_val, rsi, skew = tick_info

        # Determine what would have blocked it in v1.2
        reasons = []
        if abs(hist_val) < MIN_HIST:
            reasons.append(f"hist={hist_val:+.6f} < {MIN_HIST}")
        if skew < MIN_SKEW or skew >= MAX_SKEW:
            reasons.append(f"skew={skew:.1f} outside [{MIN_SKEW},{MAX_SKEW})")

        # Check score
        closes_list = [t[1] for t in ticks if t[0] <= tn][-500:]
        rsi_val = calc_rsi(closes_list, 14) if len(closes_list) > 14 else rsi
        sk_check, _, _, dist = digit_skew(list(digits))
        if not reasons and (sk_check < MIN_SKEW or sk_check >= MAX_SKEW):
            reasons.append(f"skew={sk_check:.1f} outside [{MIN_SKEW},{MAX_SKEW})")
        if not reasons and abs(hist_val) < MIN_HIST:
            reasons.append(f"hist={hist_val:+.6f} < {MIN_HIST}")

        # Check TM
        mat, cur_dig, p_over, p_under = transition_matrix(list(digits))
        if not reasons and mat is not None:
            tm_agree = (d == "over" and p_over > 0.50) or (d == "under" and p_under > 0.50)
            if not tm_agree:
                reasons.append(f"TM disagree Over5={p_over:.1%} Under5={p_under:.1%}")

        # Check score
        if not reasons:
            tm_prob = p_over if d == "over" else p_under
            tm_other = p_under if d == "over" else p_over
            score = calc_confidence(hist_val, sk_check, tm_prob, tm_other, rsi_val, d)
            if score < MIN_CONFIDENCE:
                reasons.append(f"score={score:.1f} < {MIN_CONFIDENCE}")

        reason_str = " + ".join(reasons) if reasons else "PASSES all filters"
        marker = "BLOCKED" if reasons else "WOULD TRADE"
        print(f"  T{i+1} #{tn:>5} {d:>6} {trade['result']:>4} | {marker}: {reason_str}")
    print()

    print()
    print("=" * 70)
    print("v1.2 SIGNAL SUMMARY (entire session)")
    print("=" * 70)
    total_v12 = len(v12_signals)
    traded = sum(1 for s in v12_signals if s[5] == "TRADE")
    skipped = sum(1 for s in v12_signals if s[5] == "SKIP")
    print(f"  Total v1.2 signals: {total_v12}")
    print(f"  Would TRADE:  {traded}")
    print(f"  Would SKIP:   {skipped} (below MIN_CONF={MIN_CONFIDENCE})")
    print()

    if v12_kept_wins + v12_kept_losses > 0:
        new_wr = v12_kept_wins / (v12_kept_wins + v12_kept_losses) * 100
        old_wr = orig_wins / (orig_wins + orig_losses) * 100
        print(f"  Win rate: {old_wr:.0f}% → {new_wr:.0f}% ({'+' if new_wr > old_wr else ''}{new_wr-old_wr:.0f}pp)")
    print()


if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "docs/digit-bot.txt"
    print(f"Parsing {filepath}...")
    ticks, signals, outcomes, tm_skips = parse_log(filepath)
    print(f"  Parsed {len(ticks)} ticks, {len(signals)} signals, {len(outcomes)} outcomes, {len(tm_skips)} TM skips")
    print()
    run_backtest(ticks, signals, outcomes)
