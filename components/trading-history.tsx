"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconRefresh, IconChartBar } from "@tabler/icons-react";
import type { TradeRecord } from "./use-deriv-ws";

type DerivTrade = {
  contract_id: string;
  contract_type: string;
  symbol: string;
  buy_price: number;
  payout: number;
  profit: number;
  status: string;
  barrier?: string;
  tick_count?: number;
  entry_tick?: number;
  exit_tick?: number;
  purchase_time: number;
  sell_time?: number;
  is_sold: boolean;
  account_type: "demo" | "real";
  account_id: string;
};

type Props = {
  trades: TradeRecord[];
  balance: number | null;
  balanceCurrency: string;
};

type StatusFilter = "all" | "won" | "lost";
type AccountFilter = "all" | "demo" | "real";

export default function TradingHistory({ trades, balance, balanceCurrency }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [derivTrades, setDerivTrades] = useState<DerivTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ currentPage: 1, pageSize: 20, total: 0 });

  // Fetch trades from Deriv API
  const fetchTrades = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const offset = (pagination.currentPage - 1) * pagination.pageSize;
      const res = await fetch(`/api/deriv/trades?limit=${pagination.pageSize}&offset=${offset}`, { cache: "no-store" });
      const data = await res.json();
      if (data.trades?.length) {
        setDerivTrades(data.trades);
        setPagination(prev => ({ ...prev, total: data.total || data.trades.length }));
      } else if (data.error) {
        setFetchError(data.error);
      }
    } catch {
      setFetchError("Failed to load trade history");
    } finally {
      setLoading(false);
    }
  }, [pagination.currentPage, pagination.pageSize]);

  useEffect(() => {
    void fetchTrades();
  }, [fetchTrades]);

  // Merge local trades (from current session) with Deriv trades
  const allTrades = useMemo(() => {
    // Convert local TradeRecord to DerivTrade format
    const localAsDeriv: DerivTrade[] = trades.map((t) => ({
      contract_id: t.id,
      contract_type: t.contract_type,
      symbol: t.symbol,
      buy_price: t.stake,
      payout: t.payout,
      profit: t.profit,
      status: t.status,
      barrier: String(t.digit_prediction),
      tick_count: t.duration_ticks,
      purchase_time: t.timestamp,
      is_sold: t.status === "sold",
      account_type: "demo" as const,
      account_id: "local",
    }));

    // Merge: Deriv trades + local trades (dedupe by contract_id)
    const ids = new Set(derivTrades.map((t) => t.contract_id));
    const merged = [...derivTrades];
    for (const local of localAsDeriv) {
      if (!ids.has(local.contract_id)) {
        merged.push(local);
      }
    }

    // Sort by purchase_time descending
    return merged.sort((a, b) => b.purchase_time - a.purchase_time);
  }, [trades, derivTrades]);

  // Apply filters
  const filtered = useMemo(() => {
    return allTrades.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (accountFilter !== "all" && t.account_type !== accountFilter) return false;
      return true;
    });
  }, [allTrades, statusFilter, accountFilter]);

  // Pagination helpers
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);
  const goToPage = (page: number) => {
    setPagination(prev => ({ ...prev, currentPage: page }));
  };
  const changePageSize = (size: number) => {
    setPagination(prev => ({ ...prev, pageSize: size, currentPage: 1 }));
  };

  // Stats (for filtered set)
  const stats = useMemo(() => {
    const totalProfit = filtered.reduce((sum, t) => sum + t.profit, 0);
    const winCount = filtered.filter((t) => t.status === "won").length;
    const lossCount = filtered.filter((t) => t.status === "lost").length;
    const winRate = filtered.length > 0 ? ((winCount / filtered.length) * 100).toFixed(1) : "0.0";
    const totalStake = filtered.reduce((sum, t) => sum + t.buy_price, 0);
    const totalPayout = filtered.reduce((sum, t) => sum + t.payout, 0);
    return { totalProfit, winCount, lossCount, winRate, totalStake, totalPayout };
  }, [filtered]);

  const fmt = (n: number) => Number(n).toFixed(2);
  const fmtTime = (ts: number) => {
    if (!ts) return "—";
    // Handle both milliseconds (Date.now()) and seconds (Deriv API)
    const d = ts > 1e11 ? new Date(ts) : new Date(ts * 1000);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const fmtDate = (ts: number) => {
    if (!ts) return "";
    const d = ts > 1e11 ? new Date(ts) : new Date(ts * 1000);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const fmtFull = (ts: number) => {
    if (!ts) return "";
    const d = ts > 1e11 ? new Date(ts) : new Date(ts * 1000);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString();
  };

  return (
    <div className="history-panel">
      {/* Account filter tabs */}
      <div className="history-account-tabs">
        {(["all", "demo", "real"] as AccountFilter[]).map((f) => (
          <button
            key={f}
            className={`account-tab ${accountFilter === f ? "active" : ""}`}
            onClick={() => setAccountFilter(f)}
          >
            {f === "all" ? "All Accounts" : f === "demo" ? "Demo" : "Real"}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="history-summary">
        <div className="summary-card">
          <span className="summary-label">Total P&L</span>
          <strong className={`summary-value ${stats.totalProfit >= 0 ? "positive" : "negative"}`}>
            {stats.totalProfit >= 0 ? "+" : ""}${fmt(stats.totalProfit)}
          </strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Win Rate</span>
          <strong className="summary-value">{stats.winRate}%</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Trades</span>
          <strong className="summary-value">{filtered.length}</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total Stake</span>
          <strong className="summary-value">${fmt(stats.totalStake)}</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total Payout</span>
          <strong className="summary-value">${fmt(stats.totalPayout)}</strong>
        </div>
        <div className="summary-card">
          <span className="summary-label">W / L</span>
          <strong className="summary-value">
            <span className="win-count">{stats.winCount}</span> / <span className="loss-count">{stats.lossCount}</span>
          </strong>
        </div>
      </div>

      {/* Status filters */}
      <div className="history-filters">
        {(["all", "won", "lost"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            className={`filter-btn ${statusFilter === f ? "active" : ""}`}
            onClick={() => setStatusFilter(f)}
          >
            {f === "all" ? "All Trades" : f === "won" ? "Wins" : "Losses"}
            <span className="filter-count">
              {f === "all" ? filtered.length : f === "won" ? stats.winCount : stats.lossCount}
            </span>
          </button>
        ))}
        <button className="filter-btn refresh-btn" onClick={() => void fetchTrades()} disabled={loading}>
          {loading ? "Loading…" : <><IconRefresh size={14} /> Refresh</>}
        </button>
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="history-pagination">
          <div className="pagination-info">
            Page {pagination.currentPage} of {totalPages} ({pagination.total} total trades)
          </div>
          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => goToPage(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1 || loading}
            >
              Previous
            </button>
            <select
              className="pagination-size"
              value={pagination.pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
              disabled={loading}
            >
              <option value={10}>10 per page</option>
              <option value={20}>20 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
            <button
              className="pagination-btn"
              onClick={() => goToPage(pagination.currentPage + 1)}
              disabled={pagination.currentPage === totalPages || loading}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Trade table */}
      {loading && filtered.length === 0 ? (
        <div className="history-empty">
          <div className="history-empty-icon">⏳</div>
          <p>Loading trade history from Deriv…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="history-empty">
          <div className="history-empty-icon"><IconChartBar size={32} /></div>
          <p>No trades yet</p>
          <p className="muted">
            {fetchError
              ? `${fetchError} — showing local trades only`
              : "Your trade history will appear here after you place your first trade."}
          </p>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Contract</th>
                <th>Digit</th>
                <th>Stake</th>
                <th>Payout</th>
                <th>P&amp;L</th>
                <th>Account</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.contract_id} className={`trade-row ${t.status}`} title={fmtFull(t.purchase_time) + (t.symbol ? " - " + t.symbol : "")}>
                  <td className="td-date">
                    <div>{fmtDate(t.purchase_time)}</div>
                    <div className="td-time">{fmtTime(t.purchase_time)}</div>
                  </td>
                  <td>{formatContractType(t.contract_type)}</td>
                  <td className="td-digit">{t.barrier ? `#${t.barrier}` : "—"}</td>
                  <td>${fmt(t.buy_price)}</td>
                  <td>${fmt(t.payout)}</td>
                  <td className={`td-profit ${t.profit >= 0 ? "positive" : "negative"}`}>
                    {t.profit >= 0 ? "+" : ""}${fmt(t.profit)}
                  </td>
                  <td>
                    <span className={`account-mini-badge ${t.account_type}`}>
                      {t.account_type === "demo" ? "D" : "R"}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${t.status}`}>
                      {t.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatContractType(type: string): string {
  const map: Record<string, string> = {
    DIGITOVER: "Over",
    DIGITUNDER: "Under",
    DIGITMATCH: "Match",
    DIGITDIFF: "Differs",
    DIGITEVEN: "Even",
    DIGITODD: "Odd",
  };
  return map[type] ?? type;
}
