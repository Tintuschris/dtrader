#!/usr/bin/env python3
"""view_trade_log.py - print the per-run session history from trade_log.json.

Both Deriv-Stochrsi bots append one "session" record whenever they exit
(record_session_end). This tool renders those records as a readable table so
past runs are easy to review even when the console output was lost.

Usage:
    python view_trade_log.py [trade_log.json] [--trades] [--max-sessions N] [--trim] [--stats]

The optional --trades flag expands each session's settled contracts.
--max-sessions N limits the display to the newest N sessions.
--trim (requires --max-sessions) also deletes the older records from the
file, keeping only the newest N.
--stats additionally prints the win/loss band analysis from
analyze_trade_log.py (overall WR, RSI/SRSI bands, after-loss behavior,
SHORT misfire watch) using the same trade log.
"""

import argparse
import json
import os
import sys

COLUMNS = [
    ("#", 4, "l"),
    ("Start", 19, "l"),
    ("Duration", 10, "l"),
    ("Exit reason", 13, "l"),
    ("Trades", 7, "r"),
    ("W-L-C", 9, "r"),
    ("WR", 7, "r"),
    ("PnL", 11, "r"),
]

REASON_LABELS = {
    "user_stop": "User stop",
    "max_reconnects": "Max reconnect",
    "process_end": "Process end",
}


def fmt_duration(sec):
    try:
        sec = float(sec)
    except (TypeError, ValueError):
        return "?"
    if sec < 60:
        return f"{sec:.0f}s"
    sec = int(round(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def cell(text, width, align):
    text = str(text)
    if len(text) > width:
        text = text[: width - 1] + "~"
    return text.rjust(width) if align == "r" else text.ljust(width)


def header():
    head = "|".join(cell(name, w, a) for (name, w, a) in COLUMNS)
    head = f"|{head}|"
    rule = "+" + "+".join("-" * w for (_, w, _) in COLUMNS) + "+"
    return f"{rule}\n{head}\n{rule}"


def footer():
    return "+" + "+".join("-" * w for (_, w, _) in COLUMNS) + "+"


def get_sum(s, key, default=0):
    try:
        v = s.get("summary", {}).get(key, default)
        return default if v is None else v
    except AttributeError:
        return default


def trim_sessions(file="trade_log.json", max_sessions=1):
    """Delete all but the newest max_sessions records from a trade log.

    Rewrites the file, preserving its other keys (summary/trades/note).
    Returns the number of records removed, or None if the file is missing
    or could not be read/written.
    """
    try:
        with open(file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"X No trade log found at: {file}")
        return None
    except Exception as e:
        print(f"X Could not read {file}: {e}")
        return None
    sessions = data.get("sessions") or []
    if len(sessions) <= max_sessions:
        return 0
    try:
        keyed = sorted(enumerate(sessions), key=lambda t: t[1].get("session_start_epoch", 0) or 0)
    except Exception:
        keyed = list(enumerate(sessions))
    keep_pos = {i for i, _ in keyed[-max_sessions:]}
    kept = [s for i, s in enumerate(sessions) if i in keep_pos]
    removed = len(sessions) - len(kept)
    data["sessions"] = kept
    try:
        with open(file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"X Could not write {file}: {e}")
        return None
    print(f"Trimmed {removed} old session record(s); kept the newest {len(kept)} in {file}.")
    return removed


def print_history(file="trade_log.json", show_trades=False, max_sessions=None):
    """Render the session history from a bot trade log to stdout.

    max_sessions limits the display to the newest N sessions (None = all).
    Returns 0 on success, 1 when the file is missing or unreadable.
    """
    if not os.path.exists(file):
        print(f"X No trade log found at: {file}")
        print("  (Run a bot once and let it exit to create one.)")
        return 1

    try:
        with open(file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"X Could not read {file}: {e}")
        return 1

    sessions = data.get("sessions") or []
    if not sessions:
        print(f"No session records in {file} yet.")
        print("  Sessions are appended whenever a bot exits gracefully (Ctrl+C or")
        print("  'Max reconnection attempts reached'); older logs predate this feature.")
        summary = data.get("summary") or {}
        if summary:
            print()
            print(f"  Current top-level summary: {summary.get('total_trades', 0)} trades | "
                  f"WR {summary.get('win_rate', 0)}% | PnL {summary.get('pnl', 0):+}")
        return 0

    try:
        sessions = sorted(sessions, key=lambda s: s.get("session_start_epoch", 0) or 0, reverse=True)
    except Exception:
        pass
    total_sessions = len(sessions)
    if max_sessions and total_sessions > max_sessions:
        sessions = sessions[:max_sessions]

    print(header())
    totals = {"n": 0, "settled": 0, "wins": 0, "losses": 0, "cancelled": 0, "pnl": 0.0}
    for i, s in enumerate(sessions, start=1):
        ssum = s.get("summary") or {}
        settled = int(get_sum(s, "settled"))
        wins = int(get_sum(s, "wins"))
        losses = int(get_sum(s, "losses"))
        cancelled = int(get_sum(s, "cancelled"))
        wr = float(ssum.get("win_rate") or 0)
        pnl = float(ssum.get("pnl") or 0)
        reason = REASON_LABELS.get(s.get("exit_reason"), str(s.get("exit_reason") or "?"))
        rows = [
            (i, 4, "l"),
            (str(s.get("session_start", "?")), 19, "l"),
            (fmt_duration(s.get("duration_sec")), 10, "l"),
            (reason, 13, "l"),
            (settled, 7, "r"),
            (f"{wins}W-{losses}L-{cancelled}C", 9, "r"),
            (f"{wr:.1f}%", 7, "r"),
            (f"{pnl:+.2f}", 11, "r"),
        ]
        line = "|".join(cell(v, w, a) for (v, w, a) in rows)
        print(f"|{line}|")

        if show_trades and s.get("settled_trades"):
            for t in s["settled_trades"]:
                cid = t.get("contract_id")
                prof = t.get("profit")
                prof_s = f"{float(prof):+.2f}" if isinstance(prof, (int, float)) or (prof is not None and str(prof).replace('.', '', 1).replace('-', '', 1).isdigit()) else str(prof)
                print(f"|   - {cid} {str(t.get('direction', '?')):6s} {str(t.get('status', '?')):9s} "
                      f"{prof_s:>8s}  {t.get('settled_at') or ''} |")

        totals["n"] += 1
        totals["settled"] += settled
        totals["wins"] += wins
        totals["losses"] += losses
        totals["cancelled"] += cancelled
        totals["pnl"] += pnl

    print(footer())
    tot = totals
    wr_all = (tot["wins"] / tot["settled"] * 100) if tot["settled"] else 0.0
    print(f"TOTALS  {tot['n']} session(s) | {tot['settled']} settled | "
          f"{tot['wins']}W-{tot['losses']}L-{tot['cancelled']}C | WR {wr_all:.1f}% | "
          f"PnL {tot['pnl']:+.2f}")
    if max_sessions and total_sessions > max_sessions:
        print(f"  (newest {tot['n']} of {total_sessions} sessions shown)")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Print session history from a bot trade log.")
    ap.add_argument("file", nargs="?", default="trade_log.json", help="path to trade_log.json")
    ap.add_argument("--trades", action="store_true", help="list settled contracts per session")
    ap.add_argument("--max-sessions", type=int, metavar="N",
                    help="show only the newest N session records")
    ap.add_argument("--trim", action="store_true",
                    help="with --max-sessions N: delete older session records from the file")
    ap.add_argument("--stats", action="store_true",
                    help="also print the win/loss band analysis from analyze_trade_log.py")
    args = ap.parse_args()
    if args.max_sessions is not None and args.max_sessions < 1:
        ap.error("--max-sessions must be at least 1")
    if args.trim and not args.max_sessions:
        ap.error("--trim requires --max-sessions N")
    if args.trim:
        if trim_sessions(args.file, args.max_sessions) is None:
            return 1
    rc = print_history(args.file, show_trades=args.trades, max_sessions=args.max_sessions)
    if args.stats:
        print()
        try:
            from analyze_trade_log import print_analysis
            rc = rc or print_analysis(args.file)
        except ImportError:
            print("X analyze_trade_log.py not found - cannot run band analysis")
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
