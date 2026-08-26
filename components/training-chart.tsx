"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { TrainingMetrics, OnlineLearningMetrics, EpochProgress } from "../lib/digit-model";

/* ---- Types ---- */

type DataPoint = {
  timestamp: number;
  loss: number;
  accuracy: number;
  rollingAccuracy: number;
  epoch: number;
  samplesTrained: number;
};

type Props = {
  modelMetrics: TrainingMetrics;
  onlineMetrics: OnlineLearningMetrics;
  epochHistory: EpochProgress[];
};

const MAX_POINTS = 200;
const CHART_W = 600;
const CHART_H = 200;
const PAD = { top: 10, right: 50, bottom: 30, left: 55 };
const INNER_W = CHART_W - PAD.left - PAD.right;
const INNER_H = CHART_H - PAD.top - PAD.bottom;

/* ---- Helpers ---- */

function svgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const cpx1 = prev.x + (cur.x - prev.x) * 0.4;
    const cpx2 = cur.x - (cur.x - prev.x) * 0.4;
    d += ` C ${cpx1} ${prev.y} ${cpx2} ${cur.y} ${cur.x} ${cur.y}`;
  }
  return d;
}

function svgArea(points: { x: number; y: number }[], baseY: number): string {
  if (points.length === 0) return "";
  const line = svgPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;
}

/* ---- Epoch Chart ---- */

function EpochChart({ epochHistory }: { epochHistory: EpochProgress[] }) {
  if (epochHistory.length === 0) return null;

  const W = CHART_W;
  const H = 240;
  const P = { top: 15, right: 50, bottom: 35, left: 55 };
  const IW = W - P.left - P.right;
  const IH = H - P.top - P.bottom;

  const maxLoss = Math.max(...epochHistory.map((e) => e.loss), 0.01);
  const maxAcc = Math.max(...epochHistory.map((e) => Math.max(e.accuracy, e.valAccuracy)), 0.1);

  const barWidth = Math.min(40, Math.max(8, (IW / epochHistory.length) * 0.6));
  const gap = Math.min(20, Math.max(2, (IW - barWidth * epochHistory.length) / (epochHistory.length + 1)));

  function xScale(i: number): number {
    return P.left + gap + i * (barWidth + gap) + barWidth / 2;
  }
  function yLoss(v: number): number {
    return P.top + IH - (v / maxLoss) * IH;
  }
  function yAcc(v: number): number {
    return P.top + IH - (v / maxAcc) * IH;
  }

  const lossBars = epochHistory.map((e, i) => ({
    x: xScale(i) - barWidth / 2,
    y: yLoss(e.loss),
    h: (e.loss / maxLoss) * IH,
    loss: e.loss,
    epoch: e.epoch,
  }));

  const accLine = epochHistory.map((e, i) => ({ x: xScale(i), y: yAcc(e.accuracy) }));
  const valAccLine = epochHistory.map((e, i) => ({ x: xScale(i), y: yAcc(e.valAccuracy) }));

  const latest = epochHistory[epochHistory.length - 1];
  const lossTicks = 5;
  const lossTickValues = Array.from({ length: lossTicks + 1 }, (_, i) => (i / lossTicks) * maxLoss);

  return (
    <div className="epoch-chart-container">
      <div className="epoch-chart-header">
        <h4>📊 Epoch-by-Epoch Training</h4>
        <div className="epoch-chart-legend">
          <span className="legend-item"><span className="legend-dot" style={{ background: "#e05555" }} /> Train Loss</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: "#37d4bd" }} /> Train Acc</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: "#f0c040" }} /> Val Acc</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: "#9a8ed2", borderRadius: 0, width: 12, height: 3 }} /> Val Loss</span>
        </div>
      </div>

      <div className="epoch-chart-svg-wrap">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="epochLossGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e05555" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#e05555" stopOpacity={0.2} />
            </linearGradient>
          </defs>

          {/* Left axis (loss) */}
          {lossTickValues.map((v, i) => (
            <g key={`el-${i}`}>
              <line x1={P.left} y1={yLoss(v)} x2={P.left + IW} y2={yLoss(v)} stroke="#1e2d3d" strokeWidth={0.5} strokeDasharray={i === 0 ? "" : "2 4"} />
              <text x={P.left - 6} y={yLoss(v) + 3} textAnchor="end" fill="#e05555" fontSize={9} opacity={0.7}>{v.toFixed(3)}</text>
            </g>
          ))}

          {/* Right axis (accuracy) */}
          {[0, 0.05, 0.1, 0.15, 0.2].filter(v => v <= maxAcc * 1.1).map((v) => (
            <g key={`ar-${v}`}>
              <text x={P.left + IW + 6} y={yAcc(v) + 3} textAnchor="start" fill="#37d4bd" fontSize={9} opacity={0.7}>{(v * 100).toFixed(0)}%</text>
            </g>
          ))}

          {/* Loss bars */}
          {lossBars.map((b, i) => (
            <g key={`bar-${i}`}>
              <rect x={b.x} y={b.y} width={barWidth} height={Math.max(1, b.h)} fill="url(#epochLossGrad)" rx={2} />
              <text x={b.x + barWidth / 2} y={P.top + IH + 14} textAnchor="middle" fill="#566477" fontSize={8}>
                {b.epoch}
              </text>
            </g>
          ))}

          {/* Accuracy line (train) */}
          {accLine.length > 1 && (
            <>
              <path d={svgArea(accLine, P.top + IH)} fill="rgba(55,212,189,0.08)" />
              <path d={svgPath(accLine)} fill="none" stroke="#37d4bd" strokeWidth={2} />
            </>
          )}

          {/* Validation accuracy line */}
          {valAccLine.length > 1 && (
            <path d={svgPath(valAccLine)} fill="none" stroke="#f0c040" strokeWidth={1.5} strokeDasharray="4 2" />
          )}

          {/* Dots on latest points */}
          {accLine.length > 0 && (
            <>
              <circle cx={accLine[accLine.length - 1].x} cy={accLine[accLine.length - 1].y} r={3} fill="#37d4bd" stroke="#0c141f" strokeWidth={1.5} />
              {valAccLine.length > 0 && (
                <circle cx={valAccLine[valAccLine.length - 1].x} cy={valAccLine[valAccLine.length - 1].y} r={3} fill="#f0c040" stroke="#0c141f" strokeWidth={1.5} />
              )}
            </>
          )}

          {/* X-axis label */}
          <text x={P.left + IW / 2} y={H - 4} textAnchor="middle" fill="#566477" fontSize={9}>Epoch →</text>
        </svg>
      </div>

      {/* Epoch readouts */}
      {latest && (
        <div className="epoch-readouts">
          <div className="epoch-readout">
            <span className="er-label">Epoch</span>
            <span className="er-value purple">{latest.epoch}/{latest.totalEpochs}</span>
          </div>
          <div className="epoch-readout">
            <span className="er-label">Train Loss</span>
            <span className="er-value red">{latest.loss.toFixed(4)}</span>
          </div>
          <div className="epoch-readout">
            <span className="er-label">Train Acc</span>
            <span className="er-value green">{(latest.accuracy * 100).toFixed(1)}%</span>
          </div>
          <div className="epoch-readout">
            <span className="er-label">Val Loss</span>
            <span className="er-value yellow">{latest.valLoss.toFixed(4)}</span>
          </div>
          <div className="epoch-readout">
            <span className="er-label">Val Acc</span>
            <span className="er-value yellow">{(latest.valAccuracy * 100).toFixed(1)}%</span>
          </div>
          <div className="epoch-readout">
            <span className="er-label">Samples</span>
            <span className="er-value muted">{latest.samplesInBatch.toLocaleString()}</span>
          </div>
        </div>
      )}

      <style jsx>{`
        .epoch-chart-container {
          padding: 12px 14px;
          background: #0c141f;
          border: 1px solid var(--border, #2a3444);
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .epoch-chart-header {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 8px;
        }
        .epoch-chart-header h4 { margin: 0; font-size: 14px; color: var(--text, #d9e3ed); }
        .epoch-chart-legend { display: flex; gap: 14px; flex-wrap: wrap; }
        .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #718197; }
        .legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .epoch-chart-svg-wrap svg { width: 100%; height: auto; overflow: visible; }

        .epoch-readouts {
          display: flex; gap: 16px; flex-wrap: wrap;
          padding: 8px 0 0; border-top: 1px solid #1e2d3d;
        }
        .epoch-readout { display: flex; align-items: baseline; gap: 6px; }
        .er-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .er-value { font-size: 14px; font-weight: 700; font-family: monospace; }
        .er-value.red { color: #e05555; }
        .er-value.green { color: #37d4bd; }
        .er-value.yellow { color: #f0c040; }
        .er-value.purple { color: #9a8ed2; }
        .er-value.muted { color: #718197; }
      `}</style>
    </div>
  );
}

/* ---- Main Training Chart (time-series) ---- */

export default function TrainingChart({ modelMetrics, onlineMetrics, epochHistory }: Props) {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const lastRecordRef = useRef({ epoch: -1, loss: -1, rollingAcc: -1, samples: -1 });
  const lastUpdateRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);

  // Record a data point whenever metrics change
  const recordPoint = useCallback(() => {
    const now = Date.now();
    if (now - lastUpdateRef.current < 3000) return;

    const prev = lastRecordRef.current;
    const lossChanged = modelMetrics.loss !== prev.loss || modelMetrics.epoch !== prev.epoch;
    const accChanged = onlineMetrics.rollingAccuracy !== prev.rollingAcc;
    const samplesChanged = modelMetrics.samplesTrained !== prev.samples;
    const isFirst = history.length === 0;
    if (!isFirst && !lossChanged && !accChanged && !samplesChanged) return;

    lastUpdateRef.current = now;
    lastRecordRef.current = { epoch: modelMetrics.epoch, loss: modelMetrics.loss, rollingAcc: onlineMetrics.rollingAccuracy, samples: modelMetrics.samplesTrained };

    setHistory((prevHist) => {
      const point: DataPoint = {
        timestamp: now,
        loss: modelMetrics.loss,
        accuracy: modelMetrics.accuracy,
        rollingAccuracy: onlineMetrics.rollingAccuracy,
        epoch: modelMetrics.epoch,
        samplesTrained: modelMetrics.samplesTrained,
      };
      const next = [...prevHist, point];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  }, [modelMetrics.loss, modelMetrics.accuracy, modelMetrics.epoch, modelMetrics.samplesTrained, onlineMetrics.rollingAccuracy]);

  useEffect(() => { recordPoint(); }, [recordPoint]);

  const hasData = history.length > 1;
  const maxLoss = hasData ? Math.max(...history.map((p) => p.loss), 0.01) : 1;
  const maxAcc = 1;

  function scaleX(i: number): number {
    if (history.length <= 1) return PAD.left + INNER_W / 2;
    return PAD.left + (i / (history.length - 1)) * INNER_W;
  }
  function scaleYLoss(loss: number): number { return PAD.top + INNER_H - (loss / maxLoss) * INNER_H; }
  function scaleYAcc(acc: number): number { return PAD.top + INNER_H - (acc / maxAcc) * INNER_H; }

  const lossPoints = history.map((p, i) => ({ x: scaleX(i), y: scaleYLoss(p.loss) }));
  const accPoints = history.map((p, i) => ({ x: scaleX(i), y: scaleYAcc(p.rollingAccuracy) }));
  const batchAccPoints = history.map((p, i) => ({ x: scaleX(i), y: scaleYAcc(p.accuracy) }));

  const latest = history[history.length - 1];
  const prevLoss = history.length >= 2 ? history[history.length - 2].loss : latest?.loss ?? 0;
  const lossDelta = latest ? latest.loss - prevLoss : 0;

  const lossTicks = 5;
  const lossTickValues = Array.from({ length: lossTicks + 1 }, (_, i) => (i / lossTicks) * maxLoss);
  const accTicks = 5;
  const accTickValues = Array.from({ length: accTicks + 1 }, (_, i) => (i / accTicks) * maxAcc);

  return (
    <div className="training-chart-wrapper">
      {/* Time-series chart */}
      <div className="training-chart-container">
        <div className="training-chart-header">
          <h4>📈 Training Progress (Live)</h4>
          <div className="training-chart-legend">
            <span className="legend-item"><span className="legend-dot" style={{ background: "#e05555" }} /> Loss</span>
            <span className="legend-item"><span className="legend-dot" style={{ background: "#37d4bd" }} /> Rolling Accuracy</span>
            <span className="legend-item"><span className="legend-dot" style={{ background: "#9a8ed2" }} /> Batch Accuracy</span>
          </div>
        </div>

        {!hasData ? (
          <div className="training-chart-empty">
            <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              <line x1={PAD.left} y1={PAD.top + INNER_H} x2={PAD.left + INNER_W} y2={PAD.top + INNER_H} stroke="#1e2d3d" strokeWidth={1} />
              <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + INNER_H} stroke="#1e2d3d" strokeWidth={1} />
              <text x={PAD.left + INNER_W / 2} y={PAD.top + INNER_H / 2 - 10} textAnchor="middle" fill="#566477" fontSize={13}>
                Waiting for training data...
              </text>
              <text x={PAD.left + INNER_W / 2} y={PAD.top + INNER_H / 2 + 12} textAnchor="middle" fill="#3a4d62" fontSize={11}>
                Chart will plot once metrics change
              </text>
              <line x1={PAD.left} y1={scaleYAcc(0.1)} x2={PAD.left + INNER_W} y2={scaleYAcc(0.1)} stroke="#1e2d3d" strokeWidth={1} strokeDasharray="4 4" />
              <text x={PAD.left + INNER_W + 6} y={scaleYAcc(0.1) + 3} fill="#3a4d62" fontSize={8}>10%</text>
              <text x={PAD.left + INNER_W / 2} y={CHART_H - 6} textAnchor="middle" fill="#3a4d62" fontSize={9}>Time →</text>
            </svg>
          </div>
        ) : (
          <div className="training-chart-svg-wrap">
            <svg ref={svgRef} width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              <defs>
                <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e05555" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#e05555" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#37d4bd" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#37d4bd" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              {lossTickValues.map((v, i) => (
                <g key={`loss-${i}`}>
                  <line x1={PAD.left} y1={scaleYLoss(v)} x2={PAD.left + INNER_W} y2={scaleYLoss(v)} stroke="#1e2d3d" strokeWidth={0.5} strokeDasharray={i === 0 ? "" : "2 4"} />
                  <text x={PAD.left - 6} y={scaleYLoss(v) + 3} textAnchor="end" fill="#e05555" fontSize={9} opacity={0.7}>{v.toFixed(3)}</text>
                </g>
              ))}
              {accTickValues.map((v, i) => (
                <g key={`acc-${i}`}>
                  <text x={PAD.left + INNER_W + 6} y={scaleYAcc(v) + 3} textAnchor="start" fill="#37d4bd" fontSize={9} opacity={0.7}>{(v * 100).toFixed(0)}%</text>
                </g>
              ))}
              <line x1={PAD.left} y1={scaleYAcc(0.1)} x2={PAD.left + INNER_W} y2={scaleYAcc(0.1)} stroke="#566477" strokeWidth={0.5} strokeDasharray="6 3" opacity={0.4} />
              <text x={PAD.left + INNER_W + 6} y={scaleYAcc(0.1) + 3} fill="#566477" fontSize={8} opacity={0.4}>10% base</text>

              {history.length > 1 && (() => {
                const labelCount = Math.min(6, history.length);
                const step = Math.max(1, Math.floor((history.length - 1) / (labelCount - 1)));
                const labels: number[] = [];
                for (let i = 0; i < history.length; i += step) labels.push(i);
                if (labels[labels.length - 1] !== history.length - 1) labels.push(history.length - 1);
                return labels.map((idx) => {
                  const p = history[idx];
                  const time = new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return <text key={idx} x={scaleX(idx)} y={CHART_H - 6} textAnchor="middle" fill="#566477" fontSize={9}>{time}</text>;
                });
              })()}

              <path d={svgArea(accPoints, PAD.top + INNER_H)} fill="url(#accGrad)" />
              {maxLoss > 0.001 && <path d={svgArea(lossPoints, PAD.top + INNER_H)} fill="url(#lossGrad)" />}
              <path d={svgPath(batchAccPoints)} fill="none" stroke="#9a8ed2" strokeWidth={1.5} opacity={0.5} strokeDasharray="4 2" />
              <path d={svgPath(accPoints)} fill="none" stroke="#37d4bd" strokeWidth={2} />
              {maxLoss > 0.001 && <path d={svgPath(lossPoints)} fill="none" stroke="#e05555" strokeWidth={2} />}

              {latest && (
                <>
                  {maxLoss > 0.001 && (
                    <circle cx={lossPoints[lossPoints.length - 1].x} cy={lossPoints[lossPoints.length - 1].y} r={3.5} fill="#e05555" stroke="#0c141f" strokeWidth={1.5} />
                  )}
                  <circle cx={accPoints[accPoints.length - 1].x} cy={accPoints[accPoints.length - 1].y} r={3.5} fill="#37d4bd" stroke="#0c141f" strokeWidth={1.5} />
                </>
              )}
            </svg>

            {latest && (
              <div className="training-chart-readouts">
                <div className="readout loss-readout">
                  <span className="readout-label">Loss</span>
                  <span className="readout-value">{latest.loss.toFixed(4)}</span>
                  {lossDelta !== 0 && (
                    <span className={`readout-delta ${lossDelta < 0 ? "good" : "bad"}`}>
                      {lossDelta < 0 ? "↓" : "↑"}{Math.abs(lossDelta).toFixed(4)}
                    </span>
                  )}
                </div>
                <div className="readout acc-readout">
                  <span className="readout-label">Rolling Acc</span>
                  <span className="readout-value">{(latest.rollingAccuracy * 100).toFixed(1)}%</span>
                </div>
                <div className="readout epoch-readout">
                  <span className="readout-label">Epoch</span>
                  <span className="readout-value">{latest.epoch}</span>
                </div>
                <div className="readout samples-readout">
                  <span className="readout-label">Samples</span>
                  <span className="readout-value">{latest.samplesTrained.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Epoch-by-epoch chart */}
      <EpochChart epochHistory={epochHistory} />

      <style jsx>{`
        .training-chart-wrapper {
          display: flex; flex-direction: column; gap: 12px;
        }
        .training-chart-container {
          padding: 12px 14px;
          background: #0c141f;
          border: 1px solid var(--border, #2a3444);
          border-radius: 10px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .training-chart-header {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 8px;
        }
        .training-chart-header h4 { margin: 0; font-size: 14px; color: var(--text, #d9e3ed); }
        .training-chart-legend { display: flex; gap: 14px; flex-wrap: wrap; }
        .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #718197; }
        .legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .training-chart-empty { display: flex; align-items: center; justify-content: center; }
        .training-chart-svg-wrap { display: flex; flex-direction: column; gap: 8px; }
        .training-chart-svg-wrap svg, .training-chart-empty svg { width: 100%; height: auto; overflow: visible; }
        .training-chart-readouts {
          display: flex; gap: 16px; flex-wrap: wrap;
          padding: 8px 0 0; border-top: 1px solid #1e2d3d;
        }
        .readout { display: flex; align-items: baseline; gap: 6px; }
        .readout-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .readout-value { font-size: 14px; font-weight: 700; color: #d9e3ed; font-family: monospace; }
        .loss-readout .readout-value { color: #e05555; }
        .acc-readout .readout-value { color: #37d4bd; }
        .epoch-readout .readout-value { color: #9a8ed2; }
        .samples-readout .readout-value { color: #718197; }
        .readout-delta { font-size: 10px; font-weight: 600; font-family: monospace; color: #566477; }
        .readout-delta.good { color: #37d4bd; }
        .readout-delta.bad { color: #e05555; }
      `}</style>
    </div>
  );
}
