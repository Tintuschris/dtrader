"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconRefresh, IconChartBar } from "@tabler/icons-react";
import { useTradeHistory } from "./use-deriv-data";

type DerivTrade = { contract_id: string; contract_type: string; symbol: string; buy_price: number; payout: number; profit: number; status: string; barrier?: string; purchase_time: number; sell_time?: number; account_type: "demo" | "real"; account_id: string };
type Props = {
  accountId: string;
  balanceCurrency: string;
};
type StatusFilter = "all" | "won" | "lost" | "break_even";

export default function TradingHistory({ accountId, balanceCurrency }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Use the same React Query hook as the portfolio dashboard
  const { data: tradeData, isLoading: loading, error: queryError, refetch } = useTradeHistory(accountId, 500);

  const allTrades: DerivTrade[] = useMemo(() => {
    const raw = tradeData?.trades ?? [];
    return raw.map((t) => ({
      contract_id: t.contract_id,
      contract_type: t.contract_type,
      symbol: t.symbol,
      buy_price: t.buy_price,
      payout: t.payout,
      profit: t.profit,
      status: t.profit > 0 ? "won" : t.profit < 0 ? "lost" : "break_even",
      barrier: t.barrier,
      purchase_time: t.purchase_time,
      sell_time: t.sell_time,
      account_type: (t as DerivTrade).account_type ?? (accountId.startsWith("VR") ? "demo" : "real"),
      account_id: accountId,
    }));
  }, [tradeData, accountId]);

  // Paginate from the full set
  const totalPages = Math.max(1, Math.ceil(allTrades.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedTrades = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return allTrades.slice(start, start + pageSize);
  }, [allTrades, safePage, pageSize]);

  const error = queryError?.message ?? null;
  const filtered = useMemo(() => statusFilter === "all" ? paginatedTrades : paginatedTrades.filter((trade) => trade.status === statusFilter), [paginatedTrades, statusFilter]);
  const stats = useMemo(() => { const wins = filtered.filter((trade) => trade.profit > 0).length; const losses = filtered.filter((trade) => trade.profit < 0).length; const pnl = filtered.reduce((sum, trade) => sum + trade.profit, 0); const stake = filtered.reduce((sum, trade) => sum + trade.buy_price, 0); return { wins, losses, pnl, stake, rate: filtered.length ? (wins / filtered.length) * 100 : 0 }; }, [filtered]);
  const fmt = (value: number) => value.toFixed(2); const when = (value: number) => value ? new Date(value * 1000).toLocaleString() : "\u2014"; const statusLabel = (status: string, profit: number) => status === "break_even" ? "Break-even" : profit > 0 ? "Won" : profit < 0 ? "Lost" : status || "Closed";
  return <div className="history-panel">
    <div className="history-context"><span className={`account-mini-badge ${allTrades[0]?.account_type ?? "demo"}`}>{allTrades[0]?.account_type === "real" ? "R" : "D"}</span><span>Closed contracts for <strong>{accountId || "the selected account"}</strong> \u00b7 {balanceCurrency}</span></div>
    <div className="history-summary"><Metric label="Page P&L" value={`${stats.pnl >= 0 ? "+" : ""}${fmt(stats.pnl)} ${balanceCurrency}`} tone={stats.pnl >= 0 ? "positive" : "negative"} /><Metric label="Win rate" value={`${stats.rate.toFixed(1)}%`} /><Metric label="Contracts" value={String(filtered.length)} /><Metric label="Stake" value={`${fmt(stats.stake)} ${balanceCurrency}`} /><Metric label="W / L" value={`${stats.wins} / ${stats.losses}`} /></div>
    <div className="history-filters">{(["all", "won", "lost", "break_even"] as StatusFilter[]).map((filter) => <button key={filter} className={`filter-btn ${statusFilter === filter ? "active" : ""}`} onClick={() => setStatusFilter(filter)}>{filter === "all" ? "All" : filter === "break_even" ? "Break-even" : filter === "won" ? "Wins" : "Losses"}</button>)}<button className="filter-btn refresh-btn" onClick={() => void refetch()} disabled={loading}>{loading ? "Loading\u2026" : <><IconRefresh size={14} /> Refresh</>}</button></div>
    {error ? <div className="history-empty"><p>{error}</p></div> : loading && !allTrades.length ? <div className="history-empty"><p>Loading closed contracts from Deriv\u2026</p></div> : !filtered.length ? <div className="history-empty"><IconChartBar size={32} /><p>No completed trades on this page.</p></div> : <div className="history-table-wrap"><table className="history-table"><caption>Closed contracts</caption><colgroup><col className="history-col-date" /><col className="history-col-contract" /><col className="history-col-number" /><col className="history-col-number" /><col className="history-col-number" /><col className="history-col-status" /></colgroup><thead><tr><th scope="col">Closed at</th><th scope="col">Contract</th><th scope="col">Barrier</th><th scope="col">Buy price</th><th scope="col">P&amp;L</th><th scope="col">Result</th></tr></thead><tbody>{filtered.map((trade) => <tr key={trade.contract_id}><td className="td-date">{when(trade.sell_time ?? trade.purchase_time)}</td><td><strong>{formatContractType(trade.contract_type)}</strong><span className="history-symbol">{trade.symbol || "\u2014"}</span></td><td className="td-digit">{trade.barrier ?? "\u2014"}</td><td className="td-money">{fmt(trade.buy_price)}</td><td className={`td-money td-profit ${trade.profit >= 0 ? "positive" : "negative"}`}>{trade.profit >= 0 ? "+" : ""}{fmt(trade.profit)}</td><td><span className={`status-badge ${trade.profit > 0 ? "won" : trade.profit < 0 ? "lost" : "break_even"}`}>{statusLabel(trade.status, trade.profit)}</span></td></tr>)}</tbody></table></div>}
    <div className="history-pagination"><span>{`Page ${safePage} of ${totalPages} \u00b7 ${allTrades.length} trades`}</span><div className="pagination-controls"><button className="pagination-btn" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={safePage <= 1 || loading}>Previous</button><select className="pagination-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} disabled={loading}><option value={20}>20 rows</option><option value={50}>50 rows</option><option value={100}>100 rows</option></select><button className="pagination-btn" onClick={() => setPage((v) => Math.min(totalPages, v + 1))} disabled={safePage >= totalPages || loading}>Next</button></div></div>
  </div>;
}
function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) { return <div className="summary-card"><span className="summary-label">{label}</span><strong className={`summary-value ${tone ?? ""}`}>{value}</strong></div>; }
function formatContractType(type: string) { return (({ DIGITOVER: "Over", DIGITUNDER: "Under", DIGITMATCH: "Match", DIGITDIFF: "Differs", DIGITEVEN: "Even", DIGITODD: "Odd" } as Record<string, string>)[type] ?? type) || "Digital option"; }
