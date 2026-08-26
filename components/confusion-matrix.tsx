"use client";

import { useState, useEffect, useRef } from "react";
import type { PredictionRecord } from "../lib/digit-model";

type Props = {
  predictionHistory: PredictionRecord[];
};

export default function ConfusionMatrix({ predictionHistory }: Props) {
  const [matrix, setMatrix] = useState<number[][]>(() =>
    Array.from({ length: 10 }, () => new Array(10).fill(0)),
  );
  const prevLenRef = useRef(0);

  // Update matrix incrementally when new predictions arrive
  useEffect(() => {
    if (predictionHistory.length <= prevLenRef.current) return;

    setMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      for (let i = prevLenRef.current; i < predictionHistory.length; i++) {
        const pred = predictionHistory[i];
        if (pred.actualDigit !== null && pred.correct !== null) {
          next[pred.actualDigit][pred.topDigit]++;
        }
      }
      return next;
    });
    prevLenRef.current = predictionHistory.length;
  }, [predictionHistory]);

  // Compute stats
  const totalPredictions = matrix.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  const correctPredictions = matrix.reduce((sum, row, i) => sum + row[i], 0);
  const overallAccuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;

  // Per-digit accuracy
  const digitAccuracy = Array.from({ length: 10 }, (_, d) => {
    const rowTotal = matrix[d].reduce((s, v) => s + v, 0);
    return rowTotal > 0 ? matrix[d][d] / rowTotal : 0;
  });

  // Find max value for normalization
  const maxVal = Math.max(...matrix.flat(), 1);

  if (totalPredictions === 0) {
    return (
      <div className="cm-container">
        <div className="cm-header">
          <h4>🎯 Confusion Matrix</h4>
          <span className="cm-subtitle">Live — updates as predictions are validated</span>
        </div>
        <div className="cm-empty">
          <p>No validated predictions yet. Start streaming to populate.</p>
        </div>
        <style jsx>{`
          .cm-container { padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
          .cm-header { display: flex; justify-content: space-between; align-items: center; }
          .cm-header h4 { margin: 0; font-size: 14px; color: #d9e3ed; }
          .cm-subtitle { font-size: 10px; color: #566477; }
          .cm-empty { padding: 30px; text-align: center; color: #566477; font-size: 12px; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="cm-container">
      <div className="cm-header">
        <h4>🎯 Confusion Matrix</h4>
        <div className="cm-stats">
          <span className="cm-stat">
            <span className="cm-stat-label">Accuracy</span>
            <span className={`cm-stat-value ${overallAccuracy > 0.12 ? "good" : ""}`}>{(overallAccuracy * 100).toFixed(1)}%</span>
          </span>
          <span className="cm-stat">
            <span className="cm-stat-label">Predictions</span>
            <span className="cm-stat-value">{totalPredictions}</span>
          </span>
        </div>
      </div>

      <div className="cm-grid-wrap">
        {/* Column headers (predicted) */}
        <div className="cm-corner">
          <span className="cm-axis-label">A↓ P→</span>
        </div>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={`col-${i}`} className="cm-col-header">{i}</div>
        ))}

        {/* Rows */}
        {matrix.map((row, actual) => {
          const rowTotal = row.reduce((s, v) => s + v, 0);
          return (
            <div key={`row-${actual}`} className="cm-row">
              <div className="cm-row-header">{actual}</div>
              {row.map((val, predicted) => {
                const isDiag = actual === predicted;
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const hasData = val > 0;
                return (
                  <div
                    key={`${actual}-${predicted}`}
                    className={`cm-cell ${isDiag ? "diag" : ""} ${hasData ? "has-data" : ""}`}
                    style={{
                      background: isDiag
                        ? `rgba(55,212,189,${0.1 + intensity * 0.6})`
                        : hasData
                        ? `rgba(224,85,85,${0.05 + intensity * 0.3})`
                        : "transparent",
                      color: intensity > 0.4 ? "#fff" : "#566477",
                    }}
                    title={`Actual: ${actual}, Predicted: ${predicted} — ${val} (${rowTotal > 0 ? ((val / rowTotal) * 100).toFixed(0) : 0}%)`}
                  >
                    {val || ""}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Per-digit accuracy bar */}
      <div className="cm-digit-accuracy">
        <span className="cm-da-label">Per-Digit Accuracy:</span>
        <div className="cm-da-bars">
          {digitAccuracy.map((acc, d) => (
            <div key={d} className="cm-da-item">
              <div className="cm-da-bar-wrap">
                <div
                  className="cm-da-bar"
                  style={{
                    height: `${Math.max(3, acc * 100)}%`,
                    background: acc > 0.12 ? "#37d4bd" : acc > 0.08 ? "#f0c040" : "#e05555",
                  }}
                />
              </div>
              <span className="cm-da-digit">{d}</span>
              <span className="cm-da-pct">{(acc * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .cm-container {
          padding: 12px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .cm-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .cm-header h4 { margin: 0; font-size: 14px; color: #d9e3ed; }
        .cm-stats { display: flex; gap: 16px; }
        .cm-stat { display: flex; align-items: baseline; gap: 6px; }
        .cm-stat-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .cm-stat-value { font-size: 14px; font-weight: 700; color: #d9e3ed; font-family: monospace; }
        .cm-stat-value.good { color: #37d4bd; }

        .cm-grid-wrap {
          display: grid;
          grid-template-columns: 28px repeat(10, 1fr);
          gap: 2px;
        }
        .cm-corner {
          display: flex; align-items: center; justify-content: center;
          font-size: 8px; color: #566477;
        }
        .cm-axis-label { font-size: 8px; color: #566477; }
        .cm-col-header {
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #718197; padding: 4px 0;
        }
        .cm-row-header {
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #718197;
          padding: 0 4px;
        }
        .cm-cell {
          display: flex; align-items: center; justify-content: center;
          aspect-ratio: 1; border-radius: 3px;
          font-size: 10px; font-weight: 600; font-family: monospace;
          transition: background 0.3s;
          min-height: 24px;
        }
        .cm-cell.diag { font-weight: 800; }

        .cm-digit-accuracy {
          display: flex; flex-direction: column; gap: 6px;
          padding-top: 8px; border-top: 1px solid #1e2d3d;
        }
        .cm-da-label { font-size: 11px; color: #718197; }
        .cm-da-bars { display: flex; gap: 4px; align-items: flex-end; height: 60px; }
        .cm-da-item {
          flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%;
        }
        .cm-da-bar-wrap {
          flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center;
        }
        .cm-da-bar {
          width: 80%; border-radius: 2px 2px 0 0; transition: height 0.3s;
        }
        .cm-da-digit { font-size: 10px; font-weight: 700; color: #d9e3ed; }
        .cm-da-pct { font-size: 8px; color: #566477; }
      `}</style>
    </div>
  );
}
