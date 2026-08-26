/**
 * Digit Prediction Model — Web Worker Proxy
 *
 * ALL TensorFlow.js operations run in a Web Worker (tf-worker.js),
 * keeping the main thread free for UI and tick processing.
 *
 * Main thread keeps: digitBuffer, predictionQueue, rollingHistory, callbacks
 * Worker handles: model build, predict, trainOnBatch, batchTrain, backtest
 */

export type ModelStatus = "idle" | "loading" | "ready" | "training" | "error";

export type TrainingMetrics = {
  loss: number; accuracy: number; epoch: number; samplesTrained: number; lastTrainedAt: number;
  lastGradNorm: number; currentLR: number; onlineUpdateCount: number;
};

export type OnlineLearningMetrics = {
  rollingAccuracy: number; rollingCorrect: number; rollingTotal: number;
  totalCorrect: number; totalPredictions: number; pendingCount: number;
  onlineUpdates: number; lastConfidence: number; isOnlineLearning: boolean;
};

export type BacktestResult = {
  completed: boolean; totalSamples: number; trainSize: number; testSize: number;
  accuracy: number; digitAccuracy: { digit: number; correct: number; total: number; accuracy: number }[];
  confusionMatrix: number[][]; testLoss: number; epochsCompleted: number;
  trainingLossHistory: number[]; precision: number[]; recall: number[];
  f1Score: number; top3Accuracy: number; completedAt: number;
};

export type BacktestProgress = {
  phase: "preparing" | "training" | "evaluating" | "done";
  currentEpoch: number; totalEpochs: number; trainLoss: number; percentComplete: number;
};

export type EpochProgress = {
  epoch: number; totalEpochs: number;
  loss: number; accuracy: number;
  valLoss: number; valAccuracy: number;
  samplesInBatch: number;
  timestamp: number;
};

export type DigitPrediction = {
  probabilities: number[]; topDigit: number; confidence: number;
  biasStrength: number; overUnder5Bias: "over" | "under" | "neutral"; entropy: number;
};

export type PredictionRecord = {
  inputSequence: number[]; predictedProbs: number[]; topDigit: number;
  confidence: number; timestamp: number; actualDigit: number | null; correct: boolean | null;
};

/* ---- Configuration ---- */

const SEQUENCE_LENGTH = 20;
const MIN_SAMPLES_TO_TRAIN = 200;
const MAX_BUFFER_SIZE = 10000;
const MAX_PREDICTION_QUEUE = 500;
const ROLLING_WINDOW = 200;
const BATCH_TRAIN_INTERVAL_MS = 10_000;
const SAVE_INTERVAL_MS = 30_000;
const MODEL_STORAGE_KEY = "dtrader_digit_model";
const METRICS_STORAGE_KEY = "dtrader_digit_metrics";
const ONLINE_METRICS_KEY = "dtrader_online_metrics";

/* ---- Worker ---- */

const WORKER_KEY = "__dtrader_tf_worker__";
const WORKER_READY_KEY = "__dtrader_tf_worker_ready__";
// Use globalThis to persist across HMR reloads
if (!(globalThis as any)[WORKER_READY_KEY]) (globalThis as any)[WORKER_READY_KEY] = false;
function getWorkerRef(): Worker | null { return (globalThis as any)[WORKER_KEY] ?? null; }
function setWorkerRef(w: Worker | null) { (globalThis as any)[WORKER_KEY] = w; }
let workerReady = (globalThis as any)[WORKER_READY_KEY] as boolean;
let nextMsgId = 1;
const pendingCallbacks = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
const pendingInits: Array<() => void> = [];
const globalBacktestProgressCallbacks = new Set<(p: BacktestProgress) => void>();
const globalBacktestDoneCallbacks = new Set<(r: BacktestResult | null) => void>();
let globalBacktestResult: BacktestResult | null = null;
let globalBacktestError: string | null = null;
let isGlobalBacktesting = false;

function initWorker(): Worker {
  const existing = getWorkerRef();
  if (existing) return existing;
  workerReady = false;
  (globalThis as any)[WORKER_READY_KEY] = false;
  const w = new Worker("/tf-worker.js");
  setWorkerRef(w);
  w.onmessage = (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "status":
        if (msg.status === "ready") {
          workerReady = true;
          (globalThis as any)[WORKER_READY_KEY] = true;
          for (const fn of pendingInits) fn();
          pendingInits.length = 0;
        }
        break;
      case "prediction": case "trainResult": case "batchTrainResult": case "modelData": {
        const entry = pendingCallbacks.get(String(msg.id));
        if (entry) { entry.resolve(msg.result); pendingCallbacks.delete(String(msg.id)); }
        break;
      }
      case "backtestProgress":
        for (const cb of globalBacktestProgressCallbacks) cb({
          phase: msg.phase ?? "training", currentEpoch: msg.currentEpoch ?? 0,
          totalEpochs: msg.totalEpochs ?? 1, trainLoss: msg.trainLoss ?? 0,
          percentComplete: msg.percentComplete ?? 0,
        });
        break;
      case "backtestResult":
        globalBacktestResult = msg.result;
        for (const cb of globalBacktestDoneCallbacks) cb(msg.result);
        break;
      case "backtestError":
        globalBacktestError = msg.error;
        for (const cb of globalBacktestDoneCallbacks) cb(null);
        break;
      case "trainProgress": {
        // Per-epoch training progress from batch training
        const epochData: EpochProgress = {
          epoch: msg.epoch ?? 0,
          totalEpochs: msg.totalEpochs ?? 2,
          loss: msg.loss ?? 0,
          accuracy: msg.accuracy ?? 0,
          valLoss: msg.valLoss ?? 0,
          valAccuracy: msg.valAccuracy ?? 0,
          samplesInBatch: msg.samplesInBatch ?? 0,
          timestamp: Date.now(),
        };
        // Store in singleton instance
        const inst = instance;
        if (inst) {
          (inst as any).epochHistory.push(epochData);
          if ((inst as any).epochHistory.length > 200) (inst as any).epochHistory = (inst as any).epochHistory.slice(-200);
          for (const cb of (inst as any).epochHistoryCallbacks) cb([...(inst as any).epochHistory]);
        }
        break;
      }
    }
  };
  w.onerror = (err) => console.error("TF Worker error:", err);
  return w;
}

function postToWorker(msg: Record<string, unknown>): void { initWorker().postMessage(msg); }
function waitForWorker(): Promise<void> { if (workerReady) return Promise.resolve(); return new Promise((r) => pendingInits.push(r)); }
function genId(): string { return `m${nextMsgId++}`; }
function postAsync<T>(msg: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = genId();
    pendingCallbacks.set(id, { resolve: resolve as (v: unknown) => void, reject });
    postToWorker({ ...msg, id });
  });
}

/* ---- DigitPredictor ---- */

export class DigitPredictor {
  private status: ModelStatus = "idle";
  private statusCallbacks = new Set<(s: ModelStatus) => void>();
  private metrics: TrainingMetrics = { loss: 0, accuracy: 0, epoch: 0, samplesTrained: 0, lastTrainedAt: 0, lastGradNorm: 0, currentLR: 0, onlineUpdateCount: 0 };
  private metricsCallbacks = new Set<(m: TrainingMetrics) => void>();
  private digitBuffer: number[] = [];
  private predictionQueue: PredictionRecord[] = [];
  private rollingHistory: { correct: boolean }[] = [];
  private onlineMetrics: OnlineLearningMetrics = {
    rollingAccuracy: 0, rollingCorrect: 0, rollingTotal: 0, totalCorrect: 0, totalPredictions: 0,
    pendingCount: 0, onlineUpdates: 0, lastConfidence: 0, isOnlineLearning: false,
  };
  private onlineMetricsCallbacks = new Set<(m: OnlineLearningMetrics) => void>();
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private batchTrainTimer: ReturnType<typeof setInterval> | null = null;
  private isOnlineTraining = false;
  private isBatchTraining = false;
  private initialBatchDone = false;
  private epochHistory: EpochProgress[] = [];
  private epochHistoryCallbacks = new Set<(h: EpochProgress[]) => void>();

  async init(): Promise<void> {
    this.setStatus("loading");
    try {
      initWorker();
      const saved = await this.loadModelFromStorage();
      if (!saved) postToWorker({ type: "init" });
      this.loadMetrics();
      this.loadOnlineMetrics();
      await waitForWorker();
      this.setStatus("ready");
    } catch (err) {
      console.error("DigitPredictor init failed:", err);
      postToWorker({ type: "init" });
      await waitForWorker();
      this.setStatus("ready");
    }
  }

  dispose(): void { this.stopOnlineLearning(); postToWorker({ type: "dispose" }); this.digitBuffer = []; this.predictionQueue = []; }

  onStatusChange(cb: (s: ModelStatus) => void): () => void { this.statusCallbacks.add(cb); return () => this.statusCallbacks.delete(cb); }
  onMetricsUpdate(cb: (m: TrainingMetrics) => void): () => void { this.metricsCallbacks.add(cb); return () => this.metricsCallbacks.delete(cb); }
  onOnlineMetricsUpdate(cb: (m: OnlineLearningMetrics) => void): () => void { this.onlineMetricsCallbacks.add(cb); return () => this.onlineMetricsCallbacks.delete(cb); }
  onEpochHistory(cb: (h: EpochProgress[]) => void): () => void { this.epochHistoryCallbacks.add(cb); return () => this.epochHistoryCallbacks.delete(cb); }
  getEpochHistory(): EpochProgress[] { return [...this.epochHistory]; }
  getStatus(): ModelStatus { return this.status; }
  getMetrics(): TrainingMetrics { return { ...this.metrics }; }
  getOnlineMetrics(): OnlineLearningMetrics { return { ...this.onlineMetrics }; }

  private setStatus(s: ModelStatus): void { this.status = s; for (const cb of this.statusCallbacks) cb(s); }
  private emitMetrics(): void { for (const cb of this.metricsCallbacks) cb({ ...this.metrics }); }
  private emitOnlineMetrics(): void {
    this.onlineMetrics.pendingCount = this.predictionQueue.filter((p) => p.actualDigit === null).length;
    for (const cb of this.onlineMetricsCallbacks) cb({ ...this.onlineMetrics });
  }

  /* ---- Data ingestion ---- */

  addDigitAndLearn(digit: number): void {
    this.digitBuffer.push(digit);
    if (this.digitBuffer.length > MAX_BUFFER_SIZE) this.digitBuffer.splice(0, this.digitBuffer.length - MAX_BUFFER_SIZE);
    if (workerReady && this.status === "ready" && !this.isOnlineTraining) this.validateAndTrain(digit);
    if (workerReady && this.digitBuffer.length >= SEQUENCE_LENGTH) this.predictAsync();
    this.emitOnlineMetrics();
  }

  addDigits(digits: number[]): void { for (const d of digits) this.digitBuffer.push(d); if (this.digitBuffer.length > MAX_BUFFER_SIZE) this.digitBuffer.splice(0, this.digitBuffer.length - MAX_BUFFER_SIZE); }
  addDigit(digit: number): void { this.digitBuffer.push(digit); if (this.digitBuffer.length > MAX_BUFFER_SIZE) this.digitBuffer.splice(0, this.digitBuffer.length - MAX_BUFFER_SIZE); }
  getBufferSize(): number { return this.digitBuffer.length; }
  getPredictionQueueSize(): number { return this.predictionQueue.length; }
  getPredictionHistory(): PredictionRecord[] { return [...this.predictionQueue]; }

  private async predictAsync(): Promise<void> {
    if (!workerReady) return;
    try {
      const result = await postAsync<DigitPrediction | null>({ type: "predict", inputSequence: this.digitBuffer.slice(-SEQUENCE_LENGTH) });
      if (result) {
        this.predictionQueue.push({ inputSequence: this.digitBuffer.slice(-SEQUENCE_LENGTH), predictedProbs: result.probabilities, topDigit: result.topDigit, confidence: result.confidence, timestamp: Date.now(), actualDigit: null, correct: null });
        this.onlineMetrics.lastConfidence = result.confidence;
        if (this.predictionQueue.length > MAX_PREDICTION_QUEUE) this.predictionQueue = this.predictionQueue.slice(-MAX_PREDICTION_QUEUE);
      }
    } catch { /* worker not ready */ }
  }

  predict(_recentDigits?: number[]): DigitPrediction | null {
    const last = this.predictionQueue[this.predictionQueue.length - 1];
    if (last) return { probabilities: last.predictedProbs, topDigit: last.topDigit, confidence: last.confidence, biasStrength: 0, overUnder5Bias: "neutral", entropy: 0 };
    return null;
  }

  /* ---- Online learning ---- */

  private async validateAndTrain(actualDigit: number): Promise<void> {
    if (this.isOnlineTraining) return;
    const pending = this.predictionQueue.filter((p) => p.actualDigit === null);
    if (pending.length === 0) return;
    this.isOnlineTraining = true;
    this.onlineMetrics.isOnlineLearning = true;
    this.emitOnlineMetrics();
    try {
      const xs: number[][][] = [], ys: number[][] = [];
      for (const pred of pending) {
        pred.actualDigit = actualDigit;
        pred.correct = pred.topDigit === actualDigit;
        this.rollingHistory.push({ correct: pred.correct });
        if (this.rollingHistory.length > ROLLING_WINDOW) this.rollingHistory.shift();
        this.onlineMetrics.totalPredictions++;
        if (pred.correct) this.onlineMetrics.totalCorrect++;
        xs.push(pred.inputSequence.map((d) => { const oh = new Array(10).fill(0); oh[d] = 1; return oh; }));
        const target = new Array(10).fill(0); target[actualDigit] = 1; ys.push(target);
      }
      if (this.rollingHistory.length > 0) {
        const correct = this.rollingHistory.filter((h) => h.correct).length;
        this.onlineMetrics.rollingCorrect = correct;
        this.onlineMetrics.rollingTotal = this.rollingHistory.length;
        this.onlineMetrics.rollingAccuracy = correct / this.rollingHistory.length;
      }
      if (xs.length > 0 && workerReady) {
        this.onlineMetrics.onlineUpdates += xs.length;
        this.metrics.samplesTrained += xs.length;
        this.metrics.lastTrainedAt = Date.now();
        const result = await postAsync<{ loss: number; gradNorm?: number; lr?: number; updateCount?: number }>({ type: "trainOnBatch", xs, ys });
        const loss = result?.loss ?? 0;
        this.metrics.loss = this.metrics.loss * 0.9 + loss * 0.1;
        this.metrics.loss = Math.round(this.metrics.loss * 10000) / 10000;
        if (result?.gradNorm !== undefined) this.metrics.lastGradNorm = result.gradNorm;
        if (result?.lr !== undefined) this.metrics.currentLR = result.lr;
        if (result?.updateCount !== undefined) this.metrics.onlineUpdateCount = result.updateCount;
        if (this.rollingHistory.length > 0) this.metrics.accuracy = this.onlineMetrics.rollingAccuracy;
      }
      this.predictionQueue = this.predictionQueue.filter((p) => p.actualDigit === null || Date.now() - p.timestamp < 60_000);
      this.emitOnlineMetrics();
      this.emitMetrics();
    } catch (err) { console.error("Online learning error:", err); }
    finally { this.isOnlineTraining = false; this.onlineMetrics.isOnlineLearning = false; this.emitOnlineMetrics(); }
  }

  /* ---- Training controls ---- */

  startOnlineLearning(): void {
    this.stopOnlineLearning();
    this.batchTrainTimer = setInterval(() => {
      console.log("[TF] batchTrainTimer fired: workerReady=", workerReady, "bufferSize=", this.digitBuffer.length, "status=", this.status);
      if (!this.initialBatchDone && this.digitBuffer.length >= MIN_SAMPLES_TO_TRAIN) { this.batchTrainStep(); this.initialBatchDone = true; }
      else if (this.digitBuffer.length >= MIN_SAMPLES_TO_TRAIN) this.batchTrainStep();
    }, BATCH_TRAIN_INTERVAL_MS);
    this.saveTimer = setInterval(() => { this.saveModelToStorage(); this.saveMetrics(); this.saveOnlineMetrics(); }, SAVE_INTERVAL_MS);
    this.onlineMetrics.isOnlineLearning = true;
    this.emitOnlineMetrics();
  }

  stopOnlineLearning(): void {
    if (this.batchTrainTimer) { clearInterval(this.batchTrainTimer); this.batchTrainTimer = null; }
    if (this.saveTimer) { clearInterval(this.saveTimer); this.saveTimer = null; }
    this.onlineMetrics.isOnlineLearning = false;
    this.emitOnlineMetrics();
  }

  startTraining(): void { this.startOnlineLearning(); }
  stopTraining(): void { this.stopOnlineLearning(); }

  private async batchTrainStep(): Promise<void> {
    console.log("[TF] batchTrainStep called: workerReady=", workerReady, "bufferSize=", this.digitBuffer.length, "isBatchTraining=", this.isBatchTraining);
    if (!workerReady || this.digitBuffer.length < MIN_SAMPLES_TO_TRAIN || this.isBatchTraining) return;
    this.isBatchTraining = true;
    try {
      const result = await postAsync<{ loss: number; accuracy: number; epoch: number }>({
        type: "batchTrain", digitBuffer: this.digitBuffer.slice(-5000), seqLength: SEQUENCE_LENGTH, batchSize: 32, epochs: 2, stride: 3,
      });
      // If epoch=0 loss=0, the worker's model is stale (HMR). Re-init.
      if (result.epoch === 0 && result.loss === 0 && this.digitBuffer.length >= MIN_SAMPLES_TO_TRAIN) {
        console.log("[TF] Worker model stale, re-initializing...");
        workerReady = false;
        setWorkerRef(null);
        postToWorker({ type: "init" });
        await waitForWorker();
        return; // Skip this batch, next timer will retry
      }
      this.metrics.loss = result.loss;
      this.metrics.accuracy = result.accuracy;
      this.metrics.epoch += result.epoch;
      this.metrics.lastTrainedAt = Date.now();
      this.emitMetrics();
      console.log("[TF] batchTrain completed: epoch=", this.metrics.epoch, "loss=", this.metrics.loss);
    } catch (err) { console.error("Batch training error:", err); }
    finally { this.isBatchTraining = false; }
  }

  /* ---- Persistence ---- */

  private async saveModelToStorage(): Promise<void> {
    if (!workerReady) return;
    try {
      const data = await postAsync<{ topology: unknown; weightData: unknown }>({ type: "getModelData" });
      if (data.topology) {
        localStorage.setItem(MODEL_STORAGE_KEY + "_topology", JSON.stringify(data.topology));
        localStorage.setItem(MODEL_STORAGE_KEY + "_weights", JSON.stringify(data.weightData));
      }
    } catch { /* storage full */ }
  }

  private async loadModelFromStorage(): Promise<boolean> {
    try {
      const topoStr = localStorage.getItem(MODEL_STORAGE_KEY + "_topology");
      const wStr = localStorage.getItem(MODEL_STORAGE_KEY + "_weights");
      if (!topoStr || !wStr) return false;
      postToWorker({ type: "init", topology: JSON.parse(topoStr), weightData: JSON.parse(wStr) });
      return true;
    } catch { return false; }
  }

  private saveMetrics(): void { try { localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(this.metrics)); } catch { /* */ } }
  private loadMetrics(): void { try { const s = localStorage.getItem(METRICS_STORAGE_KEY); if (s) { this.metrics = { ...this.metrics, ...JSON.parse(s) }; this.emitMetrics(); } } catch { /* */ } }
  private saveOnlineMetrics(): void { try { localStorage.setItem(ONLINE_METRICS_KEY, JSON.stringify({ totalCorrect: this.onlineMetrics.totalCorrect, totalPredictions: this.onlineMetrics.totalPredictions, onlineUpdates: this.onlineMetrics.onlineUpdates })); } catch { /* */ } }
  private loadOnlineMetrics(): void { try { const s = localStorage.getItem(ONLINE_METRICS_KEY); if (s) { const sv = JSON.parse(s); this.onlineMetrics.totalCorrect = sv.totalCorrect ?? 0; this.onlineMetrics.totalPredictions = sv.totalPredictions ?? 0; this.onlineMetrics.onlineUpdates = sv.onlineUpdates ?? 0; this.emitOnlineMetrics(); } } catch { /* */ } }

  async trainNow(): Promise<void> { await this.batchTrainStep(); }

  async reset(): Promise<void> {
    this.stopOnlineLearning();
    postToWorker({ type: "reset" });
    await waitForWorker();
    this.metrics = { loss: 0, accuracy: 0, epoch: 0, samplesTrained: 0, lastTrainedAt: 0, lastGradNorm: 0, currentLR: 0, onlineUpdateCount: 0 };
    this.onlineMetrics = { rollingAccuracy: 0, rollingCorrect: 0, rollingTotal: 0, totalCorrect: 0, totalPredictions: 0, pendingCount: 0, onlineUpdates: 0, lastConfidence: 0, isOnlineLearning: false };
    this.digitBuffer = []; this.predictionQueue = []; this.rollingHistory = []; this.initialBatchDone = false; this.isBatchTraining = false; this.epochHistory = [];
    localStorage.removeItem(MODEL_STORAGE_KEY + "_topology"); localStorage.removeItem(MODEL_STORAGE_KEY + "_weights");
    localStorage.removeItem(METRICS_STORAGE_KEY); localStorage.removeItem(ONLINE_METRICS_KEY);
    this.emitMetrics(); this.emitOnlineMetrics(); this.setStatus("ready");
  }

  /* ---- Backtesting ---- */

  private backtestCallbacks = new Set<(p: BacktestProgress) => void>();
  private backtestResult: BacktestResult | null = null;

  onBacktestProgress(cb: (p: BacktestProgress) => void): () => void { this.backtestCallbacks.add(cb); return () => this.backtestCallbacks.delete(cb); }
  getBacktestResult(): BacktestResult | null { return this.backtestResult; }
  isBacktestRunning(): boolean { return isGlobalBacktesting; }

  async runBacktest(digits: number[], trainRatio = 0.8, epochs = 10): Promise<BacktestResult> {
    if (isGlobalBacktesting) throw new Error("Backtest already in progress");
    if (digits.length < SEQUENCE_LENGTH + 50) throw new Error(`Need at least ${SEQUENCE_LENGTH + 50} digits`);
    isGlobalBacktesting = true;
    globalBacktestResult = null; globalBacktestError = null;
    const progHandler = (p: BacktestProgress) => { for (const cb of this.backtestCallbacks) cb(p); };
    const doneHandler = (r: BacktestResult | null) => { if (r) this.backtestResult = r; };
    globalBacktestProgressCallbacks.add(progHandler);
    globalBacktestDoneCallbacks.add(doneHandler);
    try {
      postToWorker({ type: "backtest", digits, trainRatio, epochs });
      return await new Promise<BacktestResult>((resolve, reject) => {
        const check = setInterval(() => {
          if (globalBacktestResult) { clearInterval(check); isGlobalBacktesting = false; globalBacktestProgressCallbacks.delete(progHandler); globalBacktestDoneCallbacks.delete(doneHandler); resolve(globalBacktestResult); }
          else if (globalBacktestError) { clearInterval(check); isGlobalBacktesting = false; globalBacktestProgressCallbacks.delete(progHandler); globalBacktestDoneCallbacks.delete(doneHandler); reject(new Error(globalBacktestError)); }
        }, 200);
      });
    } finally { isGlobalBacktesting = false; globalBacktestProgressCallbacks.delete(progHandler); globalBacktestDoneCallbacks.delete(doneHandler); }
  }
}

/* ---- Singleton ---- */

let instance: DigitPredictor | null = null;
export function getDigitPredictor(): DigitPredictor { if (!instance) instance = new DigitPredictor(); return instance; }
