"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconRefresh, IconChartBar } from "@tabler/icons-react";

type DerivTrade = { contract_id: string; contract_type: string; symbol: string; buy_price: number; payout: number; profit: number; status: string; barrier?: string; purchase_time: number; sell_time?: number; account_type: "demo" | "real"; account_id: string };
type Props = {
  accountId: string;
  balanceCurrency: string;
  fetchProfitTable?: (opts?: { limit?: number; offset?: number }) => Promise<{ transactions: unknown[]; count: number } | null>;
};
type StatusFilter = "all" | "won" | "lost" | "break_even";

export default function TradingHistory({ accountId, balanceCurrency, fetchProfitTable }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all"); const [trades, setTrades] = useState<DerivTrade[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20); const [total, setTotal] = useState<number | null>(null); const [hasMore, setHasMore] = useState(false);

  const mapTrade = (item: Record<string, unknown>, accountType: "demo" | "real", accountIdVal: string): DerivTrade => {
    const profit = Number(item.profit ?? 0);
    const receivedStatus = String(item.status ?? "").toLowerCase();
    return {
      contract_id: String(item.contract_id ?? item.transaction_id ?? ""),
      contract_type: String(item.contract_type ?? ""),
      symbol: String(item.underlying ?? item.symbol ?? ""),
      buy_price: Number(item.buy_price ?? 0),
      payout: Number(item.payout ?? item.sell_price ?? 0),
      profit,
      status: receivedStatus || (profit > 0 ? "won" : profit < 0 ? "lost" : "break_even"),
      barrier: item.barrier == null ? undefined : String(item.barrier),
      purchase_time: Number(item.purchase_time ?? item.transaction_time ?? 0),
      sell_time: Number(item.sell_time ?? 0) || undefined,
      account_type: accountType,
      account_id: accountIdVal,
    };
  };

  const fetchTrades = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);

    // Try client-side WebSocket first (works in browser, bypasses Vercel WS limitation)
    if (fetchProfitTable) {
      try {
        const limit = pageSize;
        const offset = (page - 1) * pageSize;
        const result = await fetchProfitTable({ limit, offset });
        if (result) {
          const txs = (result.transactions ?? []) as Record<string, unknown>[];
          const mapped = txs.map((t) => mapTrade(t, accountId.startsWith("VR") || accountId.startsWith("DOT") ? "demo" : "real", accountId));
          setTrades(mapped);
          setTotal(result.count ?? mapped.length);
          setHasMore(txs.length === limit);
          setLoading(false);
          return;
        }
      } catch (cause) {
        console.warn("[history] client-side fetch failed, trying server:", cause);
      }
    }

    // Fallback: server route (may fail on Vercel due to WS limitations)
    try {
      const query = new URLSearchParams({ accountId, limit: String(pageSize), offset: String((page - 1) * pageSize) });
      const response = await fetch(`/api/deriv/trades?${query}`, { cache: "no-store" });
      const data = await response.json() as { trades?: DerivTrade[]; total?: number | null; hasMore?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load trade history");
      setTrades(data.trades ?? []);
      setTotal(typeof data.total === "number" ? data.total : null);
      setHasMore(Boolean(data.hasMore));
    } catch (cause) {
      setTrades([]);
      setError(cause instanceof Error ? cause.message : "Unable to load trade history");
    } finally {
      setLoading(false);
    }
  }, [accountId, page, pageSize, fetchProfitTable]);
  useEffect(() => { setPage(1); }, [accountId, pageSize]); useEffect(() => { void fetchTrades(); }, [fetchTrades]);
  const filtered = useMemo(() => statusFilter === "all" ? trades : trades.filter((trade) => trade.status === statusFilter), [trades, statusFilter]);
  const stats = useMemo(() => { const wins = filtered.filter((trade) => trade.profit > 0).length; const losses = filtered.filter((trade) => trade.profit < 0).length; const pnl = filtered.reduce((sum, trade) => sum + trade.profit, 0); const stake = filtered.reduce((sum, trade) => sum + trade.buy_price, 0); return { wins, losses, pnl, stake, rate: filtered.length ? (wins / filtered.length) * 100 : 0 }; }, [filtered]);
  const fmt = (value: number) => value.toFixed(2); const when = (value: number) => value ? new Date(value * 1000).toLocaleString() : "\u2014"; const statusLabel = (status: string, profit: number) => status === "break_even" ? "Break-even" : profit > 0 ? "Won" : profit < 0 ? "Lost" : status || "Closed";
  return <div className="history-panel">
    <div className="history-context"><span className={`account-mini-badge ${trades[0]?.account_type ?? "demo"}`}>{trades[0]?.account_type === "real" ? "R" : "D"}</span><span>Closed contracts for <strong>{accountId || "the selected account"}</strong> \u00b7 {balanceCurrency}</span></div>
    <div className="history-summary"><Metric label="Page P&L" value={`${stats.pnl >= 0 ? "+" : ""}${fmt(stats.pnl)} ${balanceCurrency}`} tone={stats.pnl >= 0 ? "positive" : "negative"} /><Metric label="Win rate" value={`${stats.rate.toFixed(1)}%`} /><Metric label="Contracts" value={String(filtered.length)} /><Metric label="Stake" value={`${fmt(stats.stake)} ${balanceCurrency}`} /><Metric label="W / L" value={`${stats.wins} / ${stats.losses}`} /></div>
    <div className="history-filters">{(["all", "won", "lost", "break_even"] as StatusFilter[]).map((filter) => <button key={filter} className={`filter-btn ${statusFilter === filter ? "active" : ""}`} onClick={() => setStatusFilter(filter)}>{filter === "all" ? "All" : filter === "break_even" ? "Break-even" : filter === "won" ? "Wins" : "Losses"}</button>)}<button className="filter-btn refresh-btn" onClick={() => void fetchTrades()} disabled={loading}>{loading ? "Loading\u2026" : <><IconRefresh size={14} /> Refresh</>}</button></div>
    {error ? <div className="history-empty"><p>{error}</p></div> : loading && !trades.length ? <div className="history-empty"><p>Loading closed contracts from Deriv\u2026</p></div> : !filtered.length ? <div className="history-empty"><IconChartBar size={32} /><p>No completed trades on this page.</p></div> : <div className="history-table-wrap"><table className="history-table"><caption>Closed contracts</caption><colgroup><col className="history-col-date" /><col className="history-col-contract" /><col className="history-col-number" /><col className="history-col-number" /><col className="history-col-number" /><col className="history-col-status" /></colgroup><thead><tr><th scope="col">Closed at</th><th scope="col">Contract</th><th scope="col">Barrier</th><th scope="col">Buy price</th><th scope="col">P&amp;L</th><th scope="col">Result</th></tr></thead><tbody>{filtered.map((trade) => <tr key={trade.contract_id}><td className="td-date">{when(trade.sell_time ?? trade.purchase_time)}</td><td><strong>{formatContractType(trade.contract_type)}</strong><span className="history-symbol">{trade.symbol || "\u2014"}</span></td><td className="td-digit">{trade.barrier ?? "\u2014"}</td><td className="td-money">{fmt(trade.buy_price)}</td><td className={`td-money td-profit ${trade.profit >= 0 ? "positive" : "negative"}`}>{trade.profit >= 0 ? "+" : ""}{fmt(trade.profit)}</td><td><span className={`status-badge ${trade.profit > 0 ? "won" : trade.profit < 0 ? "lost" : "break_even"}`}>{statusLabel(trade.status, trade.profit)}</span></td></tr>)}</tbody></table></div>}
    <div className="history-pagination"><span>{total === null ? `Page ${page}` : `${Math.min((page - 1) * pageSize + 1, total)}\u2013${Math.min(page * pageSize, total)} of ${total}`}</span><div className="pagination-controls"><button className="pagination-btn" onClick={() => setPage((value) => value - 1)} disabled={page === 1 || loading}>Previous</button><select className="pagination-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} disabled={loading}><option value={20}>20 rows</option><option value={50}>50 rows</option><option value={100}>100 rows</option></select><button className="pagination-btn" onClick={() => setPage((value) => value + 1)} disabled={!hasMore || loading}>Next</button></div></div>
  </div>;
}
function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) { return <div className="summary-card"><span className="summary-label">{label}</span><strong className={`summary-value ${tone ?? ""}`}>{value}</strong></div>; }
function formatContractType(type: string) { return (({ DIGITOVER: "Over", DIGITUNDER: "Under", DIGITMATCH: "Match", DIGITDIFF: "Differs", DIGITEVEN: "Even", DIGITODD: "Odd" } as Record<string, string>)[type] ?? type) || "Digital option"; }
