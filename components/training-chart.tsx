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
  gradNormHistory: { timestamp: number; gradNorm: number; loss: number; lr: number }[];
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

/* ---- Gradient Norm Chart ---- */

const CLIP_THRESHOLD = 1.0; // clipnorm value from tf-worker.js

function GradientNormChart({ gradNormHistory }: { gradNormHistory: { timestamp: number; gradNorm: number; loss: number; lr: number }[] }) {
  if (gradNormHistory.length === 0) return null;

  const W = CHART_W;
  const H = 180;
  const P = { top: 10, right: 50, bottom: 30, left: 55 };
  const IW = W - P.left - P.right;
  const IH = H - P.top - P.bottom;

  // Scale: 0 to max(gradNorm, CLIP_THRESHOLD * 1.5)
  const maxVal = Math.max(...gradNormHistory.map((e) => e.gradNorm), CLIP_THRESHOLD * 1.5);

  function xScale(i: number): number {
    if (gradNormHistory.length <= 1) return P.left + IW / 2;
    return P.left + (i / (gradNormHistory.length - 1)) * IW;
  }
  function yScale(v: number): number {
    return P.top + IH - (v / maxVal) * IH;
  }
  function yLR(v: number): number {
    // LR is tiny (1e-4 to 1e-3), scale it to fill the chart height
    const maxLR = 0.002;
    return P.top + IH - (Math.min(v, maxLR) / maxLR) * IH;
  }

  const gradPoints = gradNormHistory.map((e, i) => ({ x: xScale(i), y: yScale(e.gradNorm) }));
  const lrPoints = gradNormHistory.map((e, i) => ({ x: xScale(i), y: yLR(e.lr) }));
  const clipY = yScale(CLIP_THRESHOLD);

  // X-axis labels (time)
  const labelCount = Math.min(6, gradNormHistory.length);
  const step = Math.max(1, Math.floor((gradNormHistory.length - 1) / Math.max(1, labelCount - 1)));
  const timeLabels: number[] = [];
  for (let i = 0; i < gradNormHistory.length; i += step) timeLabels.push(i);
  if (timeLabels[timeLabels.length - 1] !== gradNormHistory.length - 1) timeLabels.push(gradNormHistory.length - 1);

  // Count clipped values
  const clippedCount = gradNormHistory.filter((e) => e.gradNorm >= CLIP_THRESHOLD).length;
  const latest = gradNormHistory[gradNormHistory.length - 1];

  return (
    <div className="gn-chart-container">
      <div className="gn-chart-header">
        <h4>📐 Gradient Norm</h4>
        <div className="gn-chart-legend">
          <span className="legend-item"><span className="legend-dot" style={{ background: "#ce93d8" }} /> Grad Norm</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: "#f0c040", borderRadius: 0, width: 12, height: 2 }} /> Learning Rate</span>
          <span className="legend-item"><span className="legend-line" style={{ background: "#e05555" }} /> Clip @ {CLIP_THRESHOLD}</span>
        </div>
      </div>

      <div className="gn-chart-svg-wrap">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id="gnGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ce93d8" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#ce93d8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gnClip" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e05555" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#e05555" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          {/* Clip threshold zone (above clip line = red danger zone) */}
          <rect x={P.left} y={P.top} width={IW} height={Math.max(0, clipY - P.top)} fill="url(#gnClip)" />

          {/* Grid lines */}
          {[0, 0.5, 1.0, 1.5, 2.0].filter(v => v <= maxVal * 1.1).map((v) => (
            <g key={`gv-${v}`}>
              <line x1={P.left} y1={yScale(v)} x2={P.left + IW} y2={yScale(v)} stroke="#1e2d3d" strokeWidth={0.5} strokeDasharray={v === CLIP_THRESHOLD ? "" : "2 4"} />
              <text x={P.left - 6} y={yScale(v) + 3} textAnchor="end" fill="#ce93d8" fontSize={9} opacity={0.7}>{v.toFixed(1)}</text>
            </g>
          ))}

          {/* Clip threshold line */}
          <line x1={P.left} y1={clipY} x2={P.left + IW} y2={clipY} stroke="#e05555" strokeWidth={1.5} strokeDasharray="6 3" />
          <text x={P.left + IW + 6} y={clipY + 3} fill="#e05555" fontSize={9} fontWeight={700}>{CLIP_THRESHOLD}</text>
          <text x={P.left + IW + 6} y={clipY + 14} fill="#e05555" fontSize={7} opacity={0.7}>clip</text>

          {/* Time labels */}
          {gradNormHistory.length > 1 && timeLabels.map((idx) => {
            const t = new Date(gradNormHistory[idx].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            return <text key={idx} x={xScale(idx)} y={H - 6} textAnchor="middle" fill="#566477" fontSize={9}>{t}</text>;
          })}

          {/* Area under grad norm */}
          <path d={svgArea(gradPoints, P.top + IH)} fill="url(#gnGrad)" />

          {/* Learning rate line (subtle) */}
          {lrPoints.length > 1 && (
            <path d={svgPath(lrPoints)} fill="none" stroke="#f0c040" strokeWidth={1} opacity={0.4} strokeDasharray="4 2" />
          )}

          {/* Grad norm line */}
          {gradPoints.length > 1 && (
            <path d={svgPath(gradPoints)} fill="none" stroke="#ce93d8" strokeWidth={2} />
          )}

          {/* Clipped points (red dots where norm >= threshold) */}
          {gradNormHistory.map((e, i) => {
            if (e.gradNorm < CLIP_THRESHOLD) return null;
            return (
              <circle key={`clip-${i}`} cx={xScale(i)} cy={yScale(e.gradNorm)} r={3} fill="#e05555" stroke="#0c141f" strokeWidth={1} />
            );
          })}

          {/* Latest point */}
          {gradPoints.length > 0 && (
            <circle cx={gradPoints[gradPoints.length - 1].x} cy={gradPoints[gradPoints.length - 1].y} r={3.5} fill="#ce93d8" stroke="#0c141f" strokeWidth={1.5} />
          )}
        </svg>
      </div>

      {/* Readouts */}
      <div className="gn-readouts">
        <div className="gn-readout">
          <span className="gn-label">Grad Norm</span>
          <span className="gn-value purple" style={{ color: latest.gradNorm >= CLIP_THRESHOLD ? "#e05555" : "#ce93d8" }}>
            {latest.gradNorm.toFixed(4)}
          </span>
          {latest.gradNorm >= CLIP_THRESHOLD && <span className="gn-clipped">CLIPPED</span>}
        </div>
        <div className="gn-readout">
          <span className="gn-label">Learning Rate</span>
          <span className="gn-value" style={{ color: "#f0c040" }}>{latest.lr.toExponential(1)}</span>
        </div>
        <div className="gn-readout">
          <span className="gn-label">Clipped</span>
          <span className="gn-value" style={{ color: clippedCount > 0 ? "#e05555" : "#718197" }}>
            {clippedCount}/{gradNormHistory.length}
          </span>
        </div>
        <div className="gn-readout">
          <span className="gn-label">Samples</span>
          <span className="gn-value muted">{gradNormHistory.length}</span>
        </div>
      </div>

      <style jsx>{`
        .gn-chart-container {
          padding: 12px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .gn-chart-header {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 8px;
        }
        .gn-chart-header h4 { margin: 0; font-size: 14px; color: #d9e3ed; }
        .gn-chart-legend { display: flex; gap: 14px; flex-wrap: wrap; }
        .gn-chart-svg-wrap svg { width: 100%; height: auto; overflow: visible; }
        .legend-line {
          width: 12px; height: 2px; display: inline-block;
          border-radius: 1px;
        }
        .gn-readouts {
          display: flex; gap: 16px; flex-wrap: wrap;
          padding: 8px 0 0; border-top: 1px solid #1e2d3d;
        }
        .gn-readout { display: flex; align-items: baseline; gap: 6px; }
        .gn-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .gn-value { font-size: 14px; font-weight: 700; font-family: monospace; }
        .gn-value.muted { color: #718197; }
        .gn-clipped {
          font-size: 9px; font-weight: 700; padding: 1px 5px;
          background: rgba(224,85,85,.15); color: #e05555;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}

/* ---- Main Training Chart (time-series) ---- */

type TooltipInfo = {
  x: number; y: number;
  loss: number; accuracy: number; rollingAccuracy: number;
  epoch: number; samplesTrained: number; timestamp: number;
};

export default function TrainingChart({ modelMetrics, onlineMetrics, epochHistory, gradNormHistory }: Props) {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
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

  // Hover tooltip handler
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || history.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    // Find nearest data point
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < history.length; i++) {
      const px = scaleX(i);
      const dist = Math.abs(px - svgX);
      if (dist < minDist) { minDist = dist; nearestIdx = i; }
    }
    const p = history[nearestIdx];
    setTooltip({
      x: scaleX(nearestIdx), y: Math.min(scaleYLoss(p.loss), scaleYAcc(p.rollingAccuracy)) - 12,
      loss: p.loss, accuracy: p.accuracy, rollingAccuracy: p.rollingAccuracy,
      epoch: p.epoch, samplesTrained: p.samplesTrained, timestamp: p.timestamp,
    });
  }, [history, scaleX, scaleYLoss, scaleYAcc]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="training-chart-wrapper">
      {/* Time-series chart */}
      <div className="training-chart-container">
        <div className="training-chart-header">
          <h4>📈 Training Progress (Live)</h4>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="training-chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: "#e05555" }} /> Loss</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#37d4bd" }} /> Rolling Accuracy</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#9a8ed2" }} /> Batch Accuracy</span>
            </div>
            {history.length > 0 && (
              <button className="csv-export-btn" onClick={() => {
                const header = "timestamp,loss,accuracy,rolling_accuracy,epoch,samples_trained\n";
                const rows = history.map(p =>
                  `${new Date(p.timestamp).toISOString()},${p.loss.toFixed(6)},${p.accuracy.toFixed(6)},${p.rollingAccuracy.toFixed(6)},${p.epoch},${p.samplesTrained}`
                ).join("\n");
                const epochHeader = "\n\nEpoch,TotalEpochs,Loss,Accuracy,ValLoss,ValAccuracy,Samples\n";
                const epochRows = epochHistory.map(e =>
                  `${e.epoch},${e.totalEpochs},${e.loss.toFixed(6)},${e.accuracy.toFixed(6)},${e.valLoss.toFixed(6)},${e.valAccuracy.toFixed(6)},${e.samplesInBatch}`
                ).join("\n");
                const gnHeader = "\n\nTimestamp,GradNorm,Loss,LR\n";
                const gnRows = gradNormHistory.map(g =>
                  `${new Date(g.timestamp).toISOString()},${g.gradNorm.toFixed(6)},${g.loss.toFixed(6)},${g.lr.toExponential(4)}`
                ).join("\n");
                const csv = header + rows + epochHeader + epochRows + gnHeader + gnRows;
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `training-history-${Date.now()}.csv`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }} title="Export training history as CSV">
                📥 CSV
              </button>
            )}
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
            <svg ref={svgRef} width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{ cursor: "crosshair" }}>
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

              {/* Hover tooltip */}
              {tooltip && (
                <g>
                  {/* Vertical crosshair line */}
                  <line x1={tooltip.x} y1={PAD.top} x2={tooltip.x} y2={PAD.top + INNER_H} stroke="#3a4d62" strokeWidth={0.5} strokeDasharray="3 3" />
                  {/* Tooltip background */}
                  <rect x={tooltip.x + 8} y={Math.max(PAD.top, tooltip.y - 60)} width={160} height={72} rx={6} fill="#111c2a" stroke="#2a3444" strokeWidth={1} />
                  {/* Tooltip text */}
                  <text x={tooltip.x + 14} y={Math.max(PAD.top + 12, tooltip.y - 46)} fill="#e05555" fontSize={10} fontWeight={700} fontFamily="monospace">Loss: {tooltip.loss.toFixed(4)}</text>
                  <text x={tooltip.x + 14} y={Math.max(PAD.top + 26, tooltip.y - 32)} fill="#37d4bd" fontSize={10} fontWeight={700} fontFamily="monospace">Roll Acc: {(tooltip.rollingAccuracy * 100).toFixed(1)}%</text>
                  <text x={tooltip.x + 14} y={Math.max(PAD.top + 40, tooltip.y - 18)} fill="#9a8ed2" fontSize={10} fontFamily="monospace">Batch Acc: {(tooltip.accuracy * 100).toFixed(1)}%</text>
                  <text x={tooltip.x + 14} y={Math.max(PAD.top + 54, tooltip.y - 4)} fill="#566477" fontSize={9} fontFamily="monospace">{new Date(tooltip.timestamp).toLocaleTimeString()}</text>
                </g>
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

      {/* Gradient norm chart */}
      <GradientNormChart gradNormHistory={gradNormHistory} />

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
        .csv-export-btn {
          padding: 3px 8px; background: transparent;
          border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;
          color: #718197; font-size: 10px; cursor: pointer; transition: 0.15s;
          white-space: nowrap;
        }
        .csv-export-btn:hover { border-color: #37d4bd; color: #37d4bd; background: rgba(55,212,189,0.05); }
      `}</style>
    </div>
  );
}
