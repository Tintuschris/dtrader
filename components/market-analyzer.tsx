"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrain, IconChartBar, IconPlayerPlay, IconPlayerStop,
  IconTarget, IconRefresh, IconTrendingUp, IconTrendingDown,
  IconEqual, IconPlayerTrackNext, IconInfoCircle,
} from "@tabler/icons-react";
import {
  MarketAnalyzer,
  ALL_MARKETS,
  type MarketScore,
  type DigitStats,
  type DigitTradeScore,
  type EvenOddScore,
  type MatchesDiffersScore,
  type MarketSymbol,
} from "../lib/market-analyzer";

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

type Tab = "overview" | "digits" | "trades" | "even-odd" | "matches";

export default function MarketAnalyzerPanel() {
  const analyzerRef = useRef<MarketAnalyzer | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<string>("1HZ100V");
  const [scores, setScores] = useState<MarketScore[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});
  const [accuracy, setAccuracy] = useState({ total: 0, correct: 0, rate: 0 });
  const [recentAccuracy, setRecentAccuracy] = useState({ total: 0, correct: 0, rate: 0 });

  // Initialize analyzer
  useEffect(() => {
    const analyzer = new MarketAnalyzer();
    analyzerRef.current = analyzer;

    const unsub = analyzer.onUpdate(() => {
      // Re-score all active markets periodically
      const newScores: MarketScore[] = [];
      const counts: Record<string, number> = {};
      for (const m of ALL_MARKETS) {
        const ticks = analyzer.getTicks(m.symbol);
        if (ticks.length > 0) {
          newScores.push(analyzer.scoreMarket(m.symbol, m.name, m.category));
          counts[m.symbol] = ticks.length;
        }
      }
      setScores(newScores.sort((a, b) => b.overallScore - a.overallScore));
      setTickCounts(counts);
      setAccuracy(analyzer.getAccuracy());
      setRecentAccuracy(analyzer.getRecentAccuracy());
    });

    return () => {
      unsub();
      analyzer.destroy();
    };
  }, []);

  const startStreaming = useCallback(() => {
    const analyzer = analyzerRef.current;
    if (!analyzer) return;

    // Start streaming all volatility markets (not crash/boom as they work differently)
    const volatilitySymbols = ALL_MARKETS
      .filter((m) => m.category === "volatility")
      .map((m) => m.symbol);

    analyzer.startStreaming(volatilitySymbols);
    setIsStreaming(true);
  }, []);

  const stopStreaming = useCallback(() => {
    analyzerRef.current?.stopStreaming();
    setIsStreaming(false);
    setScores([]);
    setTickCounts({});
  }, []);

  const currentScore = useMemo(
    () => scores.find((s) => s.symbol === selectedMarket) ?? null,
    [scores, selectedMarket],
  );

  const bestMarket = scores.length > 0 ? scores[0] : null;

  return (
    <div className="analyzer-container">
      {/* Header */}
      <div className="bot-header">
        <div>
          <p className="eyebrow">MARKET ANALYZER</p>
          <h1><IconBrain size={24} style={{ verticalAlign: "middle", marginRight: 8 }} />AI Digit Analysis</h1>
          <p className="muted">
            ML-powered analysis of digit distributions across all markets.
            Self-learns from prediction accuracy.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!isStreaming ? (
            <button className="analyzer-start-btn" onClick={startStreaming}>
              <IconPlayerPlay size={14} /> Start Analysis
            </button>
          ) : (
            <button className="analyzer-stop-btn" onClick={stopStreaming}>
              <IconPlayerStop size={14} /> Stop
            </button>
          )}
        </div>
      </div>

      {/* AI Accuracy Banner */}
      <div className="analyzer-accuracy-banner">
        <div className="accuracy-item">
          <IconBrain size={14} />
          <span className="accuracy-label">ML Accuracy</span>
          <span className={`accuracy-value ${recentAccuracy.rate >= 55 ? "good" : recentAccuracy.rate < 45 ? "bad" : ""}`}>
            {recentAccuracy.rate.toFixed(1)}%
          </span>
          <span className="accuracy-sub">({recentAccuracy.correct}/{recentAccuracy.total} recent)</span>
        </div>
        <div className="accuracy-item">
          <span className="accuracy-label">All-Time</span>
          <span className="accuracy-value">{accuracy.rate.toFixed(1)}%</span>
          <span className="accuracy-sub">({accuracy.correct}/{accuracy.total})</span>
        </div>
        {bestMarket && (
          <div className="accuracy-item best-market-rec">
            <IconTarget size={14} />
            <span className="accuracy-label">Best Market</span>
            <span className="accuracy-value best">{bestMarket.name}</span>
            <span className="accuracy-sub">Score: {bestMarket.overallScore}/100</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="analyzer-tabs">
        {([
          ["overview", "Overview", IconChartBar],
          ["digits", "Digit Analysis", IconTarget],
          ["trades", "Trade Scores", IconTrendingUp],
          ["even-odd", "Even/Odd", IconEqual],
          ["matches", "Matches/Differs", IconPlayerTrackNext],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`analyzer-tab ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Market selector */}
      <div className="analyzer-market-selector">
        <label>Market:</label>
        <select value={selectedMarket} onChange={(e) => setSelectedMarket(e.target.value)}>
          {ALL_MARKETS.map((m) => (
            <option key={m.symbol} value={m.symbol}>
              {m.name} {tickCounts[m.symbol] ? `(${tickCounts[m.symbol]} ticks)` : ""}
            </option>
          ))}
        </select>
        {currentScore && (
          <span className="analyzer-market-score">
            Score: <strong className={currentScore.overallScore >= 60 ? "good" : currentScore.overallScore < 30 ? "bad" : ""}>
              {currentScore.overallScore}
            </strong>/100
          </span>
        )}
      </div>

      {/* No data state */}
      {!isStreaming && scores.length === 0 && (
        <div className="analyzer-empty">
          <IconBrain size={48} style={{ opacity: 0.3 }} />
          <p>Click <strong>Start Analysis</strong> to begin streaming live tick data and analyzing digit distributions.</p>
          <p className="muted">The AI will self-improve as it tracks prediction accuracy over time.</p>
        </div>
      )}

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === "overview" && scores.length > 0 && (
        <div className="analyzer-overview">
          <h3>Market Rankings</h3>
          <div className="market-rank-grid">
            {scores.map((s, i) => (
              <div
                key={s.symbol}
                className={`market-rank-card ${selectedMarket === s.symbol ? "selected" : ""}`}
                onClick={() => setSelectedMarket(s.symbol)}
              >
                <div className="market-rank-header">
                  <span className="market-rank-num">#{i + 1}</span>
                  <span className="market-rank-name">{s.name}</span>
                  <span className={`market-rank-score ${s.overallScore >= 60 ? "good" : s.overallScore < 30 ? "bad" : ""}`}>
                    {s.overallScore}
                  </span>
                </div>
                <div className="market-rank-bar">
                  <div
                    className="market-rank-fill"
                    style={{
                      width: `${s.overallScore}%`,
                      background: s.overallScore >= 60 ? "#37d4bd" : s.overallScore >= 40 ? "#f0c040" : "#e05555",
                    }}
                  />
                </div>
                <div className="market-rank-details">
                  {s.bestTrade && (
                    <span className="market-best-trade">
                      Best: {s.bestTrade.direction.toUpperCase()} {s.bestTrade.digit} ({s.bestTrade.score})
                    </span>
                  )}
                  <span className="market-entropy">
                    Entropy: {s.entropy.toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== DIGIT ANALYSIS TAB ===== */}
      {activeTab === "digits" && currentScore && (
        <DigitAnalysisView score={currentScore} />
      )}

      {/* ===== TRADE SCORES TAB ===== */}
      {activeTab === "trades" && currentScore && (
        <TradeScoresView score={currentScore} />
      )}

      {/* ===== EVEN/ODD TAB ===== */}
      {activeTab === "even-odd" && currentScore && (
        <EvenOddView score={currentScore.evenOddScore} symbol={currentScore.name} />
      )}

      {/* ===== MATCHES/DIFFERS TAB ===== */}
      {activeTab === "matches" && currentScore && (
        <MatchesDiffersView score={currentScore.matchesDiffersScore} symbol={currentScore.name} />
      )}

      <style jsx>{`
        .analyzer-container { display: flex; flex-direction: column; gap: 12px; }

        .analyzer-start-btn, .analyzer-stop-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 8px; font-size: 13px;
          font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .analyzer-start-btn {
          background: linear-gradient(135deg, #9a8ed2, #7c6fc0);
          color: #fff; border: none;
        }
        .analyzer-start-btn:hover { box-shadow: 0 4px 16px rgba(154,142,210,.3); }
        .analyzer-stop-btn {
          background: transparent; border: 1px solid #e05555; color: #e05555;
        }
        .analyzer-stop-btn:hover { background: rgba(224,85,85,.1); }

        .analyzer-accuracy-banner {
          display: flex; gap: 20px; padding: 12px 16px;
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 10px; flex-wrap: wrap; align-items: center;
        }
        .accuracy-item { display: flex; align-items: center; gap: 6px; font-size: 13px; }
        .accuracy-label { color: var(--muted, #718197); font-size: 11px; }
        .accuracy-value { font-weight: 700; color: var(--text, #d9e3ed); }
        .accuracy-value.good { color: #37d4bd; }
        .accuracy-value.bad { color: #e05555; }
        .accuracy-value.best { color: #9a8ed2; }
        .accuracy-sub { font-size: 10px; color: #566477; }
        .best-market-rec { margin-left: auto; }

        .analyzer-tabs {
          display: flex; gap: 4px; padding: 4px;
          background: #0c141f; border: 1px solid var(--border, #2a3444);
          border-radius: 10px; flex-wrap: wrap;
        }
        .analyzer-tab {
          display: flex; align-items: center; gap: 5px;
          padding: 8px 14px; background: transparent;
          border: none; border-radius: 7px;
          color: var(--muted, #718197); font-size: 12px;
          cursor: pointer; transition: 0.15s;
        }
        .analyzer-tab:hover { color: var(--text, #d9e3ed); background: rgba(255,255,255,.04); }
        .analyzer-tab.active {
          background: rgba(154,142,210,.12); color: #9a8ed2; font-weight: 600;
        }

        .analyzer-market-selector {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 8px;
        }
        .analyzer-market-selector label {
          font-size: 11px; color: var(--muted, #718197); text-transform: uppercase;
        }
        .analyzer-market-selector select {
          flex: 1; padding: 6px 10px; background: #1a2332;
          border: 1px solid var(--border, #2a3444); border-radius: 6px;
          color: var(--text, #d9e3ed); font-size: 13px;
        }
        .analyzer-market-score { font-size: 13px; color: var(--muted, #718197); }
        .analyzer-market-score strong { color: var(--text, #d9e3ed); }
        .analyzer-market-score strong.good { color: #37d4bd; }
        .analyzer-market-score strong.bad { color: #e05555; }

        .analyzer-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 60px 20px;
          text-align: center; color: var(--muted, #718197);
        }
        .analyzer-empty p { margin: 8px 0; font-size: 14px; }
        .analyzer-empty .muted { font-size: 12px; color: #566477; }

        /* Overview grid */
        .analyzer-overview h3 { margin: 0 0 10px; font-size: 15px; }
        .market-rank-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
        .market-rank-card {
          padding: 12px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
          cursor: pointer; transition: 0.15s;
        }
        .market-rank-card:hover { border-color: #9a8ed2; }
        .market-rank-card.selected { border-color: #9a8ed2; background: rgba(154,142,210,.05); }
        .market-rank-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .market-rank-num { font-size: 11px; color: #566477; font-weight: 600; }
        .market-rank-name { font-size: 13px; font-weight: 600; color: var(--text, #d9e3ed); flex: 1; }
        .market-rank-score { font-size: 18px; font-weight: 700; }
        .market-rank-score.good { color: #37d4bd; }
        .market-rank-score.bad { color: #e05555; }
        .market-rank-bar { height: 4px; background: #1a2332; border-radius: 2px; margin-bottom: 6px; }
        .market-rank-fill { height: 100%; border-radius: 2px; transition: width 0.5s; }
        .market-rank-details { display: flex; justify-content: space-between; font-size: 10px; color: #566477; }
        .market-best-trade { color: #9a8ed2; }
        .market-entropy { font-family: monospace; }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Digit Analysis View                                                 */
/* ------------------------------------------------------------------ */

function DigitAnalysisView({ score }: { score: MarketScore }) {
  // Fetch digit stats from analyzer
  const analyzer = useRef<MarketAnalyzer | null>(null);
  useEffect(() => {
    // We can't easily get the analyzer instance here, so we'll derive stats from score
  }, [score]);

  const maxFreq = Math.max(...(score.digitScores.map((d) => {
    // Use the digit's frequency from the trade scores
    const overReasons = d.reasons.join(" ");
    const match = overReasons.match(/(\d+\.?\d*)%/);
    return match ? parseFloat(match[1]) : 10;
  }) || [10]), 15);

  return (
    <div className="digit-analysis">
      <h3>Digit Distribution — {score.name}</h3>
      <p className="analysis-subtitle">
        Entropy: {score.entropy.toFixed(3)} | Ticks: {score.tickCount.toLocaleString()}
        {score.entropy < 0.85 ? " — Biased (favorable)" : score.entropy > 0.95 ? " — Highly random" : ""}
      </p>

      {/* Digit frequency visualization */}
      <div className="digit-freq-chart">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
          // Get over/under scores for this digit
          const overScore = score.digitScores.find((s) => s.digit === d && s.direction === "over");
          const underScore = score.digitScores.find((s) => s.digit === d && s.direction === "under");
          const bestScore = (overScore?.score ?? 0) > (underScore?.score ?? 0) ? overScore : underScore;

          // Estimate frequency from distribution skew
          const skew = bestScore?.distributionSkew ?? 0;
          const estimatedFreq = 10 + skew * 5;

          return (
            <div key={d} className="digit-freq-col">
              <div className="digit-freq-bar-wrap">
                <div
                  className="digit-freq-bar"
                  style={{
                    height: `${Math.max(5, (estimatedFreq / maxFreq) * 100)}%`,
                    background: bestScore && bestScore.score >= 60
                      ? "#37d4bd"
                      : bestScore && bestScore.score >= 40
                      ? "#f0c040"
                      : "#e05555",
                  }}
                />
              </div>
              <span className="digit-freq-label">{d}</span>
              <span className="digit-freq-score">{bestScore?.score ?? "-"}</span>
            </div>
          );
        })}
      </div>

      {/* Constraint checks */}
      <div className="constraint-grid">
        {score.digitScores
          .filter((d) => d.score >= 40)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map((d) => (
            <div key={`${d.digit}-${d.direction}`} className={`constraint-card ${d.score >= 60 ? "good" : ""}`}>
              <div className="constraint-header">
                <span className="constraint-digit">{d.direction.toUpperCase()} {d.digit}</span>
                <span className={`constraint-score ${d.score >= 60 ? "good" : d.score >= 40 ? "mid" : ""}`}>
                  {d.score}/100
                </span>
              </div>
              <div className="constraint-checks">
                <span className={`check ${d.underDigitsBelowThreshold || d.overDigitsBelowThreshold ? "pass" : "fail"}`}>
                  {d.direction === "under" ? "High digits < 10%" : "Low digits < 10%"}:
                  {d.underDigitsBelowThreshold || d.overDigitsBelowThreshold ? " ✓" : " ✗"}
                </span>
                <span className={`check ${d.mostFrequentFarEnough ? "pass" : "fail"}`}>
                  Most freq. ≥3 away: {d.mostFrequentFarEnough ? "✓" : "✗"}
                </span>
              </div>
            </div>
          ))}
      </div>

      <style jsx>{`
        .digit-analysis { display: flex; flex-direction: column; gap: 16px; }
        .digit-analysis h3 { margin: 0; font-size: 15px; }
        .analysis-subtitle { font-size: 12px; color: var(--muted, #718197); margin: 0; }

        .digit-freq-chart {
          display: flex; gap: 6px; align-items: flex-end;
          padding: 16px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
          height: 200px;
        }
        .digit-freq-col {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          gap: 4px; height: 100%;
        }
        .digit-freq-bar-wrap {
          flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center;
        }
        .digit-freq-bar {
          width: 80%; border-radius: 4px 4px 0 0; transition: height 0.5s;
          min-height: 4px;
        }
        .digit-freq-label {
          font-size: 14px; font-weight: 700; color: var(--text, #d9e3ed);
        }
        .digit-freq-score {
          font-size: 10px; color: var(--muted, #718197);
        }

        .constraint-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px;
        }
        .constraint-card {
          padding: 10px 12px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 8px;
        }
        .constraint-card.good { border-color: rgba(55,212,189,.3); }
        .constraint-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 6px;
        }
        .constraint-digit { font-size: 13px; font-weight: 700; color: var(--text, #d9e3ed); }
        .constraint-score { font-size: 12px; font-weight: 600; }
        .constraint-score.good { color: #37d4bd; }
        .constraint-score.mid { color: #f0c040; }
        .constraint-checks { display: flex; flex-direction: column; gap: 2px; }
        .check { font-size: 11px; color: var(--muted, #718197); }
        .check.pass { color: #37d4bd; }
        .check.fail { color: #e05555; }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trade Scores View                                                   */
/* ------------------------------------------------------------------ */

function TradeScoresView({ score }: { score: MarketScore }) {
  return (
    <div className="trade-scores">
      <h3>Trade Recommendations — {score.name}</h3>

      {score.bestTrade && (
        <div className="best-trade-banner">
          <IconTarget size={18} />
          <div>
            <span className="best-trade-label">Best Trade</span>
            <span className="best-trade-detail">
              {score.bestTrade.direction.toUpperCase()} {score.bestTrade.digit} — Score: {score.bestTrade.score}/100
            </span>
          </div>
        </div>
      )}

      <div className="trade-grid">
        {score.digitScores
          .sort((a, b) => b.score - a.score)
          .map((d) => (
            <div
              key={`${d.digit}-${d.direction}`}
              className={`trade-card ${d.score >= 60 ? "strong" : d.score >= 40 ? "moderate" : "weak"}`}
            >
              <div className="trade-card-header">
                <span className="trade-direction">{d.direction.toUpperCase()}</span>
                <span className="trade-digit">{d.digit}</span>
                <span className={`trade-score ${d.score >= 60 ? "good" : d.score >= 40 ? "mid" : ""}`}>
                  {d.score}
                </span>
              </div>
              <div className="trade-bar-wrap">
                <div className="trade-bar" style={{ width: `${d.score}%` }} />
              </div>
              <div className="trade-reasons">
                {d.reasons.slice(0, 3).map((r, i) => (
                  <div key={i} className={`trade-reason ${r.includes("✓") ? "pass" : r.includes("✗") ? "fail" : ""}`}>
                    {r}
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>

      <style jsx>{`
        .trade-scores { display: flex; flex-direction: column; gap: 16px; }
        .trade-scores h3 { margin: 0; font-size: 15px; }

        .best-trade-banner {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; background: rgba(55,212,189,.06);
          border: 1px solid rgba(55,212,189,.2); border-radius: 10px;
          color: #37d4bd;
        }
        .best-trade-label { font-size: 11px; text-transform: uppercase; display: block; }
        .best-trade-detail { font-size: 16px; font-weight: 700; }

        .trade-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 8px;
        }
        .trade-card {
          padding: 10px 12px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 8px;
        }
        .trade-card.strong { border-color: rgba(55,212,189,.3); }
        .trade-card.moderate { border-color: rgba(240,192,64,.2); }
        .trade-card.weak { opacity: 0.5; }
        .trade-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .trade-direction { font-size: 10px; color: var(--muted, #718197); text-transform: uppercase; }
        .trade-digit { font-size: 20px; font-weight: 700; color: var(--text, #d9e3ed); }
        .trade-score { margin-left: auto; font-size: 14px; font-weight: 700; }
        .trade-score.good { color: #37d4bd; }
        .trade-score.mid { color: #f0c040; }
        .trade-bar-wrap { height: 3px; background: #1a2332; border-radius: 2px; margin-bottom: 6px; }
        .trade-bar { height: 100%; background: var(--teal, #37d4bd); border-radius: 2px; }
        .trade-reasons { display: flex; flex-direction: column; gap: 1px; }
        .trade-reason { font-size: 10px; color: #566477; }
        .trade-reason.pass { color: #37d4bd; }
        .trade-reason.fail { color: #e05555; }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Even/Odd View                                                       */
/* ------------------------------------------------------------------ */

function EvenOddView({ score, symbol }: { score: EvenOddScore; symbol: string }) {
  return (
    <div className="even-odd-view">
      <h3>Even/Odd Analysis — {symbol}</h3>

      <div className="even-odd-grid">
        <div className={`eo-card even ${score.bestDirection === "even" ? "best" : ""}`}>
          <div className="eo-icon">EVEN</div>
          <div className="eo-score">{score.evenScore}</div>
          <div className="eo-freq">{score.evenFrequency}%</div>
          <div className="eo-trend">
            {score.evenTrend > 0 ? <IconTrendingUp size={14} color="#37d4bd" /> :
             score.evenTrend < 0 ? <IconTrendingDown size={14} color="#e05555" /> :
             <IconEqual size={14} color="#718197" />}
          </div>
          {score.bestDirection === "even" && (
            <span className="eo-recommendation">RECOMMENDED</span>
          )}
        </div>

        <div className="vs-divider">VS</div>

        <div className={`eo-card odd ${score.bestDirection === "odd" ? "best" : ""}`}>
          <div className="eo-icon">ODD</div>
          <div className="eo-score">{score.oddScore}</div>
          <div className="eo-freq">{score.oddFrequency}%</div>
          <div className="eo-trend">
            {score.oddTrend > 0 ? <IconTrendingUp size={14} color="#37d4bd" /> :
             score.oddTrend < 0 ? <IconTrendingDown size={14} color="#e05555" /> :
             <IconEqual size={14} color="#718197" />}
          </div>
          {score.bestDirection === "odd" && (
            <span className="eo-recommendation">RECOMMENDED</span>
          )}
        </div>
      </div>

      <div className="eo-confidence">
        <IconInfoCircle size={14} />
        <span>Confidence: {score.confidence}%</span>
      </div>

      <div className="eo-reasons">
        {score.reasons.map((r, i) => (
          <div key={i} className={`eo-reason ${r.includes("✓") ? "pass" : r.includes("✗") ? "fail" : ""}`}>
            {r}
          </div>
        ))}
      </div>

      <style jsx>{`
        .even-odd-view { display: flex; flex-direction: column; gap: 16px; }
        .even-odd-view h3 { margin: 0; font-size: 15px; }
        .even-odd-grid {
          display: flex; align-items: center; justify-content: center; gap: 20px;
          flex-wrap: wrap;
        }
        .eo-card {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 20px 30px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 12px;
          min-width: 150px; position: relative;
        }
        .eo-card.best { border-color: rgba(55,212,189,.4); background: rgba(55,212,189,.04); }
        .eo-icon { font-size: 16px; font-weight: 700; color: var(--muted, #718197); }
        .eo-score { font-size: 36px; font-weight: 700; color: var(--text, #d9e3ed); }
        .eo-freq { font-size: 14px; color: var(--muted, #718197); }
        .eo-trend { margin-top: 4px; }
        .eo-recommendation {
          position: absolute; top: -10px; right: -10px;
          padding: 3px 8px; background: #37d4bd; color: #0b1420;
          border-radius: 4px; font-size: 9px; font-weight: 700;
        }
        .vs-divider { font-size: 16px; font-weight: 700; color: #566477; }
        .eo-confidence {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--muted, #718197);
        }
        .eo-reasons {
          padding: 10px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 8px;
        }
        .eo-reason { font-size: 12px; padding: 2px 0; color: #566477; }
        .eo-reason.pass { color: #37d4bd; }
        .eo-reason.fail { color: #e05555; }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Matches/Differs View                                                */
/* ------------------------------------------------------------------ */

function MatchesDiffersView({ score, symbol }: { score: MatchesDiffersScore; symbol: string }) {
  return (
    <div className="md-view">
      <h3>Matches/Differs Analysis — {symbol}</h3>

      <div className="md-grid">
        <div className={`md-card ${score.differScore > score.matchScore ? "best" : ""}`}>
          <div className="md-label">DIFFERS</div>
          <div className="md-score">{score.differScore}</div>
          <div className="md-desc">Bet that next digit ≠ {score.bestDigit}</div>
          {score.differScore > score.matchScore && (
            <span className="md-rec">RECOMMENDED</span>
          )}
        </div>

        <div className="md-card best-digit">
          <div className="md-digit">{score.bestDigit}</div>
          <div className="md-digit-label">Best Target Digit</div>
        </div>

        <div className={`md-card ${score.matchScore > score.differScore ? "best" : ""}`}>
          <div className="md-label">MATCHES</div>
          <div className="md-score">{score.matchScore}</div>
          <div className="md-desc">Bet that next digit = {score.bestDigit}</div>
          {score.matchScore > score.differScore && (
            <span className="md-rec">RECOMMENDED</span>
          )}
        </div>
      </div>

      <div className="md-confidence">
        <IconInfoCircle size={14} />
        <span>Confidence: {score.confidence}%</span>
      </div>

      <div className="md-reasons">
        {score.reasons.map((r, i) => (
          <div key={i} className={`md-reason ${r.includes("✓") ? "pass" : r.includes("✗") ? "fail" : ""}`}>
            {r}
          </div>
        ))}
      </div>

      <style jsx>{`
        .md-view { display: flex; flex-direction: column; gap: 16px; }
        .md-view h3 { margin: 0; font-size: 15px; }
        .md-grid {
          display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
        }
        .md-card {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 20px 24px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 12px;
          min-width: 160px; position: relative;
        }
        .md-card.best { border-color: rgba(55,212,189,.4); background: rgba(55,212,189,.04); }
        .md-card.best-digit {
          background: rgba(154,142,210,.08); border-color: rgba(154,142,210,.3);
          min-width: 100px;
        }
        .md-label { font-size: 14px; font-weight: 700; color: var(--text, #d9e3ed); }
        .md-score { font-size: 32px; font-weight: 700; color: var(--text, #d9e3ed); }
        .md-desc { font-size: 11px; color: var(--muted, #718197); text-align: center; }
        .md-digit { font-size: 48px; font-weight: 700; color: #9a8ed2; }
        .md-digit-label { font-size: 10px; color: var(--muted, #718197); }
        .md-rec {
          position: absolute; top: -10px; right: -10px;
          padding: 3px 8px; background: #37d4bd; color: #0b1420;
          border-radius: 4px; font-size: 9px; font-weight: 700;
        }
        .md-confidence {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--muted, #718197);
        }
        .md-reasons {
          padding: 10px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 8px;
        }
        .md-reason { font-size: 12px; padding: 2px 0; color: #566477; }
        .md-reason.pass { color: #37d4bd; }
        .md-reason.fail { color: #e05555; }
      `}</style>
    </div>
  );
}
