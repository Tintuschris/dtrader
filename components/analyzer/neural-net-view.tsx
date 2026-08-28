"use client";

import { useCallback, useEffect, useState } from "react";
import { IconBrain } from "@tabler/icons-react";
import type { MarketScore, ModelStatus, TrainingMetrics, OnlineLearningMetrics, BacktestResult, BacktestProgress } from "../../lib/market-analyzer";
import type { DigitPredictor as DigitPredictorType, EpochProgress, PredictionRecord, ProbSnapshot } from "../../lib/digit-model";
import TrainingChart from "../training-chart";
import ConfusionMatrix from "../confusion-matrix";
import ProbDistChart from "../prob-dist-chart";
import ModelComparison from "../model-comparison";
import AutoModelSelection from "../auto-model-selection";
import TrainingScheduler from "../training-scheduler";

export type NeuralNetProps = {
  currentScore: MarketScore | null;
  modelStatus: ModelStatus;
  modelMetrics: TrainingMetrics;
  onlineMetrics: OnlineLearningMetrics;
  bufferSize: number;
  predictor: DigitPredictorType | null;
  onTrainNow: () => void;
  onReset: () => void;
  epochHistory: EpochProgress[];
  gradNormHistory: { timestamp: number; gradNorm: number; loss: number; lr: number }[];
  predictionHistory: PredictionRecord[];
  probHistory: ProbSnapshot[];
  onExportModel: () => void;
  onImportModel: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function NeuralNetView({
  currentScore,
  modelStatus,
  modelMetrics,
  onlineMetrics,
  bufferSize,
  predictor,
  onTrainNow,
  onReset,
  epochHistory,
  gradNormHistory,
  predictionHistory,
  probHistory,
  onExportModel,
  onImportModel,
}: NeuralNetProps) {
  const prediction = currentScore?.neuralPrediction ?? null;
  const statusColor = onlineMetrics.isOnlineLearning ? "#37d4bd" : modelStatus === "training" ? "#37d4bd" : modelStatus === "ready" ? "#9a8ed2" : modelStatus === "error" ? "#e05555" : "#718197";
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestProgress, setBacktestProgress] = useState<BacktestProgress | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [trainRatio, setTrainRatio] = useState(80);
  const [trainEpochs, setTrainEpochs] = useState(10);

  useEffect(() => {
    if (!predictor) return;
    const unsub = predictor.onBacktestProgress((p: BacktestProgress) => setBacktestProgress(p));
    return unsub;
  }, [predictor]);

  const handleRunBacktest = useCallback(async () => {
    if (!predictor || bufferSize < 100) return;
    setIsBacktesting(true);
    setBacktestError(null);
    setBacktestResult(null);
    setBacktestProgress(null);
    try {
      const digits: number[] = (predictor as unknown as { digitBuffer: number[] }).digitBuffer;
      const result = await predictor.runBacktest(digits, trainRatio / 100, trainEpochs);
      setBacktestResult(result);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setIsBacktesting(false);
    }
  }, [predictor, bufferSize, trainRatio, trainEpochs]);

  return (
    <div className="nn-view">
      <div className="nn-header">
        <h3>TensorFlow.js Neural Network</h3>
        <p className="nn-subtitle">
          LSTM model with online learning. Predicts next digit, validates against actual ticks, and updates weights in real-time.
        </p>
      </div>

      {/* Model Status */}
      <div className="nn-status-grid">
        <div className="nn-stat-card">
          <span className="nn-stat-label">Status</span>
          <span className="nn-stat-value" style={{ color: statusColor }}>
            {onlineMetrics.isOnlineLearning ? "⚡ Online Learning" : modelStatus === "training" ? "⚡ Training" : modelStatus === "ready" ? "✓ Ready" : modelStatus === "loading" ? "⏳ Loading" : modelStatus}
          </span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Rolling Accuracy</span>
          <span className={`nn-stat-value ${onlineMetrics.rollingAccuracy > 0.12 ? "good" : ""}`}>
            {onlineMetrics.rollingTotal > 0 ? `${(onlineMetrics.rollingAccuracy * 100).toFixed(1)}%` : "—"}
          </span>
          <span className="nn-stat-sub">{onlineMetrics.rollingCorrect}/{onlineMetrics.rollingTotal} last {Math.min(onlineMetrics.rollingTotal, 200)}</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Training Loss</span>
          <span className="nn-stat-value">{modelMetrics.loss.toFixed(4)}</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Batch Accuracy</span>
          <span className={`nn-stat-value ${modelMetrics.accuracy > 0.15 ? "good" : ""}`}>
            {(modelMetrics.accuracy * 100).toFixed(1)}%
          </span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Online Updates</span>
          <span className="nn-stat-value">{onlineMetrics.onlineUpdates.toLocaleString()}</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Predictions</span>
          <span className="nn-stat-value">{onlineMetrics.totalPredictions}</span>
          <span className="nn-stat-sub">{onlineMetrics.totalCorrect} correct ({onlineMetrics.totalPredictions > 0 ? ((onlineMetrics.totalCorrect / onlineMetrics.totalPredictions) * 100).toFixed(1) : "0"}%)</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Pending</span>
          <span className="nn-stat-value">{onlineMetrics.pendingCount}</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Epochs</span>
          <span className="nn-stat-value">{modelMetrics.epoch}</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Samples</span>
          <span className="nn-stat-value">{bufferSize.toLocaleString()}</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Trained At</span>
          <span className="nn-stat-value">
            {modelMetrics.lastTrainedAt ? new Date(modelMetrics.lastTrainedAt).toLocaleTimeString() : "Never"}
          </span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Grad Norm</span>
          <span className={`nn-stat-value ${modelMetrics.lastGradNorm > 1.0 ? "bad" : modelMetrics.lastGradNorm > 0 ? "good" : ""}`}>
            {modelMetrics.lastGradNorm > 0 ? modelMetrics.lastGradNorm.toFixed(3) : "—"}
          </span>
          <span className="nn-stat-sub">clipnorm: 1.0</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Weight Divergence</span>
          <span className={`nn-stat-value ${modelMetrics.weightDivergence > 1.0 ? "bad" : modelMetrics.weightDivergence > 0 ? "good" : ""}`}>
            {modelMetrics.weightDivergence > 0 ? modelMetrics.weightDivergence.toFixed(4) : "—"}
          </span>
          <span className="nn-stat-sub">EMA vs live (L2)</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Learning Rate</span>
          <span className="nn-stat-value">
            {modelMetrics.currentLR > 0 ? modelMetrics.currentLR.toExponential(1) : "—"}
          </span>
          <span className="nn-stat-sub">EMA decay: 0.99</span>
        </div>
        <div className="nn-stat-card">
          <span className="nn-stat-label">Online Steps</span>
          <span className="nn-stat-value">{modelMetrics.onlineUpdateCount.toLocaleString()}</span>
        </div>
      </div>

      <TrainingChart modelMetrics={modelMetrics} onlineMetrics={onlineMetrics} epochHistory={epochHistory} gradNormHistory={gradNormHistory} />
      <ConfusionMatrix predictionHistory={predictionHistory} />
      <ProbDistChart probHistory={probHistory} />

      {/* Controls */}
      <div className="nn-controls">
        <button className="nn-btn" onClick={onTrainNow} disabled={modelStatus === "loading" || modelStatus === "error" || bufferSize < 10}>
          🧠 Train Now
        </button>
        <button className="nn-btn nn-btn-danger" onClick={onReset}>
          🔄 Reset Model
        </button>
        <button className="nn-btn nn-btn-export" onClick={onExportModel} disabled={modelStatus === "loading"}>
          💾 Export Model
        </button>
        <label className="nn-btn nn-btn-import">
          📂 Import Model
          <input type="file" accept=".json" style={{ display: "none" }} onChange={onImportModel} />
        </label>
        <span className="nn-hint">
          {bufferSize < 200 ? `Need ${200 - bufferSize} more samples to train` : "Model is ready for training"}
        </span>
      </div>

      {/* Neural Prediction for current market */}
      {prediction ? (
        <div className="nn-prediction">
          <h4>Digit Probability Distribution — {currentScore?.name}</h4>
          <div className="nn-prob-chart">
            {prediction.probabilities.map((prob, i) => (
              <div key={i} className="nn-prob-col">
                <div className="nn-prob-bar-wrap">
                  <div
                    className="nn-prob-bar"
                    style={{
                      height: `${Math.max(5, prob * 100)}%`,
                      background: i === prediction.topDigit ? "#37d4bd" : "#9a8ed2",
                    }}
                  />
                </div>
                <span className="nn-prob-digit">{i}</span>
                <span className="nn-prob-value">{(prob * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="nn-prediction-summary">
            <div className="nn-pred-item">
              <span className="nn-pred-label">Top Prediction</span>
              <span className="nn-pred-val good">{prediction.topDigit}</span>
            </div>
            <div className="nn-pred-item">
              <span className="nn-pred-label">Confidence</span>
              <span className={`nn-pred-val ${prediction.confidence > 40 ? "good" : ""}`}>{prediction.confidence}%</span>
            </div>
            <div className="nn-pred-item">
              <span className="nn-pred-label">Bias Strength</span>
              <span className={`nn-pred-val ${prediction.biasStrength > 0.15 ? "good" : ""}`}>{(prediction.biasStrength * 100).toFixed(0)}%</span>
            </div>
            <div className="nn-pred-item">
              <span className="nn-pred-label">Entropy</span>
              <span className="nn-pred-val">{prediction.entropy.toFixed(3)}</span>
            </div>
            <div className="nn-pred-item">
              <span className="nn-pred-label">Model Agreement</span>
              <span className="nn-pred-val">{prediction.modelAccuracy}%</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="nn-empty">
          <IconBrain size={32} style={{ opacity: 0.3 }} />
          <p>No neural prediction yet for this market.</p>
          <p className="nn-hint">Start streaming to feed tick data to the model.</p>
        </div>
      )}

      {/* Architecture info */}
      <div className="nn-arch-info">
        <h4>Model Architecture</h4>
        <div className="nn-arch-layers">
          <div className="nn-layer">Input (20×10 one-hot)</div>
          <div className="nn-layer-arrow">→</div>
          <div className="nn-layer accent">LSTM(64)</div>
          <div className="nn-layer-arrow">→</div>
          <div className="nn-layer">Dropout(0.2)</div>
          <div className="nn-layer-arrow">→</div>
          <div className="nn-layer accent">LSTM(32)</div>
          <div className="nn-layer-arrow">→</div>
          <div className="nn-layer">Dropout(0.2)</div>
          <div className="nn-layer-arrow">→</div>
          <div className="nn-layer">Dense(32, relu)</div>
          <div className="nn-layer-arrow">→</div>
          <div className="nn-layer accent">Dense(10, softmax)</div>
        </div>
      </div>

      {/* Backtesting */}
      <div className="nn-backtest">
        <div className="nn-backtest-header" onClick={() => setShowBacktest((v) => !v)}>
          <h4>🧪 Backtesting</h4>
          <span className="nn-backtest-toggle">{showBacktest ? "▾" : "▸"}</span>
        </div>
        {showBacktest && (
          <>
            <p className="nn-subtitle">Train the model on historical data and measure prediction accuracy against a held-out test set.</p>
            <div className="nn-backtest-controls">
              <div className="nn-backtest-field">
                <label>Train/Test Split</label>
                <div className="nn-backtest-slider-row">
                  <input type="range" min={60} max={95} value={trainRatio} onChange={(e) => setTrainRatio(Number(e.target.value))} disabled={isBacktesting} />
                  <span>{trainRatio}% / {100 - trainRatio}%</span>
                </div>
              </div>
              <div className="nn-backtest-field">
                <label>Epochs</label>
                <div className="nn-backtest-slider-row">
                  <input type="range" min={3} max={30} value={trainEpochs} onChange={(e) => setTrainEpochs(Number(e.target.value))} disabled={isBacktesting} />
                  <span>{trainEpochs}</span>
                </div>
              </div>
              <button className="nn-btn" onClick={handleRunBacktest} disabled={isBacktesting || bufferSize < 100}>
                {isBacktesting ? `⏳ Running... ${backtestProgress?.percentComplete.toFixed(0) ?? 0}%` : "🧪 Run Backtest"}
              </button>
            </div>

            {backtestProgress && backtestProgress.phase !== "done" && (
              <div className="nn-backtest-progress">
                <div className="nn-backtest-progress-bar">
                  <div className="nn-backtest-progress-fill" style={{ width: `${backtestProgress.percentComplete}%` }} />
                </div>
                <span className="nn-backtest-progress-label">
                  {backtestProgress.phase === "preparing" ? "Preparing data..." :
                   backtestProgress.phase === "training" ? `Training epoch ${backtestProgress.currentEpoch}/${backtestProgress.totalEpochs} (loss: ${backtestProgress.trainLoss})` :
                   "Evaluating on test set..."}
                </span>
              </div>
            )}

            {backtestError && <div className="nn-backtest-error">{backtestError}</div>}

            {backtestResult && (
              <div className="nn-backtest-results">
                <h4>Results</h4>
                <div className="nn-backtest-stats">
                  <div className="nn-stat-card accent">
                    <span className="nn-stat-label">Accuracy</span>
                    <span className={`nn-stat-value ${backtestResult.accuracy > 0.12 ? "good" : backtestResult.accuracy < 0.08 ? "bad" : ""}`}>
                      {(backtestResult.accuracy * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="nn-stat-card">
                    <span className="nn-stat-label">Top-3 Accuracy</span>
                    <span className="nn-stat-value">{(backtestResult.top3Accuracy * 100).toFixed(1)}%</span>
                  </div>
                  <div className="nn-stat-card">
                    <span className="nn-stat-label">F1 Score</span>
                    <span className="nn-stat-value">{backtestResult.f1Score.toFixed(3)}</span>
                  </div>
                  <div className="nn-stat-card">
                    <span className="nn-stat-label">Test Loss</span>
                    <span className="nn-stat-value">{backtestResult.testLoss.toFixed(4)}</span>
                  </div>
                  <div className="nn-stat-card">
                    <span className="nn-stat-label">Train / Test</span>
                    <span className="nn-stat-value" style={{ fontSize: 12 }}>{backtestResult.trainSize.toLocaleString()} / {backtestResult.testSize.toLocaleString()}</span>
                  </div>
                  <div className="nn-stat-card">
                    <span className="nn-stat-label">Epochs</span>
                    <span className="nn-stat-value">{backtestResult.epochsCompleted}</span>
                  </div>
                </div>

                <div className="nn-backtest-chart">
                  <h5>Training Loss Curve</h5>
                  <div className="nn-loss-chart">
                    {backtestResult.trainingLossHistory.map((loss, i) => {
                      const maxLoss = Math.max(...backtestResult.trainingLossHistory);
                      const minLoss = Math.min(...backtestResult.trainingLossHistory);
                      const range = maxLoss - minLoss || 1;
                      const height = ((loss - minLoss) / range) * 80 + 10;
                      return (
                        <div key={i} className="nn-loss-bar">
                          <div className="nn-loss-fill" style={{ height: `${height}%`, background: i === backtestResult.trainingLossHistory.length - 1 ? "#37d4bd" : "#9a8ed2" }} />
                          <span className="nn-loss-label">{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="nn-backtest-chart">
                  <h5>Per-Digit Accuracy</h5>
                  <div className="nn-digit-accuracy">
                    {backtestResult.digitAccuracy.map((d) => (
                      <div key={d.digit} className="nn-digit-acc-col">
                        <div className="nn-digit-acc-bar-wrap">
                          <div
                            className="nn-digit-acc-bar"
                            style={{
                              height: `${Math.max(5, d.accuracy * 100)}%`,
                              background: d.accuracy > 0.12 ? "#37d4bd" : d.accuracy > 0.08 ? "#f0c040" : "#e05555",
                            }}
                          />
                        </div>
                        <span className="nn-digit-acc-digit">{d.digit}</span>
                        <span className="nn-digit-acc-pct">{(d.accuracy * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="nn-backtest-chart">
                  <h5>Confusion Matrix</h5>
                  <div className="nn-confusion-matrix">
                    <div className="nn-confusion-header">
                      <span className="nn-confusion-corner">A↓ P→</span>
                      {Array.from({ length: 10 }, (_, i) => (
                        <span key={i} className="nn-confusion-cell-label">{i}</span>
                      ))}
                    </div>
                    {backtestResult.confusionMatrix.map((row, actual) => {
                      const maxInRow = Math.max(...row) || 1;
                      return (
                        <div key={actual} className="nn-confusion-row">
                          <span className="nn-confusion-cell-label">{actual}</span>
                          {row.map((val, predicted) => {
                            const isDiag = actual === predicted;
                            const intensity = val / maxInRow;
                            return (
                              <span
                                key={predicted}
                                className={`nn-confusion-cell ${isDiag ? "diag" : ""}`}
                                style={{
                                  background: isDiag
                                    ? `rgba(55,212,189,${0.15 + intensity * 0.6})`
                                    : `rgba(255,255,255,${intensity * 0.15})`,
                                  color: intensity > 0.5 ? "#fff" : "#718197",
                                }}
                              >
                                {val}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="nn-backtest-chart">
                  <h5>Precision / Recall by Digit</h5>
                  <div className="nn-precision-recall">
                    {backtestResult.precision.map((prec, d) => (
                      <div key={d} className="nn-pr-row">
                        <span className="nn-pr-digit">{d}</span>
                        <div className="nn-pr-bar-wrap">
                          <div className="nn-pr-bar prec" style={{ width: `${prec * 100}%` }} />
                          <span className="nn-pr-val">{(prec * 100).toFixed(0)}%</span>
                        </div>
                        <div className="nn-pr-bar-wrap">
                          <div className="nn-pr-bar rec" style={{ width: `${backtestResult.recall[d] * 100}%` }} />
                          <span className="nn-pr-val">{(backtestResult.recall[d] * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="nn-pr-legend">
                    <span className="nn-pr-legend-item"><span className="nn-pr-dot prec" /> Precision</span>
                    <span className="nn-pr-legend-item"><span className="nn-pr-dot rec" /> Recall</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ModelComparison currentPredictor={predictor} predictionHistory={predictionHistory} />
      <AutoModelSelection modelMetrics={modelMetrics} predictionHistory={predictionHistory} onResetModel={onReset} />
      <TrainingScheduler bufferSize={bufferSize} modelStatus={modelStatus} onTrainNow={onTrainNow} lastTrainedAt={modelMetrics.lastTrainedAt} />

      <style jsx>{`
        .nn-view { display: flex; flex-direction: column; gap: 16px; }
        .nn-header h3 { margin: 0; font-size: 15px; }
        .nn-subtitle { font-size: 12px; color: var(--muted, #718197); margin: 4px 0 0; }
        .nn-status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
        .nn-stat-card { padding: 10px 12px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; display: flex; flex-direction: column; gap: 2px; }
        .nn-stat-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .nn-stat-value { font-size: 14px; font-weight: 700; color: var(--text, #d9e3ed); }
        .nn-stat-value.good { color: #37d4bd; }
        .nn-stat-value.bad { color: #e05555; }
        .nn-stat-sub { font-size: 10px; color: #566477; }
        .nn-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .nn-btn { padding: 7px 14px; background: rgba(154,142,210,.1); border: 1px solid rgba(154,142,210,.3); border-radius: 6px; color: #9a8ed2; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s; }
        .nn-btn:hover:not(:disabled) { background: rgba(154,142,210,.2); }
        .nn-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .nn-btn-danger { border-color: rgba(224,85,85,.3); color: #e05555; background: rgba(224,85,85,.08); }
        .nn-btn-danger:hover { background: rgba(224,85,85,.15); }
        .nn-btn-export { border-color: rgba(154,142,210,.3); color: #9a8ed2; background: rgba(154,142,210,.08); }
        .nn-btn-export:hover { background: rgba(154,142,210,.15); }
        .nn-btn-import { border-color: rgba(55,212,189,.3); color: #37d4bd; background: rgba(55,212,189,.08); cursor: pointer; }
        .nn-btn-import:hover { background: rgba(55,212,189,.15); }
        .nn-hint { font-size: 11px; color: #566477; }
        .nn-prediction h4 { margin: 0 0 12px; font-size: 14px; }
        .nn-prob-chart { display: flex; gap: 6px; align-items: flex-end; padding: 16px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 10px; height: 180px; }
        .nn-prob-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
        .nn-prob-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
        .nn-prob-bar { width: 80%; border-radius: 3px 3px 0 0; transition: height 0.5s; min-height: 3px; }
        .nn-prob-digit { font-size: 13px; font-weight: 700; color: var(--text, #d9e3ed); }
        .nn-prob-value { font-size: 9px; color: #566477; }
        .nn-prediction-summary { display: flex; gap: 16px; flex-wrap: wrap; padding: 10px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; margin-top: 8px; }
        .nn-pred-item { display: flex; flex-direction: column; gap: 2px; }
        .nn-pred-label { font-size: 10px; color: #566477; text-transform: uppercase; }
        .nn-pred-val { font-size: 14px; font-weight: 700; color: var(--text, #d9e3ed); }
        .nn-pred-val.good { color: #37d4bd; }
        .nn-empty { display: flex; flex-direction: column; align-items: center; padding: 40px 20px; text-align: center; color: var(--muted, #718197); }
        .nn-empty p { margin: 6px 0; font-size: 13px; }
        .nn-arch-info { padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; }
        .nn-arch-info h4 { margin: 0 0 8px; font-size: 13px; color: var(--muted, #718197); }
        .nn-arch-layers { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; }
        .nn-layer { padding: 4px 8px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 4px; color: #8899aa; font-family: monospace; }
        .nn-layer.accent { border-color: rgba(154,142,210,.3); color: #9a8ed2; }
        .nn-layer-arrow { color: #566477; }
        .nn-stat-card.accent { border-color: rgba(154,142,210,.3); }
        .nn-backtest { padding: 12px 14px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; }
        .nn-backtest-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        .nn-backtest-header h4 { margin: 0; font-size: 14px; color: var(--text, #d9e3ed); }
        .nn-backtest-toggle { color: #566477; font-size: 12px; }
        .nn-backtest-controls { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; margin-top: 12px; }
        .nn-backtest-field { display: flex; flex-direction: column; gap: 4px; }
        .nn-backtest-field label { font-size: 11px; color: #566477; }
        .nn-backtest-slider-row { display: flex; align-items: center; gap: 8px; }
        .nn-backtest-slider-row input[type="range"] { width: 120px; accent-color: #9a8ed2; }
        .nn-backtest-slider-row span { font-size: 12px; color: var(--text, #d9e3ed); min-width: 60px; }
        .nn-backtest-progress { margin-top: 10px; }
        .nn-backtest-progress-bar { height: 6px; background: #1a2332; border-radius: 3px; overflow: hidden; }
        .nn-backtest-progress-fill { height: 100%; background: linear-gradient(90deg, #9a8ed2, #37d4bd); border-radius: 3px; transition: width 0.3s; }
        .nn-backtest-progress-label { font-size: 11px; color: #566477; margin-top: 4px; display: block; }
        .nn-backtest-error { padding: 8px 12px; background: rgba(224,85,85,.08); border: 1px solid rgba(224,85,85,.3); border-radius: 6px; color: #e05555; font-size: 12px; margin-top: 8px; }
        .nn-backtest-results { margin-top: 16px; }
        .nn-backtest-results h4 { margin: 0 0 10px; font-size: 14px; }
        .nn-backtest-results h5 { margin: 12px 0 6px; font-size: 12px; color: var(--muted, #718197); }
        .nn-backtest-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
        .nn-backtest-chart { margin-top: 12px; }
        .nn-loss-chart { display: flex; gap: 3px; align-items: flex-end; height: 120px; padding: 10px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; }
        .nn-loss-bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
        .nn-loss-fill { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s; }
        .nn-loss-label { font-size: 8px; color: #566477; margin-top: 2px; }
        .nn-digit-accuracy { display: flex; gap: 6px; align-items: flex-end; height: 140px; padding: 10px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; }
        .nn-digit-acc-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; height: 100%; }
        .nn-digit-acc-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
        .nn-digit-acc-bar { width: 80%; border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.5s; }
        .nn-digit-acc-digit { font-size: 12px; font-weight: 700; color: var(--text, #d9e3ed); }
        .nn-digit-acc-pct { font-size: 9px; color: #566477; }
        .nn-confusion-matrix { overflow-x: auto; padding: 10px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; }
        .nn-confusion-header { display: flex; }
        .nn-confusion-row { display: flex; }
        .nn-confusion-corner { width: 30px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #566477; }
        .nn-confusion-cell-label { width: 30px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #566477; }
        .nn-confusion-cell { width: 30px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-family: monospace; border-radius: 2px; }
        .nn-confusion-cell.diag { font-weight: 700; }
        .nn-precision-recall { display: flex; flex-direction: column; gap: 4px; padding: 10px; background: #0c141f; border: 1px solid var(--border, #2a3444); border-radius: 8px; }
        .nn-pr-row { display: flex; align-items: center; gap: 6px; }
        .nn-pr-digit { width: 16px; font-size: 11px; font-weight: 700; color: var(--text, #d9e3ed); text-align: center; }
        .nn-pr-bar-wrap { flex: 1; height: 8px; background: rgba(255,255,255,.04); border-radius: 4px; position: relative; }
        .nn-pr-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
        .nn-pr-bar.prec { background: #9a8ed2; }
        .nn-pr-bar.rec { background: #37d4bd; }
        .nn-pr-val { font-size: 9px; color: #566477; position: absolute; right: 4px; top: -1px; }
        .nn-pr-legend { display: flex; gap: 16px; margin-top: 6px; font-size: 10px; color: #566477; }
        .nn-pr-legend-item { display: flex; align-items: center; gap: 4px; }
        .nn-pr-dot { width: 8px; height: 8px; border-radius: 50%; }
        .nn-pr-dot.prec { background: #9a8ed2; }
        .nn-pr-dot.rec { background: #37d4bd; }
      `}</style>
    </div>
  );
}
