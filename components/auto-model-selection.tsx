"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { IconTrophy, IconRefresh, IconCheck } from "@tabler/icons-react";
import type { TrainingMetrics, PredictionRecord } from "../lib/digit-model";

type ModelSnapshot = {
  id: string;
  timestamp: number;
  metrics: TrainingMetrics;
  winRate: number;
  totalPredictions: number;
  score: number; // composite score for ranking
};

type Props = {
  modelMetrics: TrainingMetrics;
  predictionHistory: PredictionRecord[];
  onResetModel: () => void;
};

const MAX_SNAPSHOTS = 50;
const SNAPSHOT_INTERVAL_MS = 60_000; // snapshot every 60s

export default function AutoModelSelection({ modelMetrics, predictionHistory, onResetModel }: Props) {
  const [snapshots, setSnapshots] = useState<ModelSnapshot[]>([]);
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastSnapshotRef = useRef(0);

  // Auto-snapshot model performance periodically
  useEffect(() => {
    if (!autoSelectEnabled) return;
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastSnapshotRef.current < SNAPSHOT_INTERVAL_MS) return;
      lastSnapshotRef.current = now;

      const validated = predictionHistory.filter((p) => p.actualDigit !== null);
      const wins = validated.filter((p) => p.correct === true).length;
      const winRate = validated.length > 0 ? wins / validated.length : 0;

      // Composite score: weighted combination of accuracy, low loss, and sample count
      const accuracyScore = winRate * 100;
      const lossScore = Math.max(0, 100 - modelMetrics.loss * 1000);
      const sampleBonus = Math.min(validated.length / 10, 20);
      const score = accuracyScore * 0.5 + lossScore * 0.3 + sampleBonus * 0.2;

      const snapshot: ModelSnapshot = {
        id: `snap_${now}`,
        timestamp: now,
        metrics: { ...modelMetrics },
        winRate,
        totalPredictions: validated.length,
        score: Math.round(score * 100) / 100,
      };

      setSnapshots((prev) => {
        const next = [...prev, snapshot].slice(-MAX_SNAPSHOTS);
        return next;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [autoSelectEnabled, modelMetrics, predictionHistory]);

  // Find best snapshot
  const bestSnapshot = snapshots.length > 0
    ? snapshots.reduce((best, s) => s.score > best.score ? s : best)
    : null;

  // Select best model
  const selectBest = useCallback(() => {
    if (!bestSnapshot) return;
    setSelectedId(bestSnapshot.id);
  }, [bestSnapshot]);

  // Clear snapshots
  const clearSnapshots = useCallback(() => {
    setSnapshots([]);
    setSelectedId(null);
  }, []);

  return (
    <div className="ams">
      <div className="ams-header">
        <div>
          <h3>🏆 Auto Model Selection</h3>
          <p className="ams-subtitle">Automatically track and select the best performing model</p>
        </div>
        <label className="ams-toggle">
          <input
            type="checkbox"
            checked={autoSelectEnabled}
            onChange={(e) => setAutoSelectEnabled(e.target.checked)}
          />
          <span>{autoSelectEnabled ? "ON" : "OFF"}</span>
        </label>
      </div>

      {autoSelectEnabled && (
        <>
          {/* Best Model Card */}
          {bestSnapshot && (
            <div className="ams-best">
              <div className="ams-best-header">
                <IconTrophy size={16} color="#f0c040" />
                <span>Best Model Found</span>
                <span className="ams-best-score">{bestSnapshot.score.toFixed(1)} pts</span>
              </div>
              <div className="ams-best-stats">
                <span className="ams-stat">
                  <span className="ams-stat-label">Win Rate</span>
                  <span className={`ams-stat-val ${bestSnapshot.winRate > 0.12 ? "good" : ""}`}>
                    {(bestSnapshot.winRate * 100).toFixed(1)}%
                  </span>
                </span>
                <span className="ams-stat">
                  <span className="ams-stat-label">Loss</span>
                  <span className="ams-stat-val">{bestSnapshot.metrics.loss.toFixed(4)}</span>
                </span>
                <span className="ams-stat">
                  <span className="ams-stat-label">Predictions</span>
                  <span className="ams-stat-val">{bestSnapshot.totalPredictions}</span>
                </span>
                <span className="ams-stat">
                  <span className="ams-stat-label">Epochs</span>
                  <span className="ams-stat-val">{bestSnapshot.metrics.epoch}</span>
                </span>
                <span className="ams-stat">
                  <span className="ams-stat-label">Time</span>
                  <span className="ams-stat-val">{new Date(bestSnapshot.timestamp).toLocaleTimeString()}</span>
                </span>
              </div>
              <div className="ams-best-actions">
                <button className="ams-btn ams-select" onClick={selectBest} disabled={selectedId === bestSnapshot.id}>
                  {selectedId === bestSnapshot.id ? <><IconCheck size={12} /> Selected</> : "Select Best"}
                </button>
                <button className="ams-btn ams-clear" onClick={clearSnapshots}>
                  <IconRefresh size={12} /> Clear History
                </button>
              </div>
            </div>
          )}

          {/* Snapshot History */}
          {snapshots.length > 0 && (
            <div className="ams-history">
              <div className="ams-history-header">
                <span>Snapshot History ({snapshots.length})</span>
              </div>
              <div className="ams-history-list">
                {[...snapshots].reverse().slice(0, 20).map((s) => (
                  <div
                    key={s.id}
                    className={`ams-history-row ${s.id === bestSnapshot?.id ? "best" : ""} ${s.id === selectedId ? "selected" : ""}`}
                  >
                    <span className="ams-hr-time">{new Date(s.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="ams-hr-win">{(s.winRate * 100).toFixed(1)}%</span>
                    <span className="ams-hr-loss">{s.metrics.loss.toFixed(4)}</span>
                    <span className="ams-hr-pred">{s.totalPredictions}</span>
                    <span className={`ams-hr-score ${s.id === bestSnapshot?.id ? "best" : ""}`}>{s.score.toFixed(1)}</span>
                    {s.id === bestSnapshot?.id && <IconTrophy size={10} color="#f0c040" />}
                    {s.id === selectedId && <IconCheck size={10} color="#37d4bd" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {snapshots.length === 0 && (
            <div className="ams-empty">
              <p>Collecting model snapshots... First snapshot in ~60 seconds.</p>
              <p className="ams-empty-sub">Snapshots track win rate, loss, and prediction count to find the optimal model.</p>
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .ams { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px; }
        .ams-header { display: flex; justify-content: space-between; align-items: center; }
        .ams-header h3 { margin: 0; font-size: 15px; }
        .ams-subtitle { font-size: 12px; color: #566477; margin: 0; }

        .ams-toggle {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 6px; font-size: 11px;
          font-weight: 700; cursor: pointer; transition: 0.15s;
          background: rgba(240,192,64,.1); border: 1px solid rgba(240,192,64,.3); color: #f0c040;
        }
        .ams-toggle input { accent-color: #f0c040; }

        .ams-best {
          padding: 12px 14px; background: rgba(240,192,64,.04);
          border: 1px solid rgba(240,192,64,.2); border-radius: 8px;
        }
        .ams-best-header {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 8px; font-size: 13px; font-weight: 600; color: #f0c040;
        }
        .ams-best-score { margin-left: auto; font-size: 14px; font-weight: 700; }
        .ams-best-stats { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
        .ams-stat { display: flex; flex-direction: column; gap: 2px; }
        .ams-stat-label { font-size: 9px; color: #566477; text-transform: uppercase; }
        .ams-stat-val { font-size: 12px; font-weight: 700; color: #d9e3ed; font-family: monospace; }
        .ams-stat-val.good { color: #37d4bd; }
        .ams-best-actions { display: flex; gap: 8px; }

        .ams-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 5px 10px; border-radius: 5px; font-size: 11px;
          font-weight: 600; cursor: pointer; border: none; transition: 0.15s;
        }
        .ams-select { background: rgba(55,212,189,.12); color: #37d4bd; border: 1px solid rgba(55,212,189,.3); }
        .ams-select:hover { background: rgba(55,212,189,.2); }
        .ams-select:disabled { opacity: 0.4; cursor: not-allowed; }
        .ams-clear { background: transparent; color: #566477; border: 1px solid rgba(255,255,255,.1); }
        .ams-clear:hover { color: #d9e3ed; }

        .ams-history { display: flex; flex-direction: column; gap: 4px; }
        .ams-history-header { font-size: 11px; color: #566477; text-transform: uppercase; }
        .ams-history-list { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow-y: auto; }
        .ams-history-row {
          display: flex; align-items: center; gap: 12px; padding: 4px 8px;
          border-radius: 4px; font-size: 11px; font-family: monospace;
        }
        .ams-history-row:hover { background: rgba(255,255,255,.03); }
        .ams-history-row.best { background: rgba(240,192,64,.06); }
        .ams-history-row.selected { background: rgba(55,212,189,.06); }
        .ams-hr-time { color: #566477; width: 80px; }
        .ams-hr-win { color: #d9e3ed; width: 50px; }
        .ams-hr-loss { color: #718197; width: 70px; }
        .ams-hr-pred { color: #566477; width: 40px; }
        .ams-hr-score { color: #d9e3ed; font-weight: 700; }
        .ams-hr-score.best { color: #f0c040; }

        .ams-empty { padding: 20px; text-align: center; color: #566477; font-size: 12px; }
        .ams-empty p { margin: 4px 0; }
        .ams-empty-sub { font-size: 11px; }
      `}</style>
    </div>
  );
}
