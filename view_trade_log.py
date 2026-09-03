#!/usr/bin/env python3
"""view_trade_log.py - print the per-run session history from trade_log.json.

Both Deriv-Stochrsi bots append one "session" record whenever they exit
(record_session_end). This tool renders those records as a readable table so
past runs are easy to review even when the console output was lost.

Usage:
    python view_trade_log.py [trade_log.json] [--trades]

The optional --trades flag expands each session's settled contracts.
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


def print_history(file="trade_log.json", show_trades=False):
    """Render the session history from a bot trade log to stdout.

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
    return 0


def main():
    ap = argparse.ArgumentParser(description="Print session history from a bot trade log.")
    ap.add_argument("file", nargs="?", default="trade_log.json", help="path to trade_log.json")
    ap.add_argument("--trades", action="store_true", help="list settled contracts per session")
    args = ap.parse_args()
    return print_history(args.file, show_trades=args.trades)


if __name__ == "__main__":
    sys.exit(main())
