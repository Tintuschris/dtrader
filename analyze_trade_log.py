#!/usr/bin/env python3
"""analyze_trade_log.py - repeatable win/loss analysis over trade_log.json.

Scans the signal log written by the Deriv bots and prints:
  * overall settled win rate (optionally from a --since cutoff onward)
  * LONG/SHORT loss rates by RSI and SRSI band
  * what tends to follow a loss (same vs opposite direction)
  * whether "similar" same-direction re-entries lose more than divergent ones
  * a SHORT misfire watch: LOWER signals taken from below-mid SRSI, with a
    recommendation once enough post-fix data has accumulated
  * with --short-cohorts: the SHORT cohort split by downs-at-entry
    (>=3/4 vs 2/4 of the last 4 ticks), the SHORT momentum-gate check

Usage:
    python analyze_trade_log.py [trade_log.json ...] [--since "YYYY-MM-DD HH:MM:SS"]
                                [--short-cohorts]
"""

import argparse
import json
import sys

MISFIRE_SRSI = 0.50   # LOWER signal with entry SRSI below this = misfire band
MISFIRE_MIN_N = 5     # post-fix LOWER signals needed before judging
GATE_LOOKBACK = 4     # SHORT momentum gate window: downs in the last 4 ticks
SRSI_FLOOR = 0.50     # SHORT entry SRSI floor (once _backfill_data.json exists)


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


def downs_at_entry(trade, lookback=GATE_LOOKBACK):
    """Down-transitions in the last `lookback` ticks before entry.

    Mirrors the bots' SHORT momentum gate math exactly (strictly-lower
    transitions across the last lookback+1 ticks), using the last_5_ticks
    window captured in the log. Returns None when no usable window exists.
    """
    ticks = (trade.get("market") or {}).get("last_5_ticks") or []
    window = ticks[-(lookback + 1):]
    if len(window) < lookback + 1:
        return None
    return sum(1 for i in range(1, len(window)) if window[i] < window[i - 1])


def ordered(trades):
    """Trades in chronological order (epoch, then timestamp, then id).

    Needed when several logs are merged: per-file ids collide, so ordering
    by id alone would scramble the sequence across files.
    """
    def key(t):
        ep = t.get("epoch")
        return (float(ep) if ep else 0.0, str(t.get("timestamp", "")), t.get("id") or 0)
    return sorted(trades, key=key)


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
    seq = [(t.get("id"), t, outcome(t)) for t in ordered(trades) if t.get("id") is not None]
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
    seq = [(t.get("id"), t, outcome(t)) for t in ordered(trades) if t.get("id") is not None]
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


def misfire_watch(trades, poc):
    """Watch for SHORT signals taken from below-mid SRSI (weak short premise).

    Uses two sources of SRSI:
      * log_srsi  - the srsi_value recorded in signal.srsi_value at entry.
      * poc_srsi  - the SRSI value confirmed from _backfill_data.json/poc for
        the same contract_id (only when present).
    A trade is flagged when EITHER value is below MISFIRE_SRSI, but the print
    line always shows the log value first, with "backfill N.NNN" appended when
    it differs and is available.
    """
    lows = []
    for t in trades:
        if t.get("direction") != "lower":
            continue
        o = outcome(t)
        if not o:
            continue
        sig = t.get("signal") or {}
        log_srsi = sig.get("srsi_value")
        cid = (t.get("result") or {}).get("contract_id")
        p = poc.get(str(cid)) if cid is not None and poc else None
        poc_srsi = p.get("srsi_value") if p else None
        violators = [float(v) for v in (log_srsi, poc_srsi) if v is not None]
        if not violators:
            continue
        if min(violators) < MISFIRE_SRSI:
            lows.append((t.get("id"), t.get("timestamp", "?"), log_srsi,
                         poc_srsi, o))
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
    for tid, ts, log_srsi, poc_srsi, o in lows:
        extra = ""
        if poc_srsi is not None and poc_srsi != log_srsi:
            extra = "  backfill {:.3f}".format(poc_srsi)
        print("    #{}  {}  srsi={:.3f}{}".format(tid, ts,
              log_srsi if log_srsi is not None else float('nan'), extra,
              "WON" if o == "W" else "LOST"))
    wr = 100.0 * sum(1 for _, _, _, _, o in lows if o == "W") / len(lows)
    if len(lows) >= 3 and wr < 50.0:
        print("  -> pattern holds: {}/{} misfires lost. Consider SOFT_SRSI_SHORT_MIN=0.50".format(
            sum(1 for _, _, _, _, o in lows if o == "L"), len(lows)))
    else:
        print("  -> need more data to confirm ({} misfire(s), WR {:.0f}%). "
              "Re-run after a few more sessions.".format(len(lows), wr))


def cohort_block(trades, label, poc=None):
    """Print one SHORT cohort table (the momentum-gate check).

    `poc` is an optional backfill lookup {contract_id: backfill_poc}; when
    present the table also prints the median entry SRSI for each cohort.
    """
    print("  {}:".format(label))
    shorts = [t for t in trades if t.get("direction") == "lower" and outcome(t)]
    downs = [(t, downs_at_entry(t)) for t in shorts]

    def srsi_for(t):
        if not poc:
            return None
        cid = (t.get("result") or {}).get("contract_id")
        if cid is None:
            return None
        p = poc.get(str(cid))
        if not p:
            return None
        return p.get("srsi_value")

    def row(name, grp):
        if not grp:
            print("    {:<16}n=0".format(name))
            return
        wins = sum(1 for t in grp if outcome(t) == "W")
        pnl = sum(float((t.get("result") or {}).get("profit") or 0) for t in grp)
        srsis = [float(s) for s in (srsi_for(t) for t in grp) if s is not None]
        srsi_line = ""
        if srsis:
            srsi_line = "  median SRSI {:.3f}".format(sorted(srsis)[(len(srsis) - 1) // 2])
        print("    {:<16}n={:2d}  {:d}W/{:d}L  WR {:5.1f}%  PnL ${:+.2f}{}".format(
            name, len(grp), wins, len(grp) - wins, 100.0 * wins / len(grp), pnl, srsi_line))

    row(">=3/4 downs", [t for t, dn in downs if dn is not None and dn >= 3])
    row("2/4 downs", [t for t, dn in downs if dn == 2])
    row("<=1/4 downs", [t for t, dn in downs if dn is not None and dn <= 1])
    row("no tick window", [t for t, dn in downs if dn is None])
    row("SHORT overall", shorts)


def short_cohort_report(trades, since=None, poc=None):
    """Print the SHORT cohort split by downs-at-entry (momentum-gate check).

    With `since`, prints the pre-window baseline and the at/after window side
    by side - e.g. pass the gated bot's start time to compare the gated
    SHORTs against the pre-gate cohorts.

    `poc` is an optional backfill lookup {contract_id: backfill_poc}; when
    present the cohort table also reports the median entry SRSI for each cohort
    so you can see whether a cohort is being fed weak setup SRSI values.
    """
    print("SHORT momentum cohorts (down-transitions in the last {} ticks at entry):".format(GATE_LOOKBACK))
    if since:
        before = [t for t in trades if str(t.get("timestamp", "")) < since]
        after = [t for t in trades if str(t.get("timestamp", "")) >= since]
        cohort_block(before, "baseline: before {}".format(since), poc=poc)
        cohort_block(after, "window: at/after {}".format(since), poc=poc)
    else:
        cohort_block(trades, "all history", poc=poc)


def load_backfill():
    """Load the backfill POC lookup from _backfill_data.json if present.

    Returns (poc_dict, None) on success, or (None, error_string) when the
    file is missing, empty, or unreadable. A missing backfill is not an error
    - the caller still gets a full report.
    """
    try:
        d = load("_backfill_data.json")
    except Exception as exc:
        return None, "no backfill: {}".format(exc)
    poc = d.get("poc") if isinstance(d, dict) else None
    if not isinstance(poc, dict):
        return None, "no backfill POC records"
    return poc, None


def print_analysis(file="trade_log.json", since=None, short_cohorts=False):
    """Render the win/loss analysis report to stdout.

    file: a single trade-log path, or a list of paths whose trades are merged
    for combined analysis.
    since: optional "YYYY-MM-DD HH:MM:SS" cutoff; only trades at/after it are
    considered (use your last bot-restart time for post-fix analysis).
    short_cohorts: print only the SHORT downs-at-entry cohort split (the
    momentum-gate check) instead of the full report.
    Returns 0 on success, 1 when a file is missing or unreadable.
    """
    files = [file] if isinstance(file, str) else list(file)
    trades = []
    try:
        for path in files:
            trades.extend(load(path).get("trades", []))
    except Exception as exc:
        print("error: cannot read {}: {}".format(", ".join(files), exc))
        return 1
    poc, poc_note = load_backfill()
    if poc_note:
        print("note: {}".format(poc_note))
    if short_cohorts:
        short_cohort_report(trades, since=since, poc=poc)
        return 0
    if since:
        trades = [t for t in trades if str(t.get("timestamp", "")) >= since]
        print("window: trades at/after {}".format(since))
    results = [(t, outcome(t)) for t in trades if outcome(t)]
    if not results:
        print("no settled trades found in {} (window: {})".format(file, since or "all"))
        return 0
    wins = sum(1 for _, o in results if o == "W")
    print("file: {}".format(", ".join(files)))
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
    misfire_watch(trades, poc)
    return 0


def main():
    ap = argparse.ArgumentParser(description="Analyze Deriv bot results from trade_log.json")
    ap.add_argument("file", nargs="*", default=["trade_log.json"],
                    help="trade log file(s); multiple logs are merged")
    ap.add_argument("--since", metavar="YYYY-MM-DD HH:MM:SS",
                    help="only consider trades at/after this timestamp (e.g. your last bot restart)")
    ap.add_argument("--short-cohorts", action="store_true",
                    help="print the SHORT cohort split by downs-at-entry (>=3/4 vs 2/4), "
                         "the SHORT momentum-gate check")
    args = ap.parse_args()
    return print_analysis(args.file, since=args.since, short_cohorts=args.short_cohorts)


if __name__ == "__main__":
    sys.exit(main())
