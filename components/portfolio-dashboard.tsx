"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePortfolio, useTradeHistory } from "./use-deriv-data";
import type { DerivContract } from "./use-deriv-data";
import { formatContractType } from "../lib/format-utils";
import {
  IconTrendingUp,
  IconTrendingDown,
  IconChartBar,
  IconTarget,
  IconClock,
  IconCurrencyDollar,
  IconActivity,
  IconArrowUpRight,
  IconArrowDownRight,
  IconRefresh,
  IconChartPie,
} from "@tabler/icons-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Trade = {
  id: string;
  contract_type: string;
  buy_price: number;
  payout: number;
  profit: number;
  status: string;
  symbol?: string;
  digit_prediction?: number;
  timestamp?: number;
};

type PortfolioProps = {
  accountId: string;
  balance: number | null;
  balanceCurrency: string;
  fetchPositions?: () => Promise<{ positions: unknown[] } | null>;
  fetchTrades?: (opts?: { limit?: number; offset?: number }) => Promise<{ transactions: unknown[]; count: number } | null>;
};

type TimeRange = "all" | "today" | "week" | "month";

/* ------------------------------------------------------------------ */
/*  Skeleton Components                                                */
/* ------------------------------------------------------------------ */

function MetricSkeleton() {
  return (
    <div className="portfolio-metrics">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="metric-card" style={{ opacity: 0.6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,.06)" }} />
          <div className="metric-body">
            <div style={{ width: 60, height: 10, borderRadius: 4, background: "rgba(255,255,255,.06)", marginBottom: 6 }} />
            <div style={{ width: 80, height: 20, borderRadius: 4, background: "rgba(255,255,255,.08)", marginBottom: 4 }} />
            <div style={{ width: 50, height: 10, borderRadius: 4, background: "rgba(255,255,255,.04)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="portfolio-charts">
      <div className="chart-card">
        <div className="chart-card-header">
          <div style={{ width: 120, height: 16, borderRadius: 4, background: "rgba(255,255,255,.06)" }} />
        </div>
        <div style={{ height: 200, borderRadius: 8, background: "rgba(255,255,255,.03)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "80%", height: 2, borderRadius: 2, background: "rgba(70,211,189,.12)" }} />
        </div>
      </div>
      <div className="chart-card">
        <div className="chart-card-header">
          <div style={{ width: 140, height: 16, borderRadius: 4, background: "rgba(255,255,255,.06)" }} />
        </div>
        <div style={{ height: 200, borderRadius: 8, background: "rgba(255,255,255,.03)" }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PortfolioDashboard({ accountId, balance, balanceCurrency, fetchPositions, fetchTrades }: PortfolioProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const queryClient = useQueryClient();

  // React Query hooks — use client-side WS fetch when available
  const { data: openPositions = [], isLoading: positionsLoading, error: positionsError } = usePortfolio(accountId, fetchPositions);
  const { data: tradeData, isLoading: tradesLoading, error: tradesError } = useTradeHistory(accountId, 500, fetchTrades);

  const closedTrades = tradeData?.trades ?? [];
  const loading = positionsLoading || tradesLoading;
  const error = positionsError?.message ?? tradesError?.message ?? null;

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["deriv", "portfolio", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["deriv", "trades", accountId] });
  };

  const normalizedTrades: Trade[] = useMemo(() => closedTrades.map((trade) => ({
    id: trade.contract_id,
    contract_type: trade.contract_type,
    buy_price: trade.buy_price,
    payout: trade.payout,
    profit: trade.profit,
    status: trade.profit > 0 ? "won" : trade.profit < 0 ? "lost" : "break_even",
    symbol: trade.symbol,
    digit_prediction: trade.barrier === undefined ? undefined : Number(trade.barrier),
    timestamp: trade.purchase_time * 1000,
  })), [closedTrades]);

  const completedTrades = useMemo(() => {
    const now = Date.now();
    return normalizedTrades
      .filter((t) => t.status === "won" || t.status === "lost")
      .filter((t) => {
        if (!t.timestamp) return true;
        if (timeRange === "all") return true;
        if (timeRange === "today") return now - t.timestamp < 86_400_000;
        if (timeRange === "week") return now - t.timestamp < 604_800_000;
        if (timeRange === "month") return now - t.timestamp < 2_592_000_000;
        return true;
      });
  }, [normalizedTrades, timeRange]);

  const stats = useMemo(() => {
    if (completedTrades.length === 0) {
      return {
        totalTrades: 0, wins: 0, losses: 0,
        winRate: 0, totalPnL: 0, avgProfit: 0,
        biggestWin: 0, biggestLoss: 0, totalStaked: 0,
        totalPayout: 0, roi: 0, profitFactor: 0,
        avgWin: 0, avgLoss: 0, expectancy: 0,
        streak: 0, bestStreak: 0, worstStreak: 0,
      };
    }
    const wins = completedTrades.filter((t) => t.status === "won");
    const losses = completedTrades.filter((t) => t.status === "lost");
    const totalPnL = completedTrades.reduce((s, t) => s + t.profit, 0);
    const totalStaked = completedTrades.reduce((s, t) => s + t.buy_price, 0);
    const totalPayout = wins.reduce((s, t) => s + t.payout, 0);
    const grossWins = wins.reduce((s, t) => s + t.profit, 0);
    const grossLosses = Math.abs(losses.reduce((s, t) => s + t.profit, 0));

    let currentStreak = 0, bestStreak = 0, worstStreak = 0;
    let streakType: "won" | "lost" | null = null;
    for (const t of completedTrades) {
      if (t.status === streakType) {
        currentStreak++;
      } else {
        if (streakType === "won") bestStreak = Math.max(bestStreak, currentStreak);
        if (streakType === "lost") worstStreak = Math.max(worstStreak, currentStreak);
        currentStreak = 1;
        streakType = t.status as "won" | "lost";
      }
    }
    if (streakType === "won") bestStreak = Math.max(bestStreak, currentStreak);
    if (streakType === "lost") worstStreak = Math.max(worstStreak, currentStreak);

    return {
      totalTrades: completedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / completedTrades.length) * 100,
      totalPnL,
      avgProfit: totalPnL / completedTrades.length,
      biggestWin: Math.max(0, ...wins.map((t) => t.profit)),
      biggestLoss: Math.min(0, ...losses.map((t) => t.profit)),
      totalStaked,
      totalPayout,
      roi: totalStaked > 0 ? (totalPnL / totalStaked) * 100 : 0,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      avgWin: wins.length > 0 ? grossWins / wins.length : 0,
      avgLoss: losses.length > 0 ? grossLosses / losses.length : 0,
      expectancy: completedTrades.length > 0 ? totalPnL / completedTrades.length : 0,
      streak: currentStreak,
      bestStreak,
      worstStreak,
    };
  }, [completedTrades]);

  const contractDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of completedTrades) {
      const label = formatContractType(t.contract_type);
      counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count, pct: (count / completedTrades.length) * 100 }));
  }, [completedTrades]);

  const pnlCurve = useMemo(() => {
    let cum = 0;
    return completedTrades.map((t) => { cum += t.profit; return cum; });
  }, [completedTrades]);

  const digitDist = useMemo(() => {
    const counts = new Array(10).fill(0) as number[];
    for (const t of completedTrades) {
      if (t.digit_prediction != null) counts[t.digit_prediction]++;
    }
    const max = Math.max(...counts, 1);
    return counts.map((c, d) => ({ digit: d, count: c, height: (c / max) * 100 }));
  }, [completedTrades]);

  const typeWinRates = useMemo(() => {
    const groups: Record<string, { wins: number; total: number }> = {};
    for (const t of completedTrades) {
      const label = formatContractType(t.contract_type);
      if (!groups[label]) groups[label] = { wins: 0, total: 0 };
      groups[label].total++;
      if (t.status === "won") groups[label].wins++;
    }
    return Object.entries(groups).map(([type, g]) => ({
      type, winRate: g.total > 0 ? (g.wins / g.total) * 100 : 0, total: g.total,
    }));
  }, [completedTrades]);

  const hourlyPerf = useMemo(() => {
    const hours = new Array(24).fill(0) as number[];
    for (const t of completedTrades) {
      if (t.timestamp) {
        const h = new Date(t.timestamp).getHours();
        hours[h] += t.profit;
      }
    }
    return hours.map((pnl, h) => ({ hour: h, pnl }));
  }, [completedTrades]);

  const maxPnl = Math.max(...pnlCurve.map(Math.abs), 1);
  const maxHourlyPnl = Math.max(...hourlyPerf.map((h) => Math.abs(h.pnl)), 1);

  // No account selected — show connect prompt
  if (!accountId) {
    return (
      <div className="portfolio-dashboard">
        <div className="portfolio-header">
          <div>
            <p className="eyebrow">PORTFOLIO</p>
            <h1>Performance Dashboard</h1>
          </div>
        </div>
        <div className="portfolio-empty" style={{ textAlign: "center", padding: "60px 20px" }}>
          <IconChartPie size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h2 style={{ marginBottom: 8 }}>No account selected</h2>
          <p className="muted">Connect a Deriv account to view your portfolio, open positions, and trade history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="portfolio-dashboard">
      {/* ===== HEADER ===== */}
      <div className="portfolio-header">
        <div>
          <p className="eyebrow">PORTFOLIO</p>
          <h1>Performance Dashboard</h1>
          <p className="muted">Analytics from your latest 500 completed contracts; open positions are shown separately.</p>
        </div>
        <div className="time-range-tabs">
          {(["all", "today", "week", "month"] as TimeRange[]).map((r) => (
            <button key={r} className={`time-range-tab ${timeRange === r ? "active" : ""}`} onClick={() => setTimeRange(r)}>
              {r === "all" ? "All Time" : r === "today" ? "Today" : r === "week" ? "7 Days" : "30 Days"}
            </button>
          ))}
        </div>
      </div>

      <div className="portfolio-live-summary">
        <div><span className="summary-label">Selected account</span><strong>{accountId || "—"}</strong></div>
        <div><span className="summary-label">Available balance</span><strong>{balance === null ? "—" : `${balance.toFixed(2)} ${balanceCurrency}`}</strong></div>
        <div><span className="summary-label">Open positions</span><strong>{openPositions.length}</strong></div>
        <button className="filter-btn refresh-btn" onClick={handleRefresh} disabled={loading}>
          <IconRefresh size={14} className={loading ? "spin" : ""} /> {loading ? "Refreshing…" : "Refresh data"}
        </button>
      </div>

      {error && <div className="portfolio-empty"><p>{error}</p></div>}

      {!error && openPositions.length > 0 && (
        <div className="open-positions">
          <h2>Open positions</h2>
          {openPositions.map((position) => (
            <div className="open-position" key={position.contract_id}>
              <span>{formatContractType(position.contract_type)} · {position.symbol}</span>
              <span>Stake {position.buy_price.toFixed(2)} {balanceCurrency}</span>
              <strong className={position.profit >= 0 ? "positive" : "negative"}>
                {position.profit >= 0 ? "+" : ""}{position.profit.toFixed(2)}
              </strong>
            </div>
          ))}
        </div>
      )}

      {loading && completedTrades.length === 0 ? (
        <>
          <MetricSkeleton />
          <ChartSkeleton />
        </>
      ) : !error && completedTrades.length === 0 ? (
        <div className="portfolio-empty">
          <IconChartBar size={48} />
          <h2>No trades yet</h2>
          <p>Place your first trade to see performance analytics here.</p>
        </div>
      ) : (
        <>
          {/* ===== KEY METRICS ===== */}
          <div className="portfolio-metrics">
            <div className={`metric-card ${stats.totalPnL >= 0 ? "positive" : "negative"}`}>
              <div className="metric-icon"><IconCurrencyDollar size={20} /></div>
              <div className="metric-body">
                <span className="metric-label">Total P&L</span>
                <strong className="metric-value">{stats.totalPnL >= 0 ? "+" : ""}${stats.totalPnL.toFixed(2)}</strong>
                <span className="metric-sub">{stats.roi >= 0 ? "+" : ""}{stats.roi.toFixed(1)}% ROI</span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon"><IconTarget size={20} /></div>
              <div className="metric-body">
                <span className="metric-label">Win Rate</span>
                <strong className="metric-value">{stats.winRate.toFixed(1)}%</strong>
                <span className="metric-sub">{stats.wins}W / {stats.losses}L of {stats.totalTrades}</span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon"><IconActivity size={20} /></div>
              <div className="metric-body">
                <span className="metric-label">Profit Factor</span>
                <strong className="metric-value">{stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}</strong>
                <span className="metric-sub">Avg: ${stats.avgProfit.toFixed(2)}/trade</span>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon"><IconClock size={20} /></div>
              <div className="metric-body">
                <span className="metric-label">Streak</span>
                <strong className="metric-value">{stats.streak}</strong>
                <span className="metric-sub">Best: {stats.bestStreak}W / {stats.worstStreak}L</span>
              </div>
            </div>
          </div>

          {/* ===== SECONDARY METRICS ===== */}
          <div className="portfolio-secondary-metrics">
            <div className="secondary-metric">
              <span className="secondary-label">Total Staked</span>
              <strong>${stats.totalStaked.toFixed(2)}</strong>
            </div>
            <div className="secondary-metric">
              <span className="secondary-label">Total Payout</span>
              <strong>${stats.totalPayout.toFixed(2)}</strong>
            </div>
            <div className="secondary-metric positive-color">
              <span className="secondary-label">Avg Win</span>
              <strong>+${stats.avgWin.toFixed(2)}</strong>
            </div>
            <div className="secondary-metric negative-color">
              <span className="secondary-label">Avg Loss</span>
              <strong>-${stats.avgLoss.toFixed(2)}</strong>
            </div>
            <div className={`secondary-metric ${stats.expectancy >= 0 ? "positive-color" : "negative-color"}`}>
              <span className="secondary-label">Expectancy</span>
              <strong>{stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}</strong>
            </div>
            <div className="secondary-metric positive-color">
              <span className="secondary-label">Biggest Win</span>
              <strong>+${stats.biggestWin.toFixed(2)}</strong>
            </div>
            <div className="secondary-metric negative-color">
              <span className="secondary-label">Biggest Loss</span>
              <strong>-${Math.abs(stats.biggestLoss).toFixed(2)}</strong>
            </div>
          </div>

          {/* ===== CHARTS ROW ===== */}
          <div className="portfolio-charts">
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>Cumulative P&L</h3>
                <span className="chart-card-badge">Over {stats.totalTrades} trades</span>
              </div>
              <div className="pnl-chart">
                <svg viewBox={`0 0 ${Math.max(pnlCurve.length * 20, 100)} 200`} preserveAspectRatio="none">
                  <line x1="0" y1="100" x2={Math.max(pnlCurve.length * 20, 100)} y2="100" stroke="rgba(157,179,203,.2)" strokeDasharray="4 4" />
                  <path
                    d={`M 0 100 ${pnlCurve.map((v, i) => `L ${i * 20 + 10} ${100 - (v / maxPnl) * 80}`).join(" ")} L ${pnlCurve.length * 20} 100 Z`}
                    fill={stats.totalPnL >= 0 ? "rgba(70,211,189,.15)" : "rgba(240,80,80,.15)"}
                  />
                  <polyline
                    points={pnlCurve.map((v, i) => `${i * 20 + 10},${100 - (v / maxPnl) * 80}`).join(" ")}
                    fill="none"
                    stroke={stats.totalPnL >= 0 ? "#46d3bd" : "#f08080"}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  {pnlCurve.length > 0 && (
                    <circle
                      cx={(pnlCurve.length - 1) * 20 + 10}
                      cy={100 - (pnlCurve[pnlCurve.length - 1] / maxPnl) * 80}
                      r="4"
                      fill={stats.totalPnL >= 0 ? "#46d3bd" : "#f08080"}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                  )}
                </svg>
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-card-header">
                <h3>Contract Distribution</h3>
              </div>
              <div className="contract-dist">
                {contractDist.map((d) => (
                  <div key={d.type} className="contract-dist-row">
                    <span className="dist-label">{d.type}</span>
                    <div className="dist-bar-wrap">
                      <div className="dist-bar" style={{ width: `${d.pct}%` }} />
                    </div>
                    <span className="dist-count">{d.count} ({d.pct.toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ===== SECOND ROW ===== */}
          <div className="portfolio-charts">
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>Win Rate by Contract</h3>
              </div>
              <div className="type-winrates">
                {typeWinRates.map((tw) => (
                  <div key={tw.type} className="type-wr-row">
                    <span className="twr-label">{tw.type}</span>
                    <div className="twr-bar-wrap">
                      <div
                        className={`twr-bar ${tw.winRate >= 50 ? "positive" : "negative"}`}
                        style={{ width: `${tw.winRate}%` }}
                      />
                    </div>
                    <span className={`twr-value ${tw.winRate >= 50 ? "positive" : "negative"}`}>
                      {tw.winRate.toFixed(1)}%
                    </span>
                    <span className="twr-count">{tw.total}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-card-header">
                <h3>Digit Predictions</h3>
              </div>
              <div className="digit-dist-chart">
                {digitDist.map((d) => (
                  <div key={d.digit} className="digit-col">
                    <div className="digit-col-bar-wrap">
                      <div className={`digit-col-bar ${d.count > 0 ? "" : "empty"}`} style={{ height: `${d.height}%` }} />
                    </div>
                    <span className="digit-col-label">{d.digit}</span>
                    <span className="digit-col-count">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ===== HOURLY PERFORMANCE ===== */}
          <div className="chart-card full-width">
            <div className="chart-card-header">
              <h3>P&L by Hour of Day</h3>
              <span className="chart-card-badge">When you trade best</span>
            </div>
            <div className="hourly-chart">
              <div className="hourly-zero-line" />
              {hourlyPerf.map((h) => (
                <div key={h.hour} className="hourly-col">
                  <div className="hourly-bars">
                    {h.pnl !== 0 && (
                      <div
                        className={`hourly-bar ${h.pnl >= 0 ? "positive" : "negative"}`}
                        style={{
                          height: `${(Math.abs(h.pnl) / maxHourlyPnl) * 80}%`,
                          [h.pnl >= 0 ? "bottom" : "top"]: "50%",
                        }}
                      />
                    )}
                  </div>
                  <span className="hourly-label">{h.hour}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ===== RECENT TRADES ===== */}
          <div className="chart-card full-width">
            <div className="chart-card-header">
              <h3>Recent Trades</h3>
              <span className="chart-card-badge">{completedTrades.length} total</span>
            </div>
            <div className="recent-trades-table">
              <div className="rt-header">
                <span>Type</span>
                <span>Digit</span>
                <span>Stake</span>
                <span>Payout</span>
                <span>P&L</span>
                <span>Status</span>
              </div>
              {completedTrades.slice(0, 20).map((t) => (
                <div key={t.id} className={`rt-row ${t.status}`}>
                  <span className="rt-type">{formatContractType(t.contract_type)}</span>
                  <span className="rt-digit">{t.digit_prediction ?? "—"}</span>
                  <span className="rt-stake">${Number((t as Record<string, unknown>).stake ?? t.buy_price).toFixed(2)}</span>
                  <span className="rt-payout">${t.payout.toFixed(2)}</span>
                  <span className={`rt-pnl ${t.profit >= 0 ? "positive" : "negative"}`}>
                    {t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)}
                  </span>
                  <span className={`rt-status ${t.status}`}>
                    {t.status === "won" ? <><IconArrowUpRight size={12} /> WIN</> : <><IconArrowDownRight size={12} /> LOSS</>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


