"use client";

import { useState, useCallback } from "react";
import { IconUpload, IconX, IconCheck, IconBrain } from "@tabler/icons-react";
import type { DigitPredictor as DigitPredictorType, PredictionRecord } from "../lib/digit-model";

type ModelEntry = {
  id: string;
  name: string;
  topology: unknown;
  weightData: unknown;
  metrics?: { loss: number; accuracy: number; epoch: number; samplesTrained: number };
  status: "loaded" | "testing" | "done";
  accuracy?: number;
  loss?: number;
  winRate?: number;
};

type Props = {
  currentPredictor: DigitPredictorType | null;
  predictionHistory: PredictionRecord[];
};

export default function ModelComparison({ currentPredictor, predictionHistory }: Props) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [isComparing, setIsComparing] = useState(false);

  const addModel = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const blob = JSON.parse(text);
        const newModel: ModelEntry = {
          id: `model_${Date.now()}`,
          name: file.name.replace(".json", ""),
          topology: blob.topology,
          weightData: blob.weightData,
          metrics: blob.metrics,
          status: "loaded",
        };
        setModels((prev) => [...prev, newModel]);
      } catch {
        alert("Invalid model file");
      }
    };
    input.click();
  }, []);

  const removeModel = useCallback((id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const compareModels = useCallback(async () => {
    if (models.length === 0 || !currentPredictor) return;
    setIsComparing(true);

    // Get the current model's accuracy from prediction history
    const validated = predictionHistory.filter((p) => p.actualDigit !== null);
    const currentWins = validated.filter((p) => p.correct === true).length;
    const currentAccuracy = validated.length > 0 ? currentWins / validated.length : 0;

    // For imported models, we can only show stored metrics (no live testing without swapping)
    setModels((prev) =>
      prev.map((m) => ({
        ...m,
        status: "done" as const,
        // Use stored metrics if available, otherwise mark as unknown
        accuracy: m.metrics?.accuracy,
        loss: m.metrics?.loss,
        winRate: m.metrics?.accuracy ? m.metrics.accuracy * 100 : undefined,
      })),
    );

    setIsComparing(false);
  }, [models, currentPredictor, predictionHistory]);

  const swapToModel = useCallback(async (model: ModelEntry) => {
    if (!currentPredictor) return;
    const ok = await currentPredictor.importModel({
      topology: model.topology,
      weightData: model.weightData,
      metrics: model.metrics ? {
        loss: model.metrics.loss,
        accuracy: model.metrics.accuracy,
        epoch: model.metrics.epoch,
        samplesTrained: model.metrics.samplesTrained,
        lastTrainedAt: Date.now(),
        lastGradNorm: 0,
        currentLR: 0,
        onlineUpdateCount: 0,
        weightDivergence: 0,
      } : undefined,
    });
    if (ok) {
      alert(`Switched to model: ${model.name}`);
    } else {
      alert("Failed to load model");
    }
  }, [currentPredictor]);

  return (
    <div className="mc">
      <div className="mc-header">
        <h3>🔀 Model Comparison</h3>
        <p className="mc-subtitle">Load trained models and compare their performance</p>
      </div>

      {/* Current Model */}
      <div className="mc-current">
        <div className="mc-model-card active">
          <div className="mc-card-header">
            <IconBrain size={16} />
            <span className="mc-card-name">Current Model</span>
            <span className="mc-badge active">ACTIVE</span>
          </div>
          <div className="mc-card-stats">
            {predictionHistory.length > 0 ? (
              <>
                <span className="mc-stat">
                  <span className="mc-stat-label">Predictions</span>
                  <span className="mc-stat-val">{predictionHistory.length}</span>
                </span>
                <span className="mc-stat">
                  <span className="mc-stat-label">Validated</span>
                  <span className="mc-stat-val">{predictionHistory.filter((p) => p.actualDigit !== null).length}</span>
                </span>
                <span className="mc-stat">
                  <span className="mc-stat-label">Win Rate</span>
                  <span className="mc-stat-val">
                    {predictionHistory.filter((p) => p.actualDigit !== null).length > 0
                      ? `${((predictionHistory.filter((p) => p.correct === true).length / predictionHistory.filter((p) => p.actualDigit !== null).length) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </span>
              </>
            ) : (
              <span className="mc-stat-empty">No predictions yet</span>
            )}
          </div>
        </div>
      </div>

      {/* Add Model Button */}
      <div className="mc-actions">
        <button className="mc-add-btn" onClick={addModel}>
          <IconUpload size={14} /> Load Model
        </button>
        {models.length > 0 && (
          <button className="mc-compare-btn" onClick={compareModels} disabled={isComparing}>
            {isComparing ? "Comparing..." : "📊 Compare All"}
          </button>
        )}
      </div>

      {/* Loaded Models */}
      {models.length > 0 && (
        <div className="mc-models-grid">
          {models.map((m) => (
            <div key={m.id} className={`mc-model-card ${m.status}`}>
              <div className="mc-card-header">
                <span className="mc-card-name">{m.name}</span>
                {m.status === "done" && <IconCheck size={14} color="#37d4bd" />}
                <button className="mc-remove-btn" onClick={() => removeModel(m.id)}>
                  <IconX size={12} />
                </button>
              </div>
              <div className="mc-card-stats">
                {m.status === "done" ? (
                  <>
                    {m.accuracy !== undefined && (
                      <span className="mc-stat">
                        <span className="mc-stat-label">Accuracy</span>
                        <span className={`mc-stat-val ${m.accuracy > 0.12 ? "good" : ""}`}>{(m.accuracy * 100).toFixed(1)}%</span>
                      </span>
                    )}
                    {m.loss !== undefined && (
                      <span className="mc-stat">
                        <span className="mc-stat-label">Loss</span>
                        <span className="mc-stat-val">{m.loss.toFixed(4)}</span>
                      </span>
                    )}
                    {m.metrics?.epoch !== undefined && (
                      <span className="mc-stat">
                        <span className="mc-stat-label">Epochs</span>
                        <span className="mc-stat-val">{m.metrics.epoch}</span>
                      </span>
                    )}
                    {m.metrics?.samplesTrained !== undefined && (
                      <span className="mc-stat">
                        <span className="mc-stat-label">Samples</span>
                        <span className="mc-stat-val">{m.metrics.samplesTrained.toLocaleString()}</span>
                      </span>
                    )}
                  </>
                ) : m.status === "testing" ? (
                  <span className="mc-stat-empty">Testing...</span>
                ) : (
                  <span className="mc-stat-empty">Ready to compare</span>
                )}
              </div>
              <button
                className="mc-swap-btn"
                onClick={() => swapToModel(m)}
                disabled={m.status !== "done"}
              >
                Switch to this model
              </button>
            </div>
          ))}
        </div>
      )}

      {models.length === 0 && (
        <div className="mc-empty">
          <IconUpload size={32} style={{ opacity: 0.3 }} />
          <p>No models loaded. Click "Load Model" to import a trained model.</p>
          <p className="mc-empty-sub">Export models from the Neural Net tab to compare them here.</p>
        </div>
      )}

      <style jsx>{`
        .mc { display: flex; flex-direction: column; gap: 12px; }
        .mc-header h3 { margin: 0; font-size: 15px; }
        .mc-subtitle { font-size: 12px; color: #566477; margin: 0; }

        .mc-current { margin-bottom: 4px; }

        .mc-model-card {
          padding: 12px 14px; background: #0c141f;
          border: 1px solid var(--border, #2a3444); border-radius: 10px;
        }
        .mc-model-card.active { border-color: rgba(154,142,210,.3); background: rgba(154,142,210,.05); }
        .mc-model-card.done { border-color: rgba(55,212,189,.2); }

        .mc-card-header {
          display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
        }
        .mc-card-name { font-size: 13px; font-weight: 600; color: #d9e3ed; flex: 1; }
        .mc-badge {
          padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700;
        }
        .mc-badge.active { background: rgba(154,142,210,.15); color: #9a8ed2; }

        .mc-card-stats {
          display: flex; flex-wrap: wrap; gap: 12px;
        }
        .mc-stat { display: flex; flex-direction: column; gap: 2px; }
        .mc-stat-label { font-size: 9px; color: #566477; text-transform: uppercase; }
        .mc-stat-val { font-size: 13px; font-weight: 700; color: #d9e3ed; font-family: monospace; }
        .mc-stat-val.good { color: #37d4bd; }
        .mc-stat-empty { font-size: 12px; color: #566477; }

        .mc-actions { display: flex; gap: 8px; }
        .mc-add-btn, .mc-compare-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 8px; font-size: 12px;
          font-weight: 600; cursor: pointer; transition: 0.15s; border: none;
        }
        .mc-add-btn {
          background: rgba(154,142,210,.12); color: #9a8ed2; border: 1px solid rgba(154,142,210,.3);
        }
        .mc-add-btn:hover { background: rgba(154,142,210,.2); }
        .mc-compare-btn {
          background: rgba(55,212,189,.12); color: #37d4bd; border: 1px solid rgba(55,212,189,.3);
        }
        .mc-compare-btn:hover { background: rgba(55,212,189,.2); }
        .mc-compare-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .mc-models-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;
        }

        .mc-remove-btn {
          padding: 2px 4px; background: transparent; border: none;
          color: #566477; cursor: pointer; border-radius: 4px; transition: 0.15s;
        }
        .mc-remove-btn:hover { color: #e05555; background: rgba(224,85,85,.1); }

        .mc-swap-btn {
          width: 100%; margin-top: 8px; padding: 6px 12px;
          background: transparent; border: 1px solid rgba(55,212,189,.3);
          border-radius: 6px; color: #37d4bd; font-size: 11px; font-weight: 600;
          cursor: pointer; transition: 0.15s;
        }
        .mc-swap-btn:hover { background: rgba(55,212,189,.1); }
        .mc-swap-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .mc-empty {
          display: flex; flex-direction: column; align-items: center;
          padding: 40px; text-align: center; color: #566477;
        }
        .mc-empty p { margin: 8px 0; font-size: 13px; }
        .mc-empty-sub { font-size: 11px; color: #566477; }
      `}</style>
    </div>
  );
}
