"use client";

import { useMemo, useState } from "react";
import {
  IconBrain, IconTarget, IconTrendingUp, IconTrendingDown,
  IconChartBar, IconActivity, IconClock,
} from "@tabler/icons-react";
import type {
  TrainingMetrics,
  OnlineLearningMetrics,
  EpochProgress,
  ProbSnapshot,
} from "../lib/digit-model";
import type { MarketScore } from "../lib/market-analyzer";
import TrainingChart from "./training-chart";
import ConfusionMatrix from "./confusion-matrix";
import ProbDistChart from "./prob-dist-chart";

type Props = {
  modelStatus: string;
  modelMetrics: TrainingMetrics;
  onlineMetrics: OnlineLearningMetrics;
  bufferSize: number;
  scores: MarketScore[];
  accuracy: { total: number; correct: number; rate: number };
  recentAccuracy: { total: number; correct: number; rate: number };
  epochHistory: EpochProgress[];
  gradNormHistory: { timestamp: number; gradNorm: number; loss: number; lr: number }[];
  predictionHistory: import("../lib/digit-model").PredictionRecord[];
  probHistory: ProbSnapshot[];
  onTrainNow: () => void;
  onReset: () => void;
};

export default function UnifiedDashboard({
  modelStatus,
  modelMetrics,
  onlineMetrics,
  bufferSize,
  scores,
  accuracy,
  recentAccuracy,
  epochHistory,
  gradNormHistory,
  predictionHistory,
  probHistory,
  onTrainNow,
  onReset,
}: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>("overview");

  const toggle = (s: string) => setExpandedSection(expandedSection === s ? null : s);

  // Compute derived stats
  const bestMarket = scores.length > 0 ? scores[0] : null;
  const avgScore = scores.length > 0 ? scores.reduce((s, m) => s + m.overallScore, 0) / scores.length : 0;
  const strongMarkets = scores.filter((s) => s.overallScore >= 60).length;
  const modelReady = modelStatus === "ready" || modelStatus === "training";

  // Compute P&L simulation stats from prediction history
  const tradeStats = useMemo(() => {
    const validated = predictionHistory.filter((p) => p.actualDigit !== null);
    const wins = validated.filter((p) => p.correct === true).length;
    const losses = validated.filter((p) => p.correct === false).length;
    const winRate = validated.length > 0 ? (wins / validated.length) * 100 : 0;

    // Simulated P&L (assuming $1 stake per prediction)
    const stake = 1;
    const payoutMultiplier = 9; // typical binary option payout
    const profit = wins * (stake * (payoutMultiplier - 1)) - losses * stake;
    const roi = validated.length > 0 ? (profit / (validated.length * stake)) * 100 : 0;

    return { wins, losses, total: validated.length, winRate, profit, roi };
  }, [predictionHistory]);

  // Recent trend (last 50 predictions vs previous 50)
  const trend = useMemo(() => {
    const recent50 = predictionHistory.slice(-50).filter((p) => p.actualDigit !== null);
    const prev50 = predictionHistory.slice(-100, -50).filter((p) => p.actualDigit !== null);
    const recentAcc = recent50.length > 0 ? recent50.filter((p) => p.correct).length / recent50.length : 0;
    const prevAcc = prev50.length > 0 ? prev50.filter((p) => p.correct).length / prev50.length : 0;
    return { recentAcc, prevAcc, delta: recentAcc - prevAcc, improving: recentAcc > prevAcc };
  }, [predictionHistory]);

  return (
    <div className="dash">
      {/* Hero Stats Row */}
      <div className="dash-hero">
        <HeroCard
          icon={<IconBrain size={18} />}
          label="Model Status"
          value={modelStatus === "training" ? "⚡ Training" : modelStatus === "ready" ? "✓ Ready" : modelStatus}
          color={modelStatus === "ready" ? "#37d4bd" : modelStatus === "training" ? "#f0c040" : "#718197"}
        />
        <HeroCard
          icon={<IconTarget size={18} />}
          label="Rolling Accuracy"
          value={onlineMetrics.rollingTotal > 0 ? `${(onlineMetrics.rollingAccuracy * 100).toFixed(1)}%` : "—"}
          sub={`${onlineMetrics.rollingCorrect}/${onlineMetrics.rollingTotal}`}
          color={onlineMetrics.rollingAccuracy > 0.12 ? "#37d4bd" : onlineMetrics.rollingAccuracy > 0 ? "#f0c040" : "#718197"}
        />
        <HeroCard
          icon={<IconTrendingUp size={18} />}
          label="Trade P&L"
          value={`$${tradeStats.profit.toFixed(2)}`}
          sub={`${tradeStats.wins}W / ${tradeStats.losses}L`}
          color={tradeStats.profit > 0 ? "#37d4bd" : tradeStats.profit < 0 ? "#e05555" : "#718197"}
        />
        <HeroCard
          icon={<IconChartBar size={18} />}
          label="Best Market"
          value={bestMarket ? bestMarket.name : "—"}
          sub={bestMarket ? `Score: ${bestMarket.overallScore}` : ""}
          color="#9a8ed2"
        />
        <HeroCard
          icon={<IconActivity size={18} />}
          label="Samples"
          value={bufferSize.toLocaleString()}
          sub={`${modelMetrics.epoch} epochs`}
          color="#3ca8e0"
        />
        <HeroCard
          icon={<IconActivity size={18} />}
          label="Online Updates"
          value={onlineMetrics.onlineUpdates.toLocaleString()}
          sub={`${onlineMetrics.totalPredictions} predictions`}
          color="#f0c040"
        />
      </div>

      {/* Quick Stats Bar */}
      <div className="dash-quick-bar">
        <div className="qb-item">
          <span className="qb-label">Win Rate</span>
          <span className={`qb-val ${tradeStats.winRate >= 50 ? "good" : "bad"}`}>{tradeStats.winRate.toFixed(1)}%</span>
        </div>
        <div className="qb-item">
          <span className="qb-label">ROI</span>
          <span className={`qb-val ${tradeStats.roi >= 0 ? "good" : "bad"}`}>{tradeStats.roi.toFixed(1)}%</span>
        </div>
        <div className="qb-item">
          <span className="qb-label">Avg Market Score</span>
          <span className={`qb-val ${avgScore >= 50 ? "good" : ""}`}>{avgScore.toFixed(0)}/100</span>
        </div>
        <div className="qb-item">
          <span className="qb-label">Strong Markets</span>
          <span className="qb-val">{strongMarkets}/{scores.length}</span>
        </div>
        <div className="qb-item">
          <span className="qb-label">Trend</span>
          <span className={`qb-val ${trend.improving ? "good" : "bad"}`}>
            {trend.delta >= 0 ? "↑" : "↓"} {(Math.abs(trend.delta) * 100).toFixed(1)}%
          </span>
        </div>
        <div className="qb-item">
          <span className="qb-label">Loss</span>
          <span className="qb-val">{modelMetrics.loss.toFixed(4)}</span>
        </div>
        <div className="qb-item">
          <span className="qb-label">Grad Norm</span>
          <span className={`qb-val ${modelMetrics.lastGradNorm > 1 ? "bad" : ""}`}>{modelMetrics.lastGradNorm > 0 ? modelMetrics.lastGradNorm.toFixed(3) : "—"}</span>
        </div>
        <div className="qb-item">
          <span className="qb-label">Weight Div.</span>
          <span className={`qb-val ${modelMetrics.weightDivergence > 1 ? "bad" : ""}`}>{modelMetrics.weightDivergence > 0 ? modelMetrics.weightDivergence.toFixed(4) : "—"}</span>
        </div>
      </div>

      {/* Collapsible Sections */}
      <div className="dash-sections">
        {/* Training Progress */}
        <Section
          title="Training Progress"
          icon={<IconActivity size={14} />}
          expanded={expandedSection === "training" || expandedSection === "overview"}
          onToggle={() => toggle("training")}
        >
          <TrainingChart modelMetrics={modelMetrics} onlineMetrics={onlineMetrics} epochHistory={epochHistory} gradNormHistory={gradNormHistory} />
        </Section>

        {/* Confusion Matrix */}
        <Section
          title="Confusion Matrix"
          icon={<IconTarget size={14} />}
          expanded={expandedSection === "confusion"}
          onToggle={() => toggle("confusion")}
        >
          <ConfusionMatrix predictionHistory={predictionHistory} />
        </Section>

        {/* Probability Distribution */}
        <Section
          title="Probability Distribution"
          icon={<IconChartBar size={14} />}
          expanded={expandedSection === "probs"}
          onToggle={() => toggle("probs")}
        >
          <ProbDistChart probHistory={probHistory} />
        </Section>

        {/* Market Rankings */}
        <Section
          title="Market Rankings"
          icon={<IconTrendingUp size={14} />}
          expanded={expandedSection === "markets" || expandedSection === "overview"}
          onToggle={() => toggle("markets")}
        >
          <div className="market-rank-list">
            {scores.map((s, i) => (
              <div key={s.symbol} className="market-rank-row">
                <span className="mr-num">#{i + 1}</span>
                <span className="mr-name">{s.name}</span>
                <div className="mr-bar-wrap">
                  <div
                    className="mr-bar"
                    style={{
                      width: `${s.overallScore}%`,
                      background: s.overallScore >= 60 ? "#37d4bd" : s.overallScore >= 40 ? "#f0c040" : "#e05555",
                    }}
                  />
                </div>
                <span className={`mr-score ${s.overallScore >= 60 ? "good" : s.overallScore < 30 ? "bad" : ""}`}>{s.overallScore}</span>
                {s.bestTrade && (
                  <span className="mr-best">{s.bestTrade.direction.toUpperCase()} {s.bestTrade.digit}</span>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* Controls */}
        <Section
          title="Controls"
          icon={<IconClock size={14} />}
          expanded={expandedSection === "controls"}
          onToggle={() => toggle("controls")}
        >
          <div className="dash-controls">
            <button className="dc-btn dc-primary" onClick={onTrainNow} disabled={modelStatus !== "ready" || bufferSize < 10}>
              🧠 Train Now
            </button>
            <button className="dc-btn dc-danger" onClick={onReset}>
              🔄 Reset Model
            </button>
            <span className="dc-hint">
              {bufferSize < 200 ? `Need ${200 - bufferSize} more samples` : "Model ready"}
            </span>
          </div>
        </Section>
      </div>

      <style jsx>{`
        .dash { display: flex; flex-direction: column; gap: 12px; }

        .dash-hero {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 8px;
        }

        .dash-quick-bar {
          display: flex; flex-wrap: wrap; gap: 8px 20px;
          padding: 12px 16px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
        }
        .qb-item { display: flex; align-items: center; gap: 6px; }
        .qb-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .qb-val { font-size: 13px; font-weight: 700; color: #d9e3ed; font-family: monospace; }
        .qb-val.good { color: #37d4bd; }
        .qb-val.bad { color: #e05555; }

        .dash-sections { display: flex; flex-direction: column; gap: 8px; }

        .market-rank-list { display: flex; flex-direction: column; gap: 6px; }
        .market-rank-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: rgba(255,255,255,.02);
          border-radius: 6px;
        }
        .mr-num { font-size: 11px; color: #566477; width: 24px; font-weight: 600; }
        .mr-name { font-size: 13px; color: #d9e3ed; flex: 1; font-weight: 500; }
        .mr-bar-wrap { width: 100px; height: 4px; background: #1a2332; border-radius: 2px; }
        .mr-bar { height: 100%; border-radius: 2px; transition: width 0.5s; }
        .mr-score { font-size: 14px; font-weight: 700; width: 36px; text-align: right; }
        .mr-score.good { color: #37d4bd; }
        .mr-score.bad { color: #e05555; }
        .mr-best { font-size: 10px; color: #9a8ed2; font-family: monospace; white-space: nowrap; }

        .dash-controls {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .dc-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 8px; font-size: 13px;
          font-weight: 600; cursor: pointer; transition: 0.15s; border: none;
        }
        .dc-primary { background: linear-gradient(135deg, #9a8ed2, #7c6fc0); color: #fff; }
        .dc-primary:hover { box-shadow: 0 4px 16px rgba(154,142,210,.3); }
        .dc-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .dc-danger { background: transparent; border: 1px solid #e05555; color: #e05555; }
        .dc-danger:hover { background: rgba(224,85,85,.1); }
        .dc-hint { font-size: 11px; color: #566477; }
      `}</style>
    </div>
  );
}

/* ---- Subcomponents ---- */

function HeroCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="hero-card">
      <div className="hc-icon" style={{ color }}>{icon}</div>
      <div className="hc-content">
        <span className="hc-label">{label}</span>
        <span className="hc-value" style={{ color }}>{value}</span>
        {sub && <span className="hc-sub">{sub}</span>}
      </div>
      <style jsx>{`
        .hero-card {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
        }
        .hc-icon { flex-shrink: 0; }
        .hc-content { display: flex; flex-direction: column; min-width: 0; }
        .hc-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .hc-value { font-size: 16px; font-weight: 700; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hc-sub { font-size: 10px; color: #718197; }
      `}</style>
    </div>
  );
}

function Section({ title, icon, expanded, onToggle, children }: {
  title: string; icon: React.ReactNode; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`section ${expanded ? "open" : ""}`}>
      <button className="section-header" onClick={onToggle}>
        <span className="section-icon">{icon}</span>
        <span className="section-title">{title}</span>
        <span className="section-chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && <div className="section-body">{children}</div>}
      <style jsx>{`
        .section {
          background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px;
          overflow: hidden;
        }
        .section-header {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 12px 14px; background: transparent; border: none;
          color: #d9e3ed; cursor: pointer; font-size: 13px; font-weight: 600;
          transition: background 0.15s;
        }
        .section-header:hover { background: rgba(255,255,255,.03); }
        .section-icon { color: #9a8ed2; }
        .section-title { flex: 1; text-align: left; }
        .section-chevron { color: #566477; font-size: 12px; }
        .section-body { padding: 0 14px 14px; }
      `}</style>
    </div>
  );
}
