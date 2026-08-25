"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconPlayerPlay, IconPlayerPause, IconPlayerStop, IconPlayerTrackNext,
  IconChartLine, IconTable, IconSettings, IconDownload, IconCheck,
} from "@tabler/icons-react";
import {
  fetchHistoricalTicks,
  createBacktestAdapter,
  type BacktestTick,
  type BacktestConfig,
  type BacktestTrade,
  type BacktestStats,
} from "../lib/backtest-engine";
import { BotSandbox, type BotStatus, type BotLogEntry } from "../lib/bot-sandbox";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Props = {
  visualCode: string;
  onBack: () => void;
};

type View = "setup" | "running" | "results";

/* ------------------------------------------------------------------ */
/*  Tick Chart Component                                                */
/* ------------------------------------------------------------------ */

function TickChart({
  ticks,
  currentIndex,
  trades,
  height = 180,
}: {
  ticks: BacktestTick[];
  currentIndex: number;
  trades: BacktestTrade[];
  height?: number;
}) {
  if (ticks.length === 0) return null;

  const visibleStart = Math.max(0, currentIndex - 200);
  const visibleEnd = Math.min(ticks.length, currentIndex + 50);
  const visibleTicks = ticks.slice(visibleStart, visibleEnd);

  if (visibleTicks.length === 0) return null;

  const prices = visibleTicks.map((t) => t.quote);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const padding = 10;
  const w = 600;
  const h = height;

  // Map ticks to SVG coordinates
  const points = visibleTicks.map((t, i) => ({
    x: padding + (i / (visibleTicks.length - 1 || 1)) * (w - 2 * padding),
    y: padding + ((maxPrice - t.quote) / priceRange) * (h - 2 * padding),
    tick: t,
    globalIndex: visibleStart + i,
  }));

  // Create path
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // Map trade markers
  const tradeMarkers = trades
    .filter((t) => {
      const idx = visibleTicks.findIndex((vt) => vt.epoch === t.timestamp);
      return idx >= 0;
    })
    .map((t) => {
      const idx = visibleTicks.findIndex((vt) => vt.epoch === t.timestamp);
      const p = points[idx];
      return p
        ? {
            x: p.x,
            y: p.y,
            won: t.status === "won",
            profit: t.profit,
          }
        : null;
    })
    .filter(Boolean) as { x: number; y: number; won: boolean; profit: number }[];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {/* Background grid */}
      {[0.25, 0.5, 0.75].map((frac) => (
        <line
          key={frac}
          x1={padding}
          y1={padding + frac * (h - 2 * padding)}
          x2={w - padding}
          y2={padding + frac * (h - 2 * padding)}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
        />
      ))}

      {/* Price line */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--teal, #37d4bd)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Current position indicator */}
      {points.length > 0 && (
        <>
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill="var(--teal, #37d4bd)"
          />
          <text
            x={w - padding + 4}
            y={points[points.length - 1].y + 4}
            fill="var(--muted, #718197)"
            fontSize="9"
          >
            {points[points.length - 1].tick.quote.toFixed(2)}
          </text>
        </>
      )}

      {/* Trade markers */}
      {tradeMarkers.map((m, i) => (
        <g key={i}>
          <circle
            cx={m.x}
            cy={m.y}
            r="5"
            fill={m.won ? "var(--teal, #37d4bd)" : "#e05555"}
            opacity="0.8"
          />
          <text
            x={m.x}
            y={m.y - 8}
            fill={m.won ? "var(--teal, #37d4bd)" : "#e05555"}
            fontSize="8"
            textAnchor="middle"
          >
            {m.profit >= 0 ? "+" : ""}{m.profit.toFixed(2)}
          </text>
        </g>
      ))}

      {/* Price labels */}
      <text x={padding} y={h - 2} fill="var(--muted, #718197)" fontSize="8">
        {minPrice.toFixed(2)}
      </text>
      <text x={padding} y={10} fill="var(--muted, #718197)" fontSize="8">
        {maxPrice.toFixed(2)}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Balance Curve Component                                             */
/* ------------------------------------------------------------------ */

function BalanceCurve({ curve, height = 100 }: { curve: number[]; height?: number }) {
  if (curve.length < 2) return null;

  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const range = max - min || 1;
  const w = 600;
  const h = height;
  const padding = 10;

  const points = curve.map((v, i) => ({
    x: padding + (i / (curve.length - 1)) * (w - 2 * padding),
    y: padding + ((max - v) / range) * (h - 2 * padding),
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const fillD = pathD + ` L ${points[points.length - 1].x} ${h - padding} L ${points[0].x} ${h - padding} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--teal, #37d4bd)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--teal, #37d4bd)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#balanceGrad)" />
      <path d={pathD} fill="none" stroke="var(--teal, #37d4bd)" strokeWidth="1.5" />
      <text x={padding} y={10} fill="var(--muted, #718197)" fontSize="8">
        ${max.toFixed(0)}
      </text>
      <text x={padding} y={h - 2} fill="var(--muted, #718197)" fontSize="8">
        ${min.toFixed(0)}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function BacktestRunner({ visualCode, onBack }: Props) {
  const [view, setView] = useState<View>("setup");
  const [status, setStatus] = useState<BotStatus>("idle");
  const [logs, setLogs] = useState<BotLogEntry[]>([]);

  // Config
  const [symbol, setSymbol] = useState("1HZ100V");
  const [contractType, setContractType] = useState("DIGITOVER");
  const [durationTicks, setDurationTicks] = useState(5);
  const [stake, setStake] = useState(1);
  const [barrier, setBarrier] = useState(4);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [speed, setSpeed] = useState(5);
  const [tickCount, setTickCount] = useState(2000);

  // Backtest state
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [currentTick, setCurrentTick] = useState<BacktestTick | null>(null);
  const [tickIndex, setTickIndex] = useState(0);
  const [stats, setStats] = useState<BacktestStats | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [balance, setBalance] = useState(initialBalance);
  const [showTrades, setShowTrades] = useState(false);

  const engineRef = useRef<ReturnType<typeof createBacktestAdapter> | null>(null);
  const sandboxRef = useRef<BotSandbox | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current);
      sandboxRef.current?.stop();
    };
  }, []);

  /* ---- Fetch ticks and start backtest ---- */
  const handleStartBacktest = useCallback(async () => {
    setLoading(true);
    setLoadProgress(0);
    setLogs([]);

    try {
      // Fetch historical ticks
      setLoadProgress(10);
      const ticks = await fetchHistoricalTicks(symbol, tickCount);
      setLoadProgress(80);

      if (ticks.length === 0) {
        setLogs([{ timestamp: Date.now(), level: "error", message: "No historical ticks available for this symbol" }]);
        setLoading(false);
        return;
      }

      setLogs([{ timestamp: Date.now(), level: "info", message: `Loaded ${ticks.length} historical ticks for ${symbol}` }]);

      // Create backtest adapter
      const config: BacktestConfig = {
        symbol,
        contractType,
        durationTicks,
        stake,
        barrier,
        initialBalance,
        speed,
      };

      const engine = createBacktestAdapter(ticks, config, (tick, idx) => {
        setCurrentTick(tick);
        setTickIndex(idx);
        setBalance(engineRef.current?.adapter.getBalance() ?? initialBalance);
        setTrades([...engineRef.current!.getTrades()]);
        setStats(engineRef.current!.getStats());
      });

      engineRef.current = engine;
      setCurrentTick(ticks[0]);
      setBalance(initialBalance);
      setTickIndex(0);
      setLoadProgress(100);

      // Create sandbox with backtest adapter
      const sandbox = new BotSandbox(engine.adapter, {
        onStatusChange: (s) => setStatus(s),
        onLog: (entry) => setLogs((prev) => [...prev.slice(-500), entry]),
        onBalanceUpdate: (bal) => setBalance(bal),
      });
      sandboxRef.current = sandbox;

      // Start the bot
      setView("running");
      setStatus("running");

      // Run bot code in background
      sandbox.run(visualCode).catch((err) => {
        console.error("Backtest error:", err);
      });

      // Start tick replay
      startTickReplay(speed);

      setLoading(false);
    } catch (err) {
      setLogs([{ timestamp: Date.now(), level: "error", message: `Failed to start backtest: ${err}` }]);
      setLoading(false);
    }
  }, [visualCode, symbol, contractType, durationTicks, stake, barrier, initialBalance, speed, tickCount]);

  /* ---- Tick replay loop ---- */
  const startTickReplay = useCallback(
    (replaySpeed: number) => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current);

      // Base interval: 200ms per tick at 1x speed
      const interval = Math.max(10, 200 / replaySpeed);

      replayTimerRef.current = setInterval(() => {
        const engine = engineRef.current;
        if (!engine) return;

        const hasMore = engine.advanceTick();
        if (!hasMore) {
          // End of data
          clearInterval(replayTimerRef.current!);
          replayTimerRef.current = null;
          setView("results");
          setStatus("stopped");
          setStats(engine.getStats());
          setTrades(engine.getTrades());
        }
      }, interval);
    },
    [],
  );

  /* ---- Replay controls ---- */
  const handlePause = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
      setStatus("paused");
      sandboxRef.current?.pause();
    }
  }, []);

  const handleResume = useCallback(() => {
    setStatus("running");
    sandboxRef.current?.resume();
    startTickReplay(speed);
  }, [speed, startTickReplay]);

  const handleStop = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    sandboxRef.current?.stop();
    sandboxRef.current = null;
    setStatus("stopped");
    setView("results");
    if (engineRef.current) {
      setStats(engineRef.current.getStats());
      setTrades(engineRef.current.getTrades());
    }
  }, []);

  const handleStep = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.advanceTick();
    if (engine.getTickIndex() >= engine.getTickBuffer().length - 1) {
      setView("results");
      setStatus("stopped");
    }
    setStats(engine.getStats());
    setTrades(engine.getTrades());
  }, []);

  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      setSpeed(newSpeed);
      if (status === "running" && replayTimerRef.current) {
        clearInterval(replayTimerRef.current);
        replayTimerRef.current = null;
        startTickReplay(newSpeed);
      }
    },
    [status, startTickReplay],
  );

  const handleReset = useCallback(() => {
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    sandboxRef.current?.stop();
    sandboxRef.current = null;
    engineRef.current?.reset();
    engineRef.current = null;
    setStatus("idle");
    setView("setup");
    setStats(null);
    setTrades([]);
    setBalance(initialBalance);
    setCurrentTick(null);
    setTickIndex(0);
    setLogs([]);
  }, [initialBalance]);

  /* ---- Export results ---- */
  const handleExportResults = useCallback(() => {
    if (!stats) return;
    const csv = [
      "Trade ID,Type,Stake,Entry Tick,Exit Tick,Duration,Profit,Payout,Status,Timestamp",
      ...trades.map(
        (t) =>
          `${t.id},${t.contract_type},${t.stake},${t.entry_tick},${t.exit_tick},${t.tick_count},${t.profit},${t.payout},${t.status},${new Date(t.timestamp * 1000).toISOString()}`,
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${symbol}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stats, trades, symbol]);

  const progressPct = engineRef.current
    ? Math.round((tickIndex / (engineRef.current.getTickBuffer().length || 1)) * 100)
    : 0;

  return (
    <div className="backtest-container">
      {/* Header */}
      <div className="bot-header">
        <div>
          <p className="eyebrow">BACKTESTING</p>
          <h1>Strategy Backtest</h1>
          <p className="muted">Test your strategy against historical market data.</p>
        </div>
        <button className="back-btn" onClick={onBack}>← Back</button>
      </div>

      {/* ===== SETUP VIEW ===== */}
      {view === "setup" && (
        <div className="backtest-setup">
          <div className="backtest-form">
            <div className="form-row">
              <div className="form-group">
                <label>Symbol</label>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  <optgroup label="Volatility">
                    <option value="1HZ10V">Volatility 10 (1s)</option>
                    <option value="1HZ25V">Volatility 25 (1s)</option>
                    <option value="1HZ50V">Volatility 50 (1s)</option>
                    <option value="1HZ75V">Volatility 75 (1s)</option>
                    <option value="1HZ100V">Volatility 100 (1s)</option>
                  </optgroup>
                  <optgroup label="Crash/Boom">
                    <option value="1HZ100C10">Crash 1000</option>
                    <option value="1HZ100C5">Crash 500</option>
                    <option value="1HZ100B10">Boom 1000</option>
                    <option value="1HZ100B5">Boom 500</option>
                  </optgroup>
                </select>
              </div>
              <div className="form-group">
                <label>Contract Type</label>
                <select value={contractType} onChange={(e) => setContractType(e.target.value)}>
                  <option value="DIGITOVER">Digit Over</option>
                  <option value="DIGITUNDER">Digit Under</option>
                  <option value="DIGITDIFF">Digit Differs</option>
                  <option value="DIGITEVEN">Even</option>
                  <option value="DIGITODD">Odd</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Prediction (barrier)</label>
                <select value={barrier} onChange={(e) => setBarrier(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Duration (ticks)</label>
                <select value={durationTicks} onChange={(e) => setDurationTicks(Number(e.target.value))}>
                  {[1, 2, 3, 5, 10, 15, 20, 30].map((n) => (
                    <option key={n} value={n}>{n} ticks</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Stake (USD)</label>
                <input type="number" value={stake} min={0.35} step={0.5}
                  onChange={(e) => setStake(Number(e.target.value))} />
              </div>
              <div className="form-group">
                <label>Initial Balance</label>
                <input type="number" value={initialBalance} min={100} step={100}
                  onChange={(e) => setInitialBalance(Number(e.target.value))} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Tick Count</label>
                <select value={tickCount} onChange={(e) => setTickCount(Number(e.target.value))}>
                  {[500, 1000, 2000, 5000, 10000].map((n) => (
                    <option key={n} value={n}>{n.toLocaleString()} ticks</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Replay Speed</label>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  <option value={1}>1x (slow)</option>
                  <option value={2}>2x</option>
                  <option value={5}>5x</option>
                  <option value={10}>10x</option>
                  <option value={50}>50x</option>
                  <option value={100}>100x (fast)</option>
                </select>
              </div>
            </div>

            {!visualCode.trim() && (
              <div className="backtest-warning">
                ⚠ No strategy code. Open the Blockly editor and build a strategy first.
              </div>
            )}

            <button
              className="backtest-start-btn"
              onClick={handleStartBacktest}
              disabled={loading || !visualCode.trim()}
            >
              {loading ? (
                <>Loading ticks… {loadProgress}%</>
              ) : (
                <><IconPlayerPlay size={16} /> Start Backtest</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ===== RUNNING VIEW ===== */}
      {view === "running" && (
        <div className="backtest-running">
          {/* Replay controls */}
          <div className="replay-controls">
            <div className="replay-controls-left">
              <span className={`replay-status-dot ${status}`} />
              <span className="replay-status-text">{status}</span>
              {currentTick && (
                <span className="replay-tick-price">
                  {currentTick.quote.toFixed(2)}
                </span>
              )}
              <span className="replay-balance">
                ${balance.toFixed(2)}
              </span>
            </div>
            <div className="replay-controls-center">
              {status !== "running" ? (
                <button className="replay-play-btn" onClick={status === "paused" ? handleResume : handleStartBacktest}>
                  <IconPlayerPlay size={14} />
                </button>
              ) : (
                <button className="replay-pause-btn" onClick={handlePause}>
                  <IconPlayerPause size={14} />
                </button>
              )}
              <button className="replay-step-btn" onClick={handleStep} disabled={status === "running"}>
                <IconPlayerTrackNext size={14} />
              </button>
              <button className="replay-stop-btn" onClick={handleStop}>
                <IconPlayerStop size={14} />
              </button>
            </div>
            <div className="replay-controls-right">
              <span className="replay-speed-label">Speed:</span>
              {[1, 5, 10, 50, 100].map((s) => (
                <button
                  key={s}
                  className={`replay-speed-btn ${speed === s ? "active" : ""}`}
                  onClick={() => handleSpeedChange(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div className="replay-progress">
            <div className="replay-progress-bar" style={{ width: `${progressPct}%` }} />
            <span className="replay-progress-text">
              Tick {tickIndex.toLocaleString()} / {engineRef.current?.getTickBuffer().length.toLocaleString() ?? "…"} ({progressPct}%)
            </span>
          </div>

          {/* Live stats */}
          {stats && (
            <div className="backtest-live-stats">
              <div className="stat-item">
                <span className="stat-label">Trades</span>
                <span className="stat-value">{stats.totalTrades}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Win Rate</span>
                <span className={`stat-value ${stats.winRate >= 50 ? "positive" : "negative"}`}>
                  {stats.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Profit</span>
                <span className={`stat-value ${stats.totalProfit >= 0 ? "positive" : "negative"}`}>
                  ${stats.totalProfit.toFixed(2)}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Balance</span>
                <span className="stat-value">${balance.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Tick chart */}
          {engineRef.current && (
            <div className="backtest-chart">
              <TickChart
                ticks={engineRef.current.getTickBuffer()}
                currentIndex={tickIndex}
                trades={trades}
              />
            </div>
          )}

          {/* Log */}
          <div className="backtest-log">
            <div className="code-output-header">
              <span>Execution Log ({logs.length})</span>
              <button className="copy-code-btn" onClick={() => setLogs([])}>Clear</button>
            </div>
            <div className="blockly-log-entries">
              {logs.slice(-30).map((entry, i) => (
                <div key={i} className={`blockly-log-entry ${entry.level}`}>
                  <span className="blockly-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className={`blockly-log-level ${entry.level}`}>{entry.level}</span>
                  <span className="blockly-log-msg">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== RESULTS VIEW ===== */}
      {view === "results" && stats && (
        <div className="backtest-results">
          <div className="results-header">
            <h2>Backtest Results</h2>
            <div className="results-actions">
              <button className="results-btn" onClick={handleExportResults}>
                <IconDownload size={14} /> Export CSV
              </button>
              <button className="results-btn" onClick={handleReset}>
                Run Again
              </button>
            </div>
          </div>

          {/* Stats cards */}
          <div className="results-stats-grid">
            <div className="results-stat-card">
              <span className="results-stat-label">Total Trades</span>
              <span className="results-stat-value">{stats.totalTrades}</span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Win Rate</span>
              <span className={`results-stat-value ${stats.winRate >= 50 ? "positive" : "negative"}`}>
                {stats.winRate.toFixed(1)}%
              </span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Total Profit</span>
              <span className={`results-stat-value ${stats.totalProfit >= 0 ? "positive" : "negative"}`}>
                ${stats.totalProfit.toFixed(2)}
              </span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Max Drawdown</span>
              <span className="results-stat-value negative">-${stats.maxDrawdown.toFixed(2)}</span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Profit Factor</span>
              <span className={`results-stat-value ${stats.profitFactor >= 1 ? "positive" : "negative"}`}>
                {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
              </span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Avg Profit/Trade</span>
              <span className={`results-stat-value ${stats.averageProfit >= 0 ? "positive" : "negative"}`}>
                ${stats.averageProfit.toFixed(2)}
              </span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Wins / Losses</span>
              <span className="results-stat-value">
                <span className="positive">{stats.wins}</span> / <span className="negative">{stats.losses}</span>
              </span>
            </div>
            <div className="results-stat-card">
              <span className="results-stat-label">Final Balance</span>
              <span className="results-stat-value">
                ${stats.balanceCurve[stats.balanceCurve.length - 1]?.toFixed(2) ?? "0"}
              </span>
            </div>
          </div>

          {/* Balance curve */}
          <div className="results-chart">
            <h3>Balance Curve</h3>
            <BalanceCurve curve={stats.balanceCurve} height={150} />
          </div>

          {/* Tick chart with trades */}
          {engineRef.current && (
            <div className="results-chart">
              <h3>Tick Replay with Trades</h3>
              <TickChart
                ticks={engineRef.current.getTickBuffer()}
                currentIndex={engineRef.current.getTickBuffer().length - 1}
                trades={trades}
                height={200}
              />
            </div>
          )}

          {/* Trades table */}
          <div className="results-trades">
            <button className="results-trades-toggle" onClick={() => setShowTrades(!showTrades)}>
              <IconTable size={14} /> {showTrades ? "Hide" : "Show"} Trades ({trades.length})
            </button>
            {showTrades && (
              <div className="results-trades-table-wrap">
                <table className="results-trades-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Stake</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Duration</th>
                      <th>P/L</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={t.id} className={t.status}>
                        <td>{i + 1}</td>
                        <td>{t.contract_type}</td>
                        <td>${t.stake.toFixed(2)}</td>
                        <td>{t.entry_tick.toFixed(2)}</td>
                        <td>{t.exit_tick.toFixed(2)}</td>
                        <td>{t.tick_count}t</td>
                        <td className={t.profit >= 0 ? "positive" : "negative"}>
                          {t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)}
                        </td>
                        <td className={t.status}>{t.status.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Log */}
          <div className="backtest-log">
            <div className="code-output-header">
              <span>Execution Log ({logs.length})</span>
            </div>
            <div className="blockly-log-entries">
              {logs.slice(-50).map((entry, i) => (
                <div key={i} className={`blockly-log-entry ${entry.level}`}>
                  <span className="blockly-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className={`blockly-log-level ${entry.level}`}>{entry.level}</span>
                  <span className="blockly-log-msg">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .backtest-container {
          display: flex; flex-direction: column; gap: 16px;
          max-width: 900px; margin: 0 auto;
        }
        .backtest-setup {
          display: flex; justify-content: center;
        }
        .backtest-form {
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 12px; padding: 20px; width: 100%; max-width: 500px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .form-row { display: flex; gap: 12px; }
        .form-group { flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .form-group label {
          font-size: 11px; color: var(--muted, #718197); text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .form-group select, .form-group input {
          padding: 8px 10px; background: #1a2332; border: 1px solid var(--border, #2a3444);
          border-radius: 6px; color: var(--text, #d9e3ed); font-size: 13px;
          outline: none; transition: 0.15s;
        }
        .form-group select:focus, .form-group input:focus {
          border-color: var(--teal, #37d4bd);
        }
        .backtest-warning {
          padding: 10px; background: rgba(240, 192, 64, 0.08);
          border: 1px solid rgba(240, 192, 64, 0.3);
          border-radius: 6px; color: #f0c040; font-size: 12px;
        }
        .backtest-start-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 24px; background: linear-gradient(135deg, #37d4bd, #2db8a3);
          color: #0b1420; border: none; border-radius: 8px;
          font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.2s;
          margin-top: 8px;
        }
        .backtest-start-btn:hover:not(:disabled) {
          transform: translateY(-1px); box-shadow: 0 4px 16px rgba(55,212,189,.3);
        }
        .backtest-start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Replay controls */
        .replay-controls {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 16px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
          flex-wrap: wrap; gap: 10px;
        }
        .replay-controls-left, .replay-controls-right, .replay-controls-center {
          display: flex; align-items: center; gap: 8px;
        }
        .replay-status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .replay-status-dot.running { background: #37d4bd; box-shadow: 0 0 8px #37d4bd; animation: ws-blink 1s infinite; }
        .replay-status-dot.paused { background: #f0c040; animation: ws-blink 1s infinite; }
        .replay-status-dot.stopped { background: #718197; }
        .replay-status-dot.idle { background: #718197; }
        .replay-status-text { font-size: 11px; color: var(--muted, #718197); text-transform: capitalize; }
        .replay-tick-price {
          font-family: 'Space Grotesk', monospace; font-size: 14px; font-weight: 600;
          color: var(--teal, #37d4bd);
        }
        .replay-balance {
          font-family: 'Space Grotesk', monospace; font-size: 13px; font-weight: 600;
          color: #8de7d9; padding: 4px 10px; background: rgba(70,211,189,.08); border-radius: 6px;
        }
        .replay-play-btn, .replay-pause-btn, .replay-step-btn, .replay-stop-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border: 1px solid var(--border, #2a3444);
          border-radius: 6px; background: #1a2332; color: #d9e3ed;
          cursor: pointer; transition: 0.15s;
        }
        .replay-play-btn:hover { border-color: #37d4bd; color: #37d4bd; }
        .replay-pause-btn:hover { border-color: #f0c040; color: #f0c040; }
        .replay-step-btn:hover { border-color: #9a8ed2; color: #9a8ed2; }
        .replay-stop-btn:hover { border-color: #e05555; color: #e05555; }
        .replay-speed-btn {
          padding: 4px 8px; background: transparent; border: 1px solid var(--border, #2a3444);
          border-radius: 4px; color: var(--muted, #718197); font-size: 11px;
          cursor: pointer; transition: 0.15s;
        }
        .replay-speed-btn:hover { border-color: var(--teal, #37d4bd); color: var(--text, #d9e3ed); }
        .replay-speed-btn.active {
          background: rgba(70,211,189,.15); border-color: var(--teal, #37d4bd);
          color: var(--teal, #37d4bd); font-weight: 600;
        }
        .replay-speed-label { font-size: 11px; color: var(--muted, #718197); }

        /* Progress bar */
        .replay-progress {
          position: relative; height: 6px; background: #1a2332;
          border-radius: 3px; overflow: hidden;
        }
        .replay-progress-bar {
          height: 100%; background: linear-gradient(90deg, #37d4bd, #2db8a3);
          border-radius: 3px; transition: width 0.1s linear;
        }
        .replay-progress-text {
          position: absolute; right: 8px; top: 10px;
          font-size: 10px; color: var(--muted, #718197);
        }

        /* Live stats */
        .backtest-live-stats {
          display: flex; gap: 16px; padding: 10px 16px;
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 8px; flex-wrap: wrap;
        }
        .stat-item { display: flex; flex-direction: column; gap: 2px; }
        .stat-label { font-size: 10px; color: var(--muted, #718197); text-transform: uppercase; }
        .stat-value { font-size: 14px; font-weight: 600; color: var(--text, #d9e3ed); }
        .stat-value.positive { color: #37d4bd; }
        .stat-value.negative { color: #e05555; }

        /* Charts */
        .backtest-chart, .results-chart {
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 10px; padding: 12px; overflow: hidden;
        }
        .results-chart h3 {
          font-size: 13px; margin: 0 0 8px; color: var(--muted, #718197);
        }

        /* Results */
        .results-header {
          display: flex; justify-content: space-between; align-items: center;
        }
        .results-header h2 { margin: 0; font-size: 20px; }
        .results-actions { display: flex; gap: 8px; }
        .results-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 6px; color: var(--text, #d9e3ed); font-size: 12px;
          cursor: pointer; transition: 0.15s;
        }
        .results-btn:hover { border-color: var(--teal, #37d4bd); color: var(--teal, #37d4bd); }

        .results-stats-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
        }
        .results-stat-card {
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px;
        }
        .results-stat-label {
          font-size: 11px; color: var(--muted, #718197); text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .results-stat-value {
          font-size: 20px; font-weight: 700; color: var(--text, #d9e3ed);
        }
        .results-stat-value.positive { color: #37d4bd; }
        .results-stat-value.negative { color: #e05555; }

        /* Trades table */
        .results-trades { margin-top: 8px; }
        .results-trades-toggle {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; background: transparent; border: 1px solid var(--border, #2a3444);
          border-radius: 6px; color: var(--muted, #718197); font-size: 12px;
          cursor: pointer; transition: 0.15s;
        }
        .results-trades-toggle:hover { border-color: var(--teal, #37d4bd); color: var(--text, #d9e3ed); }
        .results-trades-table-wrap {
          margin-top: 8px; overflow-x: auto; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
        }
        .results-trades-table {
          width: 100%; border-collapse: collapse; font-size: 12px;
        }
        .results-trades-table th {
          padding: 8px 12px; text-align: left; font-size: 10px;
          color: var(--muted, #718197); text-transform: uppercase;
          letter-spacing: 0.5px; border-bottom: 1px solid var(--border, #2a3444);
        }
        .results-trades-table td {
          padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,.03);
          color: var(--text, #d9e3ed); font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .results-trades-table td.positive { color: #37d4bd; }
        .results-trades-table td.negative { color: #e05555; }
        .results-trades-table td.won { color: #37d4bd; }
        .results-trades-table td.lost { color: #e05555; }

        /* Log */
        .backtest-log {
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 10px; overflow: hidden;
        }
        .code-output-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 12px; border-bottom: 1px solid var(--border, #2a3444);
          font-size: 11px; color: var(--muted, #718197);
        }
        .copy-code-btn {
          padding: 4px 8px; background: transparent; border: 1px solid var(--border, #2a3444);
          border-radius: 4px; color: var(--muted, #718197); font-size: 10px;
          cursor: pointer; transition: 0.15s;
        }
        .copy-code-btn:hover { border-color: var(--teal, #37d4bd); color: var(--text, #d9e3ed); }
        .blockly-log-entries { max-height: 200px; overflow-y: auto; padding: 6px 12px; }
        .blockly-log-entry {
          display: flex; gap: 8px; font-size: 11px;
          font-family: 'JetBrains Mono', monospace; padding: 2px 0;
          border-bottom: 1px solid rgba(255,255,255,.03);
        }
        .blockly-log-time { color: #566477; min-width: 70px; }
        .blockly-log-level { min-width: 40px; font-weight: 600; text-transform: uppercase; }
        .blockly-log-level.info { color: #37d4bd; }
        .blockly-log-level.warn { color: #f0c040; }
        .blockly-log-level.error { color: #e05555; }
        .blockly-log-msg { color: #a0b0c0; }

        @keyframes ws-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}
