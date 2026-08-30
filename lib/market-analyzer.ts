/**
 * Market Analyzer — ML-powered digit analysis engine
 *
 * Analyzes tick streams across multiple Volatility indices to find
 * statistically biased digit distributions. Self-learns by tracking
 * which predictions were correct and adjusting weights over time.
 *
 * Core insight:
 *   Under N → digits > N should appear <10% of the time
 *              most frequent digit should be ≥3 away from N
 *   Over N  → digits < N should appear <10% of the time
 *              most frequent digit should be ≥3 away from N
 */

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type MarketSymbol = {
  symbol: string;
  name: string;
  category: "volatility" | "crash" | "boom";
};

export const ALL_MARKETS: MarketSymbol[] = [
  { symbol: "1HZ10V", name: "Volatility 10 (1s)", category: "volatility" },
  { symbol: "1HZ25V", name: "Volatility 25 (1s)", category: "volatility" },
  { symbol: "1HZ50V", name: "Volatility 50 (1s)", category: "volatility" },
  { symbol: "1HZ75V", name: "Volatility 75 (1s)", category: "volatility" },
  { symbol: "1HZ100V", name: "Volatility 100 (1s)", category: "volatility" },
  { symbol: "1HZ10", name: "Volatility 10", category: "volatility" },
  { symbol: "1HZ25", name: "Volatility 25", category: "volatility" },
  { symbol: "1HZ50", name: "Volatility 50", category: "volatility" },
  { symbol: "1HZ75", name: "Volatility 75", category: "volatility" },
  { symbol: "1HZ100", name: "Volatility 100", category: "volatility" },
  { symbol: "1HZ100C10", name: "Crash 1000", category: "crash" },
  { symbol: "1HZ100C5", name: "Crash 500", category: "crash" },
  { symbol: "1HZ100B10", name: "Boom 1000", category: "boom" },
  { symbol: "1HZ100B5", name: "Boom 500", category: "boom" },
];

export type DigitStats = {
  digit: number;
  count: number;
  frequency: number;       // 0-100 percentage
  recentFrequency: number; // last 100 ticks
  trend: number;           // -1 = declining, 0 = stable, +1 = rising
  bias: number;            // -1 to 1, negative = underrepresented
};

export type NeuralPrediction = {
  probabilities: number[];
  topDigit: number;
  confidence: number;
  biasStrength: number;
  entropy: number;
  modelStatus: string;
  modelAccuracy: number;
};

export type MarketScore = {
  symbol: string;
  name: string;
  category: string;
  // Overall market quality score (0-100)
  overallScore: number;
  // For each digit, how good a trade it would be
  digitScores: DigitTradeScore[];
  // Best recommended trade
  bestTrade: DigitTradeScore | null;
  // Even/Odd analysis
  evenOddScore: EvenOddScore;
  // Matches/Differs analysis
  matchesDiffersScore: MatchesDiffersScore;
  // Tick statistics
  tickCount: number;
  entropy: number;       // randomness measure (0=biased, 1=random)
  // Neural network prediction
  neuralPrediction: NeuralPrediction | null;
  lastUpdated: number;
};

export type DigitTradeScore = {
  digit: number;
  direction: "over" | "under";
  score: number;          // 0-100 (final blended score)
  rawScore: number;       // 0-100 (statistical-only score before neural blending)
  confidence: number;     // 0-100
  expectedEdge: number;   // expected profit per $1 bet
  reasons: string[];
  // Constraint checks
  underDigitsBelowThreshold: boolean;  // digits > N are <10%
  overDigitsBelowThreshold: boolean;   // digits < N are <10%
  mostFrequentFarEnough: boolean;      // most frequent digit ≥3 away
  distributionSkew: number;            // -1 to 1
  // Neural blending
  neuralContribution: number;           // how much neural model changed the score (-100 to +100)
  neuralAgreement: boolean;            // does neural agree with statistical direction
};

export type EvenOddScore = {
  evenScore: number;
  oddScore: number;
  evenFrequency: number;
  oddFrequency: number;
  evenTrend: number;
  oddTrend: number;
  bestDirection: "even" | "odd" | null;
  confidence: number;
  reasons: string[];
};

export type MatchesDiffersScore = {
  matchScore: number;
  differScore: number;
  bestDigit: number;
  confidence: number;
  reasons: string[];
};

export type AnalysisWeights = {
  frequencyWeight: number;
  trendWeight: number;
  entropyWeight: number;
  recentWeight: number;
  patternWeight: number;
  streakWeight: number;
  // Self-learning: updated based on prediction accuracy
  learnedAdjustments: Record<string, number>;
  predictionHistory: PredictionRecord[];
  totalPredictions: number;
  correctPredictions: number;
};

export type PredictionRecord = {
  timestamp: number;
  symbol: string;
  digit: number;
  direction: "over" | "under";
  score: number;
  actualResult: "correct" | "incorrect" | "pending";
  actualDigit?: number;
};

export type Tick = {
  quote: number;
  epoch: number;
};

export type WsStatus = {
  status: "connecting" | "connected" | "reconnecting" | "failed" | "closed";
  reconnectAttempt?: number;
  tickCount?: number;
  lastTickAt?: number;
};

import { DigitPredictor, getDigitPredictor, type ModelStatus, type TrainingMetrics, type OnlineLearningMetrics, type BacktestResult, type BacktestProgress } from "./digit-model";
export { type ModelStatus, type TrainingMetrics, type OnlineLearningMetrics, type BacktestResult, type BacktestProgress };
export { DigitPredictor, getDigitPredictor } from "./digit-model";

/* ------------------------------------------------------------------ */
/*  Self-Learning Engine                                                */
/* ------------------------------------------------------------------ */

const HISTORY_KEY = "dtrader_analyzer_weights";
const MAX_HISTORY = 2000;

function loadWeights(): AnalysisWeights {
  if (typeof window === "undefined") return defaultWeights();
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return defaultWeights();
}

function saveWeights(w: AnalysisWeights): void {
  if (typeof window === "undefined") return;
  try {
    // Trim history if too large
    if (w.predictionHistory.length > MAX_HISTORY) {
      w.predictionHistory = w.predictionHistory.slice(-MAX_HISTORY);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(w));
  } catch { /* ignore */ }
}

function defaultWeights(): AnalysisWeights {
  return {
    frequencyWeight: 0.35,
    trendWeight: 0.20,
    entropyWeight: 0.15,
    recentWeight: 0.20,
    patternWeight: 0.05,
    streakWeight: 0.05,
    learnedAdjustments: {},
    predictionHistory: [],
    totalPredictions: 0,
    correctPredictions: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Core Analysis Engine                                                */
/* ------------------------------------------------------------------ */

export class MarketAnalyzer {
  private tickBuffers: Map<string, Tick[]> = new Map();
  private statsCache: Map<string, DigitStats[]> = new Map();
  private statsCacheEpochs: Map<string, number> = new Map();
  private weights: AnalysisWeights;
  private wsConnections: Map<string, WebSocket> = new Map();
  private wsReconnectAttempts: Map<string, number> = new Map();
  private static readonly WS_MAX_RECONNECT = 10;
  private static readonly WS_BASE_DELAY = 1000;
  private static readonly WS_MAX_DELAY = 30000;
  private updateCallbacks: Set<() => void> = new Set();
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private predictor: DigitPredictor;
  // One model must learn one market at a time. Mixing digit sequences from
  // unrelated symbols manufactures transitions that never happened.
  private learningSymbol: string | null = null;
  private wsStatusMap: Map<string, WsStatus> = new Map();
  private wsStatusCallbacks: Set<(statuses: Map<string, WsStatus>) => void> = new Set();

  constructor() {
    this.weights = loadWeights();
    this.predictor = getDigitPredictor();
    // Lazy-init: defer TF.js model loading so it doesn't freeze the UI.
    setTimeout(async () => {
      await this.predictor.init();
      // The terminal can feed the selected symbol without opening the
      // analyzer's multi-market sockets, so learning must not depend on them.
      this.predictor.startOnlineLearning();
    }, 500);
  }

  /* ---- Tick ingestion ---- */

  addTick(symbol: string, tick: Tick): void {
    let buffer = this.tickBuffers.get(symbol);
    if (!buffer) {
      buffer = [];
      this.tickBuffers.set(symbol, buffer);
    }
    buffer.push(tick);
    // Keep last 5000 ticks per market
    if (buffer.length > 5000) {
      buffer.splice(0, buffer.length - 5000);
    }
    // Feed only the selected market to the shared neural model. Other markets
    // are still retained for statistical comparison and ranking.
    if (this.learningSymbol !== symbol) return;
    const digit = this.extractLastDigit(tick.quote);
    if (this.predictor.getStatus() === "ready") {
      this.predictor.addDigitAndLearn(digit);
    } else {
      // Buffer digits even before model is ready so we have data when it initializes
      this.predictor.addDigit(digit);
    }
  }

  getTicks(symbol: string): Tick[] {
    return this.tickBuffers.get(symbol) ?? [];
  }

  async setLearningSymbol(symbol: string): Promise<void> {
    if (this.learningSymbol === symbol) return;
    this.learningSymbol = symbol;
    // A model trained on another symbol must not keep its sequence context.
    // Resetting makes the new training/evaluation stream unambiguous.
    await this.predictor.reset();
    this.predictor.startOnlineLearning();
  }

  getLearningSymbol(): string | null { return this.learningSymbol; }

  /* ---- Real-time WebSocket connections ---- */

  startStreaming(symbols: string[]): void {
    for (const symbol of symbols) {
      if (this.wsConnections.has(symbol)) continue;
      this.connectSymbol(symbol);
    }
    // Start online learning (only if model is ready)
    if (this.predictor.getStatus() === "ready") {
      this.predictor.startOnlineLearning();
    }
    // Retry after delay in case model is still loading
    const retryInterval = setInterval(() => {
      if (this.predictor.getStatus() === "ready") {
        this.predictor.startOnlineLearning();
        clearInterval(retryInterval);
      }
    }, 1000);
    // Stop retrying after 30 seconds
    setTimeout(() => clearInterval(retryInterval), 30000);
  }

  stopStreaming(): void {
    // Cancel all pending reconnect timers
    for (const [, timer] of this.wsReconnectTimers) {
      clearTimeout(timer);
    }
    this.wsReconnectTimers.clear();
    this.wsReconnectAttempts.clear();
    for (const [, ws] of this.wsConnections) {
      ws.close();
    }
    this.wsConnections.clear();
    // Mark all tracked statuses as closed
    for (const [sym] of this.wsStatusMap) {
      this.wsStatusMap.set(sym, { status: "closed" });
    }
    this.emitWsStatus();
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    this.predictor.stopOnlineLearning();
  }

  private wsReconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private static jitteredDelay(attempt: number): number {
    const base = Math.min(
      MarketAnalyzer.WS_BASE_DELAY * Math.pow(2, attempt),
      MarketAnalyzer.WS_MAX_DELAY,
    );
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  private connectSymbol(symbol: string): void {
    // Clean up any pending reconnect timer for this symbol
    const existingTimer = this.wsReconnectTimers.get(symbol);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.wsReconnectTimers.delete(symbol);
    }

    const attempt = this.wsReconnectAttempts.get(symbol) ?? 0;
    this.setWsStatus(symbol, { status: attempt > 0 ? "reconnecting" : "connecting", reconnectAttempt: attempt });

    const ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");

    ws.onopen = () => {
      // Reset reconnect attempts on successful connection
      this.wsReconnectAttempts.delete(symbol);
      this.setWsStatus(symbol, { status: "connected", tickCount: this.wsStatusMap.get(symbol)?.tickCount ?? 0, lastTickAt: this.wsStatusMap.get(symbol)?.lastTickAt });
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.tick) {
          const prev = this.wsStatusMap.get(symbol);
          this.addTick(symbol, {
            quote: Number(msg.tick.quote),
            epoch: msg.tick.epoch,
          });
          this.setWsStatus(symbol, { status: "connected", tickCount: (prev?.tickCount ?? 0) + 1, lastTickAt: Date.now() });
          this.notifyUpdate();
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — reconnection handled there
    };

    ws.onclose = () => {
      this.wsConnections.delete(symbol);
      const closeAttempt = this.wsReconnectAttempts.get(symbol) ?? 0;
      if (closeAttempt < MarketAnalyzer.WS_MAX_RECONNECT) {
        this.wsReconnectAttempts.set(symbol, closeAttempt + 1);
        const delay = MarketAnalyzer.jitteredDelay(closeAttempt);
        this.setWsStatus(symbol, { status: "reconnecting", reconnectAttempt: closeAttempt + 1, tickCount: this.wsStatusMap.get(symbol)?.tickCount ?? 0 });
        const timer = setTimeout(() => {
          this.wsReconnectTimers.delete(symbol);
          this.connectSymbol(symbol);
        }, delay);
        this.wsReconnectTimers.set(symbol, timer);
      } else {
        this.setWsStatus(symbol, { status: "failed", reconnectAttempt: closeAttempt, tickCount: this.wsStatusMap.get(symbol)?.tickCount ?? 0 });
      }
    };

    this.wsConnections.set(symbol, ws);
  }

  private notifyUpdate(): void {
    for (const cb of this.updateCallbacks) cb();
  }

  private setWsStatus(symbol: string, status: WsStatus): void {
    this.wsStatusMap.set(symbol, status);
    this.emitWsStatus();
  }

  private emitWsStatus(): void {
    const snapshot = new Map(this.wsStatusMap);
    for (const cb of this.wsStatusCallbacks) cb(snapshot);
  }

  getWsStatuses(): Map<string, WsStatus> {
    return new Map(this.wsStatusMap);
  }

  onWsStatusChange(cb: (statuses: Map<string, WsStatus>) => void): () => void {
    this.wsStatusCallbacks.add(cb);
    return () => this.wsStatusCallbacks.delete(cb);
  }

  onUpdate(cb: () => void): () => void {
    this.updateCallbacks.add(cb);
    return () => this.updateCallbacks.delete(cb);
  }

  /* ---- Digit frequency analysis ---- */

  analyzeDigits(symbol: string): DigitStats[] {
    const ticks = this.tickBuffers.get(symbol) ?? [];
    if (ticks.length < 10) return [];

    // Check cache freshness
    const cached = this.statsCache.get(symbol);
    const cachedEpoch = this.statsCacheEpochs.get(symbol);
    if (cached && cached.length > 0 && cachedEpoch !== undefined) {
      const lastTick = ticks[ticks.length - 1];
      if (cachedEpoch === lastTick.epoch) {
        return cached;
      }
    }

    const stats: DigitStats[] = [];

    for (let d = 0; d <= 9; d++) {
      // Full history
      let count = 0;
      for (const t of ticks) {
        const digit = this.extractLastDigit(t.quote);
        if (digit === d) count++;
      }
      const frequency = (count / ticks.length) * 100;

      // Recent window (last 100 ticks)
      const recentTicks = ticks.slice(-100);
      let recentCount = 0;
      for (const t of recentTicks) {
        const digit = this.extractLastDigit(t.quote);
        if (digit === d) recentCount++;
      }
      const recentFrequency = (recentCount / recentTicks.length) * 100;

      // Trend: compare last 50 vs previous 50
      const last50 = ticks.slice(-50);
      const prev50 = ticks.slice(-100, -50);
      let lastCount = 0, prevCount = 0;
      for (const t of last50) {
        if (this.extractLastDigit(t.quote) === d) lastCount++;
      }
      for (const t of prev50) {
        if (this.extractLastDigit(t.quote) === d) prevCount++;
      }
      const lastRate = last50.length > 0 ? lastCount / last50.length : 0.1;
      const prevRate = prev50.length > 0 ? prevCount / prev50.length : 0.1;
      const trend = lastRate > prevRate + 0.02 ? 1 : lastRate < prevRate - 0.02 ? -1 : 0;

      // Bias: negative = underrepresented, positive = overrepresented
      const expectedFreq = 10; // Each digit should appear ~10% of the time
      const bias = (frequency - expectedFreq) / expectedFreq;

      stats.push({
        digit: d,
        count,
        frequency: Math.round(frequency * 100) / 100,
        recentFrequency: Math.round(recentFrequency * 100) / 100,
        trend,
        bias: Math.round(bias * 100) / 100,
      });
    }

    // Cache with epoch marker
    this.statsCacheEpochs.set(symbol, ticks[ticks.length - 1].epoch);
    this.statsCache.set(symbol, stats);

    return stats;
  }

  /* ---- Entropy (randomness measure) ---- */

  calculateEntropy(symbol: string): number {
    const stats = this.analyzeDigits(symbol);
    if (stats.length === 0) return 1;

    const total = stats.reduce((s, d) => s + d.count, 0);
    if (total === 0) return 1;

    let entropy = 0;
    for (const s of stats) {
      if (s.count > 0) {
        const p = s.count / total;
        entropy -= p * Math.log2(p);
      }
    }

    // Normalize: max entropy for 10 digits = log2(10) ≈ 3.32
    return entropy / Math.log2(10);
  }

  /* ---- Pattern detection ---- */

  detectPatterns(symbol: string): {
    streaks: { digit: number; length: number; direction: "up" | "down" | "same" }[];
    gaps: { digit: number; currentGap: number; expectedGap: number }[];
    alternating: number;
  } {
    const ticks = this.tickBuffers.get(symbol) ?? [];
    const recent = ticks.slice(-200);
    if (recent.length < 10) return { streaks: [], gaps: [], alternating: 0 };

    // Detect streaks (consecutive same last digit)
    const streaks: { digit: number; length: number; direction: "up" | "down" | "same" }[] = [];
    let streakDigit = this.extractLastDigit(recent[0].quote);
    let streakLen = 1;

    for (let i = 1; i < recent.length; i++) {
      const d = this.extractLastDigit(recent[i].quote);
      if (d === streakDigit) {
        streakLen++;
      } else {
        if (streakLen >= 3) {
          streaks.push({ digit: streakDigit, length: streakLen, direction: "same" });
        }
        streakDigit = d;
        streakLen = 1;
      }
    }

    // Detect gaps (how long since each digit last appeared)
    const gaps: { digit: number; currentGap: number; expectedGap: number }[] = [];
    for (let d = 0; d <= 9; d++) {
      let gap = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (this.extractLastDigit(recent[i].quote) === d) break;
        gap++;
      }
      const stats = this.analyzeDigits(symbol);
      const freq = stats[d]?.frequency ?? 10;
      const expectedGap = freq > 0 ? 100 / freq : 10;
      gaps.push({ digit: d, currentGap: gap, expectedGap });
    }

    // Alternating pattern detection
    let alternating = 0;
    for (let i = 1; i < Math.min(recent.length, 50); i++) {
      const prev = this.extractLastDigit(recent[i - 1].quote);
      const curr = this.extractLastDigit(recent[i].quote);
      if ((prev < 5 && curr >= 5) || (prev >= 5 && curr < 5)) {
        alternating++;
      }
    }
    alternating = alternating / Math.min(recent.length - 1, 49);

    return { streaks, gaps, alternating };
  }

  /* ---- Self-learning: record and adjust ---- */

  recordPrediction(
    symbol: string,
    digit: number,
    direction: "over" | "under",
    score: number,
  ): void {
    this.weights.predictionHistory.push({
      timestamp: Date.now(),
      symbol,
      digit,
      direction,
      score,
      actualResult: "pending",
    });
    this.weights.totalPredictions++;
    saveWeights(this.weights);
  }

  recordResult(
    symbol: string,
    digit: number,
    direction: "over" | "under",
    actualDigit: number,
  ): boolean {
    let correct = false;
    if (direction === "over") {
      correct = actualDigit > digit;
    } else {
      correct = actualDigit < digit;
    }

    // Find matching pending prediction
    for (let i = this.weights.predictionHistory.length - 1; i >= 0; i--) {
      const pred = this.weights.predictionHistory[i];
      if (
        pred.symbol === symbol &&
        pred.digit === digit &&
        pred.direction === direction &&
        pred.actualResult === "pending"
      ) {
        pred.actualResult = correct ? "correct" : "incorrect";
        pred.actualDigit = actualDigit;
        break;
      }
    }

    if (correct) this.weights.correctPredictions++;

    // Self-adjust weights based on recent accuracy
    this.adjustWeights();

    saveWeights(this.weights);
    return correct;
  }

  private adjustWeights(): void {
    const recent = this.weights.predictionHistory.slice(-100);
    const recentCorrect = recent.filter((p) => p.actualResult === "correct").length;
    const recentAccuracy = recent.length > 0 ? recentCorrect / recent.length : 0.5;

    // If accuracy is below 50%, shift weights toward frequency-based analysis
    if (recentAccuracy < 0.45) {
      this.weights.frequencyWeight = Math.min(0.5, this.weights.frequencyWeight + 0.02);
      this.weights.trendWeight = Math.max(0.1, this.weights.trendWeight - 0.01);
      this.weights.entropyWeight = Math.min(0.25, this.weights.entropyWeight + 0.01);
    }
    // If accuracy is above 55%, trust recent trends more
    else if (recentAccuracy > 0.55) {
      this.weights.recentWeight = Math.min(0.3, this.weights.recentWeight + 0.01);
      this.weights.patternWeight = Math.min(0.15, this.weights.patternWeight + 0.005);
    }

    // Per-symbol adjustments
    const symbolAccuracy: Record<string, { correct: number; total: number }> = {};
    for (const pred of recent) {
      if (pred.actualResult === "pending") continue;
      if (!symbolAccuracy[pred.symbol]) symbolAccuracy[pred.symbol] = { correct: 0, total: 0 };
      symbolAccuracy[pred.symbol].total++;
      if (pred.actualResult === "correct") symbolAccuracy[pred.symbol].correct++;
    }

    for (const [sym, acc] of Object.entries(symbolAccuracy)) {
      const rate = acc.total > 5 ? acc.correct / acc.total : 0.5;
      this.weights.learnedAdjustments[sym] = (rate - 0.5) * 0.5;
    }
  }

  getAccuracy(): { total: number; correct: number; rate: number } {
    return {
      total: this.weights.totalPredictions,
      correct: this.weights.correctPredictions,
      rate: this.weights.totalPredictions > 0
        ? (this.weights.correctPredictions / this.weights.totalPredictions) * 100
        : 0,
    };
  }

  getRecentAccuracy(window: number = 100): { total: number; correct: number; rate: number } {
    const recent = this.weights.predictionHistory.slice(-window).filter((p) => p.actualResult !== "pending");
    const correct = recent.filter((p) => p.actualResult === "correct").length;
    return {
      total: recent.length,
      correct,
      rate: recent.length > 0 ? (correct / recent.length) * 100 : 0,
    };
  }

  /* ---- Market scoring ---- */

  scoreMarket(symbol: string, name: string, category: string): MarketScore {
    const stats = this.analyzeDigits(symbol);
    const entropy = this.calculateEntropy(symbol);
    const patterns = this.detectPatterns(symbol);
    const ticks = this.tickBuffers.get(symbol) ?? [];

    const digitScores: DigitTradeScore[] = [];

    for (let d = 0; d <= 9; d++) {
      const underScore = this.scoreDigitTrade(symbol, d, "under", stats, entropy, patterns);
      const overScore = this.scoreDigitTrade(symbol, d, "over", stats, entropy, patterns);
      digitScores.push(underScore, overScore);
    }

    // Neural network prediction
    const neuralPred = this.predictor.predict();
    const neuralPrediction: NeuralPrediction | null = neuralPred ? {
      probabilities: neuralPred.probabilities,
      topDigit: neuralPred.topDigit,
      confidence: Math.round(neuralPred.confidence * 100),
      biasStrength: Math.round(neuralPred.biasStrength * 100) / 100,
      entropy: Math.round(neuralPred.entropy * 1000) / 1000,
      modelStatus: this.predictor.getStatus(),
      modelAccuracy: Math.round(this.predictor.getMetrics().accuracy * 100),
    } : null;

    // === HYBRID SCORING: Blend neural probabilities into each digit score ===
    // The neural model provides per-digit probabilities that can boost or
    // penalize statistical scores. The blend weight is proportional to
    // the neural model's recent accuracy (0-1) and confidence.

    const neuralMetrics = this.predictor.getMetrics();
    const onlineMetrics = this.predictor.getOnlineMetrics();
    // Blend weight: how much to trust the neural model (0 = pure statistical, 1 = full neural)
    const neuralAccuracy = onlineMetrics.rollingAccuracy; // 0-1
    const neuralConfidence01 = (neuralPred?.confidence ?? 0); // 0-1
    // Only blend when model has seen enough data and has some accuracy
    const hasEnoughData = (ticks.length >= 200) && (onlineMetrics.totalPredictions >= 10);
    // Blend weight ramps up with accuracy: at 10% accuracy (random), weight=0;
    // at 20% accuracy, weight=0.2; at 50% accuracy, weight=0.6
    const blendWeight = hasEnoughData
      ? Math.min(0.4, Math.max(0, (neuralAccuracy - 0.08) * 0.8))
      : 0;

    for (const ds of digitScores) {
      const rawScore = ds.score;
      let neuralBoost = 0;
      let neuralAgreement = false;

      if (neuralPrediction && blendWeight > 0) {
        const prob = neuralPrediction.probabilities[ds.digit] ?? 0.1;
        // How much the neural model favors this digit (above uniform 10%)
        const digitLift = (prob - 0.1) * 100; // -10 to +90 scale
        // For "under" trades, we want the digit to be ABOVE the prediction threshold
        // For "over" trades, similar logic
        // The neural model predicts which digit will appear next
        // So if it predicts digit=5, then UNDER 5 scores should get penalized
        // (digit 5 is likely, so betting under 5 is risky)
        // and OVER 4 scores should get boosted (5 > 4 is likely)
        if (ds.direction === "under") {
          // Under N wins if next digit < N
          // If neural says digit is high, UNDER scores should be penalized
          // Sum of neural probs for digits > ds.digit
          let probAbove = 0;
          for (let d = ds.digit + 1; d <= 9; d++) {
            probAbove += neuralPrediction.probabilities[d] ?? 0;
          }
          // High prob above = bad for UNDER → penalize
          // Low prob above = good for UNDER → boost
          neuralBoost = -(probAbove - (1 - ds.digit / 10)) * 80;
          neuralAgreement = probAbove < (1 - ds.digit / 10);
        } else {
          // Over N wins if next digit > N
          // Sum of neural probs for digits < ds.digit
          let probBelow = 0;
          for (let d = 0; d < ds.digit; d++) {
            probBelow += neuralPrediction.probabilities[d] ?? 0;
          }
          // High prob below = bad for OVER → penalize
          // Low prob below = good for OVER → boost
          neuralBoost = -(probBelow - ds.digit / 10) * 80;
          neuralAgreement = probBelow < (ds.digit / 10);
        }

        // Also boost if the neural model's top digit aligns with this trade
        if (neuralPrediction.topDigit === ds.digit) {
          neuralBoost += 10 * blendWeight;
          neuralAgreement = true;
        }

        // Scale neural boost by blend weight and confidence
        neuralBoost = neuralBoost * blendWeight * neuralConfidence01;
        neuralBoost = Math.round(Math.max(-30, Math.min(30, neuralBoost)));
      }

      // Apply neural blend to score
      const blendedScore = Math.round(Math.min(100, Math.max(0, ds.score + neuralBoost)));
      ds.rawScore = ds.score;
      ds.score = blendedScore;
      ds.neuralContribution = neuralBoost;
      ds.neuralAgreement = neuralAgreement;

      // If neural strongly disagrees, reduce confidence
      if (neuralPrediction && blendWeight > 0.1 && !neuralAgreement && Math.abs(neuralBoost) > 10) {
        ds.confidence = Math.max(10, ds.confidence - Math.round(Math.abs(neuralBoost) * 0.3));
        ds.reasons.push(`Neural model disagrees (Δ=${neuralBoost > 0 ? "+" : ""}${neuralBoost}) ⚠`);
      } else if (neuralPrediction && neuralAgreement && neuralBoost > 5) {
        ds.reasons.push(`Neural model agrees (Δ=+${Math.round(neuralBoost)}) ✓`);
      }
    }

    // Find best trade AFTER neural blending
    const bestTrade = digitScores.reduce(
      (best, curr) => (curr.score > (best?.score ?? -1) ? curr : best),
      null as DigitTradeScore | null,
    );

    // Even/Odd analysis
    const evenOddScore = this.scoreEvenOdd(symbol, stats);

    // Matches/Differs analysis
    const matchesDiffersScore = this.scoreMatchesDiffers(symbol, stats);

    // Overall market score — blend statistical + neural + learned
    const bestScore = bestTrade?.score ?? 0;
    const learned = this.weights.learnedAdjustments[symbol] ?? 0;
    let overallScore = Math.round(
      Math.min(100, Math.max(0, bestScore + learned * 100)),
    );

    return {
      symbol,
      name,
      category,
      overallScore,
      digitScores,
      bestTrade,
      evenOddScore,
      matchesDiffersScore,
      tickCount: ticks.length,
      entropy,
      neuralPrediction,
      lastUpdated: Date.now(),
    };
  }

  private scoreDigitTrade(
    symbol: string,
    digit: number,
    direction: "over" | "under",
    stats: DigitStats[],
    entropy: number,
    patterns: ReturnType<typeof this.detectPatterns>,
  ): DigitTradeScore {
    const reasons: string[] = [];
    let score = 0;
    let confidence = 0;

    const statsForDigit = stats[digit] ?? {
      digit,
      count: 0,
      frequency: 10,
      recentFrequency: 10,
      trend: 0,
      bias: 0,
    };

    // === CORE CONSTRAINT CHECKS ===

    // 1. For Under N: digits > N should be under 10% frequency
    const higherDigits = stats.filter((s) => s.digit > digit);
    const avgHigherFreq = higherDigits.length > 0
      ? higherDigits.reduce((s, d) => s + d.frequency, 0) / higherDigits.length
      : 10;
    const underDigitsBelowThreshold = avgHigherFreq < 10;

    // 2. For Over N: digits < N should be under 10% frequency
    const lowerDigits = stats.filter((s) => s.digit < digit);
    const avgLowerFreq = lowerDigits.length > 0
      ? lowerDigits.reduce((s, d) => s + d.frequency, 0) / lowerDigits.length
      : 10;
    const overDigitsBelowThreshold = avgLowerFreq < 10;

    // 3. Most frequent digit should be ≥3 away from the traded digit
    const sortedByFreq = [...stats].sort((a, b) => b.frequency - a.frequency);
    const mostFrequent = sortedByFreq[0];
    const mostFrequentFarEnough = mostFrequent
      ? Math.abs(mostFrequent.digit - digit) >= 3
      : false;

    // Distribution skew
    const distributionSkew = direction === "under"
      ? (10 - avgHigherFreq) / 10  // Positive = good for under
      : (10 - avgLowerFreq) / 10;  // Positive = good for over

    // === SCORING ===

    if (direction === "under") {
      // Under N wins if next digit < N
      // Want: higher digits suppressed, digit itself not too frequent
      // Want: digit ≥ 3 (so plenty of room below)

      // Constraint: digits > N should be < 10%
      if (underDigitsBelowThreshold) {
        score += 30;
        reasons.push(`Higher digits avg ${avgHigherFreq.toFixed(1)}% < 10% ✓`);
      } else {
        reasons.push(`Higher digits avg ${avgHigherFreq.toFixed(1)}% ≥ 10% ✗`);
      }

      // Most frequent digit far enough away
      if (mostFrequentFarEnough) {
        score += 20;
        reasons.push(`Most frequent is ${mostFrequent?.digit} (Δ=${Math.abs((mostFrequent?.digit ?? 0) - digit)}) ≥ 3 ✓`);
      } else {
        reasons.push(`Most frequent is ${mostFrequent?.digit} (Δ=${Math.abs((mostFrequent?.digit ?? 0) - digit)}) < 3 ✗`);
      }

      // Higher digits should be trending down
      const higherTrend = higherDigits.reduce((s, d) => s + d.trend, 0) / (higherDigits.length || 1);
      if (higherTrend < 0) {
        score += 15;
        reasons.push(`Higher digits trending down ✓`);
      }

      // The digit itself should not be overrepresented
      if (statsForDigit.bias < 0.2) {
        score += 10;
        reasons.push(`Digit ${digit} not overrepresented ✓`);
      }

      // Distribution skew favoring under
      if (distributionSkew > 0.1) {
        score += 15;
        reasons.push(`Distribution skewed toward lower digits ✓`);
      }

      // Entropy bonus: lower entropy = more predictable
      if (entropy < 0.85) {
        score += 10;
        reasons.push(`Low entropy (${entropy.toFixed(3)}) = more predictable ✓`);
      }

      // Pattern bonus
      if (patterns.alternating < 0.3) {
        score += 5;
        reasons.push(`Low alternating pattern ✓`);
      }

    } else {
      // Over N wins if next digit > N
      // Want: lower digits suppressed, digit itself not too frequent
      // Want: digit ≤ 6 (so plenty of room above)

      if (overDigitsBelowThreshold) {
        score += 30;
        reasons.push(`Lower digits avg ${avgLowerFreq.toFixed(1)}% < 10% ✓`);
      } else {
        reasons.push(`Lower digits avg ${avgLowerFreq.toFixed(1)}% ≥ 10% ✗`);
      }

      if (mostFrequentFarEnough) {
        score += 20;
        reasons.push(`Most frequent is ${mostFrequent?.digit} (Δ=${Math.abs((mostFrequent?.digit ?? 0) - digit)}) ≥ 3 ✓`);
      } else {
        reasons.push(`Most frequent is ${mostFrequent?.digit} (Δ=${Math.abs((mostFrequent?.digit ?? 0) - digit)}) < 3 ✗`);
      }

      const lowerTrend = lowerDigits.reduce((s, d) => s + d.trend, 0) / (lowerDigits.length || 1);
      if (lowerTrend < 0) {
        score += 15;
        reasons.push(`Lower digits trending down ✓`);
      }

      if (statsForDigit.bias < 0.2) {
        score += 10;
        reasons.push(`Digit ${digit} not overrepresented ✓`);
      }

      if (distributionSkew > 0.1) {
        score += 15;
        reasons.push(`Distribution skewed toward higher digits ✓`);
      }

      if (entropy < 0.85) {
        score += 10;
        reasons.push(`Low entropy (${entropy.toFixed(3)}) = more predictable ✓`);
      }

      if (patterns.alternating < 0.3) {
        score += 5;
        reasons.push(`Low alternating pattern ✓`);
      }
    }

    // === CONFIDENCE ===
    const ticks = this.tickBuffers.get(symbol) ?? [];
    if (ticks.length < 100) {
      confidence = 20;
      reasons.push("Low data volume — confidence reduced");
    } else if (ticks.length < 500) {
      confidence = 50;
      reasons.push("Moderate data volume");
    } else {
      confidence = 80;
      if (entropy < 0.8) confidence = 90;
    }

    // Self-learning adjustment
    const learned = this.weights.learnedAdjustments[symbol] ?? 0;
    score = Math.round(Math.min(100, Math.max(0, score + learned * 50)));

    // Expected edge (rough estimate)
    const expectedEdge = direction === "under"
      ? (10 - digit) / 10 - (digit / 10)
      : digit / 10 - (10 - digit) / 10;

    return {
      digit,
      direction,
      score,
      rawScore: score,  // Will be overwritten by hybrid blending in scoreMarket
      confidence,
      expectedEdge: Math.round(expectedEdge * 1000) / 1000,
      reasons,
      underDigitsBelowThreshold,
      overDigitsBelowThreshold,
      mostFrequentFarEnough,
      distributionSkew,
      neuralContribution: 0,   // Will be set by hybrid blending
      neuralAgreement: false,  // Will be set by hybrid blending
    };
  }

  /* ---- Even/Odd Analysis ---- */

  private scoreEvenOdd(symbol: string, stats: DigitStats[]): EvenOddScore {
    const ticks = this.tickBuffers.get(symbol) ?? [];
    if (ticks.length < 20) {
      return {
        evenScore: 50, oddScore: 50, evenFrequency: 50, oddFrequency: 50,
        evenTrend: 0, oddTrend: 0, bestDirection: null, confidence: 10,
        reasons: ["Insufficient data"],
      };
    }

    // Calculate even/odd frequencies
    let evenCount = 0;
    const recent100 = ticks.slice(-100);
    for (const t of recent100) {
      const d = this.extractLastDigit(t.quote);
      if (d % 2 === 0) evenCount++;
    }
    const evenFreq = (evenCount / recent100.length) * 100;
    const oddFreq = 100 - evenFreq;

    // Trends
    const last50 = ticks.slice(-50);
    const prev50 = ticks.slice(-100, -50);
    let lastEven = 0, prevEven = 0;
    for (const t of last50) { if (this.extractLastDigit(t.quote) % 2 === 0) lastEven++; }
    for (const t of prev50) { if (this.extractLastDigit(t.quote) % 2 === 0) prevEven++; }
    const evenTrend = (last50.length > 0 ? lastEven / last50.length : 0.5) -
      (prev50.length > 0 ? prevEven / prev50.length : 0.5);

    // Score: deviation from 50/50
    const evenDeviation = Math.abs(evenFreq - 50);
    const reasons: string[] = [];
    let evenScore = 50;
    let oddScore = 50;

    if (evenFreq > 52) {
      evenScore = 50 + evenDeviation * 2;
      oddScore = 50 - evenDeviation;
      reasons.push(`Even at ${evenFreq.toFixed(1)}% — bias toward even ✓`);
    } else if (oddFreq > 52) {
      oddScore = 50 + (oddFreq - 50) * 2;
      evenScore = 50 - (oddFreq - 50);
      reasons.push(`Odd at ${oddFreq.toFixed(1)}% — bias toward odd ✓`);
    } else {
      reasons.push("No significant even/odd bias detected");
    }

    // Entropy bonus
    const entropy = this.calculateEntropy(symbol);
    if (entropy < 0.85) {
      evenScore += 10;
      oddScore += 10;
      reasons.push("Low market entropy favors pattern trades");
    }

    const bestDirection = evenScore > oddScore ? "even" : oddScore > evenScore ? "odd" : null;
    const confidence = ticks.length < 200 ? 30 : entropy < 0.85 ? 80 : 60;

    return {
      evenScore: Math.round(Math.min(100, evenScore)),
      oddScore: Math.round(Math.min(100, oddScore)),
      evenFrequency: Math.round(evenFreq * 10) / 10,
      oddFrequency: Math.round(oddFreq * 10) / 10,
      evenTrend: Math.round(evenTrend * 1000) / 1000,
      oddTrend: Math.round(-evenTrend * 1000) / 1000,
      bestDirection,
      confidence,
      reasons,
    };
  }

  /* ---- Matches/Differs Analysis ---- */

  private scoreMatchesDiffers(symbol: string, stats: DigitStats[]): MatchesDiffersScore {
    const ticks = this.tickBuffers.get(symbol) ?? [];
    if (ticks.length < 20) {
      return { matchScore: 50, differScore: 50, bestDigit: 0, confidence: 10, reasons: ["Insufficient data"] };
    }

    const reasons: string[] = [];

    // For Differs: find the digit that appears LEAST (best candidate to bet against)
    const sortedByFreq = [...stats].sort((a, b) => a.frequency - b.frequency);
    const leastFrequent = sortedByFreq[0];

    // For Match: find the digit that appears MOST with a bias
    const mostFrequent = [...stats].sort((a, b) => b.frequency - a.frequency)[0];

    let differScore = 50;
    let matchScore = 50;

    if (leastFrequent && leastFrequent.frequency < 7) {
      differScore = 50 + (10 - leastFrequent.frequency) * 5;
      reasons.push(`Digit ${leastFrequent.digit} appears only ${leastFrequent.frequency.toFixed(1)}% — good differs target ✓`);
    } else if (leastFrequent) {
      reasons.push(`Least frequent digit (${leastFrequent.digit}) still at ${leastFrequent.frequency.toFixed(1)}%`);
    }

    if (mostFrequent && mostFrequent.frequency > 13) {
      matchScore = 50 + (mostFrequent.frequency - 10) * 4;
      reasons.push(`Digit ${mostFrequent.digit} appears ${mostFrequent.frequency.toFixed(1)}% — good match target ✓`);
    } else if (mostFrequent) {
      reasons.push(`Most frequent digit (${mostFrequent.digit}) only at ${mostFrequent.frequency.toFixed(1)}%`);
    }

    const entropy = this.calculateEntropy(symbol);
    if (entropy < 0.8) {
      differScore += 10;
      reasons.push("Low entropy favors differs trades");
    }

    const bestDigit = differScore > matchScore
      ? (leastFrequent?.digit ?? 0)
      : (mostFrequent?.digit ?? 0);

    const confidence = ticks.length < 200 ? 30 : entropy < 0.85 ? 75 : 55;

    return {
      matchScore: Math.round(Math.min(100, matchScore)),
      differScore: Math.round(Math.min(100, differScore)),
      bestDigit,
      confidence,
      reasons,
    };
  }

  /* ---- Best market recommendation ---- */

  rankMarkets(): MarketScore[] {
    const scores: MarketScore[] = [];

    for (const market of ALL_MARKETS) {
      const ticks = this.tickBuffers.get(market.symbol);
      if (!ticks || ticks.length < 20) continue;

      scores.push(this.scoreMarket(market.symbol, market.name, market.category));
    }

    return scores.sort((a, b) => b.overallScore - a.overallScore);
  }

  getBestMarket(): MarketScore | null {
    const ranked = this.rankMarkets();
    return ranked[0] ?? null;
  }

  /* ---- Helpers ---- */

  private extractLastDigit(quote: number): number {
    return Math.floor(Math.abs(quote) * 100) % 10;
  }

  /* ---- Neural model access ---- */

  getPredictor(): DigitPredictor {
    return this.predictor;
  }

  /* ---- Cleanup ---- */

  destroy(): void {
    this.stopStreaming();
    this.tickBuffers.clear();
    this.statsCache.clear();
    this.predictor.dispose();
  }
}

/* ------------------------------------------------------------------ */
/*  Global singleton — allows the terminal to feed ticks directly      */
/* ------------------------------------------------------------------ */

let globalAnalyzer: MarketAnalyzer | null = null;

export function getGlobalAnalyzer(): MarketAnalyzer {
  if (!globalAnalyzer) {
    globalAnalyzer = new MarketAnalyzer();
  }
  return globalAnalyzer;
}
