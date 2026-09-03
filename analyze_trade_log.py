#!/usr/bin/env python3
"""analyze_trade_log.py - repeatable win/loss analysis over trade_log.json.

Scans the signal log written by the Deriv bots and prints:
  * overall settled win rate (optionally from a --since cutoff onward)
  * LONG/SHORT loss rates by RSI and SRSI band
  * what tends to follow a loss (same vs opposite direction)
  * whether "similar" same-direction re-entries lose more than divergent ones
  * a SHORT misfire watch: LOWER signals taken from below-mid SRSI, with a
    recommendation once enough post-fix data has accumulated

Usage:
    python analyze_trade_log.py [trade_log.json] [--since "YYYY-MM-DD HH:MM:SS"]
"""

import argparse
import json
import sys

MISFIRE_SRSI = 0.50   # LOWER signal with entry SRSI below this = misfire band
MISFIRE_MIN_N = 5     # post-fix LOWER signals needed before judging


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def outcome(trade):
    result = trade.get("result")
    if not result:
        return None
    profit = result.get("profit")
    if profit is None:
        return None
    return "L" if float(profit) < 0 else "W"


def fmt(n, wins):
    if not n:
        return "n=0"
    wr = 100.0 * wins / n
    return "n={:2d}  {:d}W/{:d}L  WR {:5.1f}%".format(n, wins, n - wins, wr)


def band_table(trades, direction):
    rows = []
    for t in trades:
        if t.get("direction") != direction:
            continue
        o = outcome(t)
        sig = t.get("signal") or {}
        rsi = sig.get("rsi_value")
        srsi = sig.get("srsi_value")
        if not o or rsi is None or srsi is None:
            continue
        rows.append((float(rsi), float(srsi), o))
    if not rows:
        print("  {}: no settled trades".format(direction.upper()))
        return
    if direction == "higher":
        bands = [(0, 20), (20, 30), (30, 40), (40, 999)]
        blabel = ["RSI <20", "20-30", "30-40", ">=40"]
        sbands = [(0.0, 0.2), (0.2, 0.35), (0.35, 0.5), (0.5, 1.01)]
        slabel = ["SRSI <0.20", "0.20-0.35", "0.35-0.50", ">=0.50"]
    else:
        bands = [(0, 60), (60, 70), (70, 80), (80, 999)]
        blabel = ["RSI <60", "60-70", "70-80", ">=80"]
        sbands = [(0.0, 0.5), (0.5, 0.7), (0.7, 0.85), (0.85, 1.01)]
        slabel = ["SRSI <0.50", "0.50-0.70", "0.70-0.85", ">=0.85"]
    print("  {} by RSI:".format(direction.upper()))
    for (lo, hi), lab in zip(bands, blabel):
        grp = [r for r in rows if lo <= r[0] < hi]
        print("    {:<12}{}".format(lab, fmt(len(grp), sum(1 for r in grp if r[2] == "W"))))
    print("  {} by SRSI:".format(direction.upper()))
    for (lo, hi), lab in zip(sbands, slabel):
        grp = [r for r in rows if lo <= r[1] < hi]
        print("    {:<14}{}".format(lab, fmt(len(grp), sum(1 for r in grp if r[2] == "W"))))


def after_loss(trades):
    seq = [(t.get("id"), t, outcome(t)) for t in trades if t.get("id") is not None]
    seq.sort(key=lambda x: x[0])
    opp = []
    same = []
    for i, (tid, t, o) in enumerate(seq):
        if o != "L":
            continue
        for nid, nt, no in seq[i + 1:]:
            if not no:
                continue
            if nt.get("direction") != t.get("direction"):
                opp.append(no)
            else:
                same.append(no)
            break
    print("  next trade after a loss:")
    print("    opposite direction {:<3}{}".format("", fmt(len(opp), sum(1 for x in opp if x == "W"))))
    print("    same direction    {:<3}{}".format("", fmt(len(same), sum(1 for x in same if x == "W"))))


def similarity(trades):
    seq = [(t.get("id"), t, outcome(t)) for t in trades if t.get("id") is not None]
    seq.sort(key=lambda x: x[0])
    pairs = []
    for i in range(len(seq) - 1):
        _, a, oa = seq[i]
        _, b, ob = seq[i + 1]
        sa, sb = a.get("signal") or {}, b.get("signal") or {}
        if a.get("direction") != b.get("direction") or not oa or not ob:
            continue
        if sa.get("rsi_value") is None or sb.get("rsi_value") is None:
            continue
        if sa.get("srsi_value") is None or sb.get("srsi_value") is None:
            continue
        dr = abs(float(sb["rsi_value"]) - float(sa["rsi_value"]))
        ds = abs(float(sb["srsi_value"]) - float(sa["srsi_value"]))
        pairs.append((dr, ds, ob))
    for lab, cond in [
        ("dRsi < 6", lambda r: r[0] < 6),
        ("dRsi 6-12", lambda r: 6 <= r[0] < 12),
        ("dRsi >= 12", lambda r: r[0] >= 12),
        ("dSrsi < 0.15", lambda r: r[1] < 0.15),
        ("dSrsi >= 0.15", lambda r: r[1] >= 0.15),
    ]:
        grp = [r for r in pairs if cond(r)]
        print("    {:<16}{}".format(lab, fmt(len(grp), sum(1 for r in grp if r[2] == "W"))))


def misfire_watch(trades):
    """Watch for SHORT signals taken from below-mid SRSI (weak short premise)."""
    lows = []
    for t in trades:
        if t.get("direction") != "lower":
            continue
        o = outcome(t)
        sig = t.get("signal") or {}
        srsi = sig.get("srsi_value")
        if not o or srsi is None:
            continue
        srsi = float(srsi)
        if srsi < MISFIRE_SRSI:
            lows.append((t.get("id"), t.get("timestamp", "?"), srsi, o))
    total_lower = sum(1 for t in trades if t.get("direction") == "lower" and outcome(t))
    print("  LOWER signals in this window: {}".format(total_lower))
    if not lows:
        print("  misfires (entry SRSI < {:.2f}): none".format(MISFIRE_SRSI))
        if total_lower >= MISFIRE_MIN_N:
            print("  -> pattern does NOT hold over {} LOWER signals; no SRSI floor needed yet".format(total_lower))
        else:
            print("  -> need {} post-fix LOWER signals to judge; currently {}".format(MISFIRE_MIN_N, total_lower))
        return
    print("  misfires (entry SRSI < {:.2f}):".format(MISFIRE_SRSI))
    for tid, ts, srsi, o in lows:
        print("    #{}  {}  srsi={:.3f}  -> {}".format(tid, ts, srsi, "WON" if o == "W" else "LOST"))
    wr = 100.0 * sum(1 for _, _, _, o in lows if o == "W") / len(lows)
    if len(lows) >= 3 and wr < 50.0:
        print("  -> pattern holds: {}/{} misfires lost. Consider SOFT_SRSI_SHORT_MIN=0.50".format(
            sum(1 for _, _, _, o in lows if o == "L"), len(lows)))
    else:
        print("  -> need more data to confirm ({} misfire(s), WR {:.0f}%). "
              "Re-run after a few more sessions.".format(len(lows), wr))


def print_analysis(file="trade_log.json", since=None):
    """Render the full win/loss analysis report to stdout.

    since: optional "YYYY-MM-DD HH:MM:SS" cutoff; only trades at/after it are
    considered (use your last bot-restart time for post-fix analysis).
    Returns 0 on success, 1 when the file is missing or unreadable.
    """
    try:
        data = load(file)
    except Exception as exc:
        print("error: cannot read {}: {}".format(file, exc))
        return 1
    trades = data.get("trades", [])
    if since:
        trades = [t for t in trades if str(t.get("timestamp", "")) >= since]
        print("window: trades at/after {}".format(since))
    results = [(t, outcome(t)) for t in trades if outcome(t)]
    if not results:
        print("no settled trades found in {} (window: {})".format(file, since or "all"))
        return 0
    wins = sum(1 for _, o in results if o == "W")
    print("file: {}".format(file))
    print("signals logged: {} | settled: {}".format(len(trades), len(results)))
    print("overall: {}".format(fmt(len(results), wins)))
    print()
    band_table(trades, "higher")
    print()
    band_table(trades, "lower")
    print()
    print("after-loss behavior:")
    after_loss(trades)
    print()
    print("same-direction re-entries by setup difference:")
    similarity(trades)
    print()
    print("SHORT misfire watch:")
    misfire_watch(trades)
    return 0


def main():
    ap = argparse.ArgumentParser(description="Analyze Deriv bot results from trade_log.json")
    ap.add_argument("file", nargs="?", default="trade_log.json")
    ap.add_argument("--since", metavar="YYYY-MM-DD HH:MM:SS",
                    help="only consider trades at/after this timestamp (e.g. your last bot restart)")
    args = ap.parse_args()
    return print_analysis(args.file, since=args.since)


if __name__ == "__main__":
    sys.exit(main())
