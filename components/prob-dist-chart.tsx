"use client";

import { useMemo } from "react";
import type { ProbSnapshot } from "../lib/digit-model";

type Props = {
  probHistory: ProbSnapshot[];
};

const CHART_W = 600;
const CHART_H = 200;
const PAD = { top: 10, right: 20, bottom: 30, left: 40 };
const INNER_W = CHART_W - PAD.left - PAD.right;
const INNER_H = CHART_H - PAD.top - PAD.bottom;

const DIGIT_COLORS = [
  "#e05555", "#e08a3c", "#f0c040", "#a8d848", "#37d4bd",
  "#3ca8e0", "#6c63d4", "#a060d4", "#d460a0", "#718197",
];

export default function ProbDistChart({ probHistory }: Props) {
  const maxPoints = 120; // show last 120 snapshots

  const data = useMemo(() => {
    return probHistory.slice(-maxPoints);
  }, [probHistory, maxPoints]);

  if (data.length < 2) {
    return (
      <div className="pd-container">
        <div className="pd-header">
          <h4>📊 Probability Distribution Over Time</h4>
          <span className="pd-subtitle">Stacked area — shows how digit probabilities shift</span>
        </div>
        <div className="pd-empty">
          <p>Need at least 2 prediction snapshots. Start streaming to see probabilities evolve.</p>
        </div>
        <style jsx>{`
          .pd-container { padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
          .pd-header { display: flex; justify-content: space-between; align-items: center; }
          .pd-header h4 { margin: 0; font-size: 14px; color: #d9e3ed; }
          .pd-subtitle { font-size: 10px; color: #566477; }
          .pd-empty { padding: 30px; text-align: center; color: #566477; font-size: 12px; }
        `}</style>
      </div>
    );
  }

  // Build stacked area data
  const xScale = (i: number) => (i / (data.length - 1)) * INNER_W;
  const yScale = (v: number) => INNER_H - v * INNER_H;

  // Compute stacked cumulative probabilities at each time point
  const layers: { digit: number; points: string; color: string }[] = [];
  for (let d = 0; d < 10; d++) {
    let pathTop = "";
    const pathBottom: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const x = xScale(i);

      // Sum all digits from 0..d at this time point
      let cumTop = 0;
      for (let dd = 0; dd <= d; dd++) {
        cumTop += data[i].probabilities[dd] ?? 0;
      }

      // Sum all digits from 0..d-1 at this time point (bottom)
      let cumBottom = 0;
      for (let dd = 0; dd < d; dd++) {
        cumBottom += data[i].probabilities[dd] ?? 0;
      }

      const yTop = yScale(cumTop);
      const yBottom = yScale(cumBottom);

      if (i === 0) {
        pathTop += `M ${x},${yTop}`;
      } else {
        pathTop += ` L ${x},${yTop}`;
      }
      pathBottom.unshift(`${x},${yBottom}`);
    }

    // Close the area: forward along top, then backward along bottom
    const areaPath = pathTop + " L " + pathBottom.join(" L ") + " Z";
    layers.push({ digit: d, points: areaPath, color: DIGIT_COLORS[d] });
  }

  // Y-axis ticks
  const yTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  // Current probabilities (last snapshot)
  const current = data[data.length - 1];
  const sortedDigits = [...Array(10).keys()].sort(
    (a, b) => (current.probabilities[b] ?? 0) - (current.probabilities[a] ?? 0),
  );

  return (
    <div className="pd-container">
      <div className="pd-header">
        <h4>📊 Probability Distribution Over Time</h4>
        <span className="pd-subtitle">
          {data.length} snapshots — latest top: Digit {current.topDigit} ({((current.probabilities[current.topDigit] ?? 0) * 100).toFixed(1)}%)
        </span>
      </div>

      <div className="pd-chart-wrap">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="pd-svg">
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* Y-axis grid */}
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={0} y1={yScale(t)} x2={INNER_W} y2={yScale(t)} stroke="#1e2d3d" strokeWidth={0.5} />
                <text x={-5} y={yScale(t) + 3} textAnchor="end" fontSize={9} fill="#566477" fontFamily="monospace">
                  {(t * 100).toFixed(0)}%
                </text>
              </g>
            ))}

            {/* Stacked areas */}
            {layers.map((l) => (
              <path key={l.digit} d={l.points} fill={l.color} opacity={0.7} stroke={l.color} strokeWidth={0.5} />
            ))}

            {/* X-axis labels */}
            {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i, arr) => {
              const idx = data.indexOf(d);
              return (
                <text key={i} x={xScale(idx)} y={INNER_H + 18} textAnchor="middle" fontSize={9} fill="#566477" fontFamily="monospace">
                  {new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </text>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="pd-legend">
        {sortedDigits.map((d) => (
          <div key={d} className="pd-legend-item">
            <span className="pd-legend-dot" style={{ background: DIGIT_COLORS[d] }} />
            <span className="pd-legend-digit">{d}</span>
            <span className="pd-legend-pct">{((current.probabilities[d] ?? 0) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <style jsx>{`
        .pd-container { padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
        .pd-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; }
        .pd-header h4 { margin: 0; font-size: 14px; color: #d9e3ed; }
        .pd-subtitle { font-size: 10px; color: #566477; }
        .pd-empty { padding: 30px; text-align: center; color: #566477; font-size: 12px; }
        .pd-chart-wrap { display: flex; justify-content: center; }
        .pd-svg { width: 100%; max-width: ${CHART_W}px; height: auto; overflow: visible; }
        .pd-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; padding-top: 8px; border-top: 1px solid #1e2d3d; }
        .pd-legend-item { display: flex; align-items: center; gap: 4px; }
        .pd-legend-dot { width: 8px; height: 8px; border-radius: 2px; }
        .pd-legend-digit { font-size: 11px; font-weight: 700; color: #d9e3ed; }
        .pd-legend-pct { font-size: 10px; color: #718197; font-family: monospace; }
      `}</style>
    </div>
  );
}
