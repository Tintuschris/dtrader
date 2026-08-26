"use client";

import { useEffect, useState, useRef } from "react";
import type * as Blockly from "blockly/core";
import {
  analyzeWorkspace,
  type StrategyAnalysis,
} from "../lib/strategy-analyzer";

type Props = {
  workspace: Blockly.WorkspaceSvg | null;
};

export default function StrategyPreviewPanel({ workspace }: Props) {
  const [analysis, setAnalysis] = useState<StrategyAnalysis | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Analyze workspace on changes (debounced)
  useEffect(() => {
    if (!workspace) { setAnalysis(null); return; }

    const runAnalysis = () => {
      try {
        setAnalysis(analyzeWorkspace(workspace));
      } catch { /* workspace may be disposing */ }
    };

    // Initial analysis
    runAnalysis();

    // Re-analyze on any block change
    const sub = workspace.addChangeListener(() => {
      // Debounce: clear previous timer
      if (intervalRef.current) clearTimeout(intervalRef.current);
      intervalRef.current = setTimeout(runAnalysis, 500);
    });

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      sub(null as any);
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [workspace]);

  if (!analysis) return null;

  const complexityColor =
    analysis.complexity === "simple" ? "#37d4bd" :
    analysis.complexity === "moderate" ? "#f0c040" :
    analysis.complexity === "advanced" ? "#9a8ed2" : "#e05555";

  const complexityIcon =
    analysis.complexity === "simple" ? "🟢" :
    analysis.complexity === "moderate" ? "🟡" :
    analysis.complexity === "advanced" ? "🟣" : "🔴";

  return (
    <div className="preview-panel">
      {/* Header */}
      <div className="preview-header">
        <h4>📋 Strategy Overview</h4>
        <span className="complexity-badge" style={{ background: `${complexityColor}20`, color: complexityColor, borderColor: `${complexityColor}40` }}>
          {complexityIcon} {analysis.complexity}
        </span>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{analysis.totalBlocks}</span>
          <span className="stat-label">Blocks</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{analysis.uniqueBlockTypes}</span>
          <span className="stat-label">Types</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{analysis.categories.length}</span>
          <span className="stat-label">Categories</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{analysis.nestingDepth}</span>
          <span className="stat-label">Depth</span>
        </div>
      </div>

      {/* Complexity bar */}
      <div className="complexity-bar-wrap">
        <div className="complexity-bar-track">
          <div
            className="complexity-bar-fill"
            style={{
              width: `${analysis.complexityScore}%`,
              background: `linear-gradient(90deg, #37d4bd, ${complexityColor})`,
            }}
          />
        </div>
        <span className="complexity-score" style={{ color: complexityColor }}>
          {analysis.complexityScore}/100
        </span>
      </div>

      {/* Category breakdown */}
      <div className="category-section">
        <h5>Category Breakdown</h5>
        <div className="category-bars">
          {analysis.categories.map((cat) => {
            const pct = analysis.totalBlocks > 0 ? (cat.count / analysis.totalBlocks) * 100 : 0;
            return (
              <div key={cat.name} className="category-row">
                <div className="category-info">
                  <span className="category-dot" style={{ background: cat.color }} />
                  <span className="category-name">{cat.name}</span>
                  <span className="category-count">{cat.count}</span>
                </div>
                <div className="category-bar-track">
                  <div className="category-bar-fill" style={{ width: `${pct}%`, background: cat.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Features */}
      <div className="features-row">
        {analysis.hasConditionals && <span className="feature-tag logic">⚡ Conditionals</span>}
        {analysis.hasLoop && <span className="feature-tag loop">🔄 Loops</span>}
        {analysis.hasVariables && <span className="feature-tag vars">📦 Variables</span>}
        {analysis.hasMathOperations && <span className="feature-tag math">🔢 Math</span>}
      </div>

      {/* Root blocks */}
      <div className="root-blocks-section">
        <h5>Root Blocks</h5>
        <div className="root-blocks-list">
          {analysis.rootBlocks.map((name) => (
            <span key={name} className="root-block-tag">{name}</span>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {analysis.warnings.length > 0 && (
        <div className="warnings-section">
          {analysis.warnings.map((w, i) => (
            <div key={i} className="warning-item">⚠️ {w}</div>
          ))}
        </div>
      )}

      <style jsx>{`
        .preview-panel {
          padding: 12px 14px;
          background: #0c141f;
          border: 1px solid var(--border, #2a3444);
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .preview-header h4 { margin: 0; font-size: 14px; color: #d9e3ed; }
        .complexity-badge {
          font-size: 11px; font-weight: 700; padding: 3px 10px;
          border-radius: 6px; border: 1px solid; text-transform: capitalize;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        .stat-card {
          display: flex; flex-direction: column; align-items: center;
          padding: 8px; background: #111c2a;
          border: 1px solid #1e2d3d; border-radius: 8px;
        }
        .stat-value {
          font-size: 18px; font-weight: 700; color: #d9e3ed;
          font-family: monospace;
        }
        .stat-label {
          font-size: 10px; color: #566477; text-transform: uppercase;
        }

        .complexity-bar-wrap {
          display: flex; align-items: center; gap: 10px;
        }
        .complexity-bar-track {
          flex: 1; height: 6px; background: #1e2d3d;
          border-radius: 3px; overflow: hidden;
        }
        .complexity-bar-fill {
          height: 100%; border-radius: 3px;
          transition: width 0.5s ease;
        }
        .complexity-score {
          font-size: 11px; font-weight: 700; font-family: monospace;
          min-width: 40px; text-align: right;
        }

        .category-section h5 {
          margin: 0 0 6px; font-size: 12px; color: #718197;
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .category-bars {
          display: flex; flex-direction: column; gap: 6px;
        }
        .category-row {
          display: flex; flex-direction: column; gap: 2px;
        }
        .category-info {
          display: flex; align-items: center; gap: 6px;
        }
        .category-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .category-name {
          font-size: 12px; color: #d9e3ed; flex: 1;
        }
        .category-count {
          font-size: 11px; color: #566477; font-family: monospace;
        }
        .category-bar-track {
          height: 3px; background: #1e2d3d; border-radius: 2px;
          overflow: hidden;
        }
        .category-bar-fill {
          height: 100%; border-radius: 2px;
          transition: width 0.5s ease;
        }

        .features-row {
          display: flex; gap: 6px; flex-wrap: wrap;
        }
        .feature-tag {
          font-size: 10px; font-weight: 600; padding: 3px 8px;
          border-radius: 4px; display: flex; align-items: center; gap: 4px;
        }
        .feature-tag.logic { background: rgba(96,125,139,.15); color: #90a4ae; }
        .feature-tag.loop { background: rgba(156,39,176,.12); color: #ce93d8; }
        .feature-tag.vars { background: rgba(255,87,34,.12); color: #ff8a65; }
        .feature-tag.math { background: rgba(121,85,72,.15); color: #bcaaa4; }

        .root-blocks-section h5 {
          margin: 0 0 6px; font-size: 12px; color: #718197;
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .root-blocks-list {
          display: flex; gap: 4px; flex-wrap: wrap;
        }
        .root-block-tag {
          font-size: 10px; padding: 2px 8px;
          background: rgba(33,150,243,.1); color: #64b5f6;
          border: 1px solid rgba(33,150,243,.2); border-radius: 4px;
        }

        .warnings-section {
          display: flex; flex-direction: column; gap: 4px;
        }
        .warning-item {
          font-size: 11px; color: #f0c040;
          padding: 4px 8px; background: rgba(240,192,64,.06);
          border: 1px solid rgba(240,192,64,.15); border-radius: 6px;
        }
      `}</style>
    </div>
  );
}
