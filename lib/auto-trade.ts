
/**
 * Auto-Trade Engine
 * Connects AI Market Analyzer predictions to real Deriv trade execution.
 * Safety: min confidence, max stake, daily loss limit, cooldown, max open contracts.
 */
import { getGlobalAnalyzer, type MarketScore, type DigitTradeScore } from "./market-analyzer";

export type AutoTradeConfig = {
  enabled: boolean;
  contractType: "DIGITOVER" | "DIGITUNDER" | "DIGITODD" | "DIGITEVEN" | "DIGITMATCH" | "DIGITDIFF";
  symbol: string; stake: number; duration: number; minScore: number; minConfidence: number;
  maxStakePerTrade: number; dailyLossLimit: number; cooldownMs: number; maxOpenContracts: number;
  maxConsecutiveLosses: number; minTrainingSamples: number; minValidatedAccuracy: number; demoOnly: boolean;
};

export type AutoTradeState = {
  isRunning: boolean; lastTradeTime: number; tradesToday: number; pnlToday: number;
  consecutiveLosses: number; lastPrediction: string; lastTradeResult: "won" | "lost" | null;
  openContracts: number;
};

export type TradeAdapter = {
  propose: (req: { contract_type: string; symbol: string; amount: number; duration: number;
    duration_unit: string; basis: string; currency: string; }) =>
    Promise<{ id: string; ask_price: number; payout: number } | null>;
  buy: (proposalId: string, price: number) => Promise<{ contract_id: string } | null>;
  subscribeToContract: (contractId: string, cb: (c: { status: string; profit?: number }) => void) => void;
  isDemo: () => boolean;
};

const DEFAULT: AutoTradeConfig = {
  enabled: false, contractType: "DIGITOVER", symbol: "1HZ100V", stake: 1, duration: 5,
  minScore: 65, minConfidence: 13, maxStakePerTrade: 10, dailyLossLimit: 50,
  cooldownMs: 15000, maxOpenContracts: 1,
  maxConsecutiveLosses: 3, minTrainingSamples: 500, minValidatedAccuracy: 0.13, demoOnly: true,
};

export class AutoTradeEngine {
  private config = { ...DEFAULT };
  private state: AutoTradeState = {
    isRunning: false, lastTradeTime: 0, tradesToday: 0, pnlToday: 0,
    consecutiveLosses: 0, lastPrediction: "", lastTradeResult: null, openContracts: 0,
  };
  private adapter: TradeAdapter | null = null;
  private analyzer = getGlobalAnalyzer();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cbs = new Set<(s: AutoTradeState) => void>();
  private log: Array<{ time: number; symbol: string; prediction: string; result: "won" | "lost"; pnl: number }> = [];
  private tradingDay = new Date().toDateString();

  setAdapter(a: TradeAdapter) { this.adapter = a; }
  getConfig() { return { ...this.config }; }
  getState() { return { ...this.state }; }
  getLog() { return [...this.log]; }
  onStateChange(cb: (s: AutoTradeState) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  private emit() { for (const cb of this.cbs) cb({ ...this.state }); }

  updateConfig(p: Partial<AutoTradeConfig>) {
    this.config = { ...this.config, ...p };
    if (p.enabled !== undefined) { if (p.enabled) this.start(); else this.stop(); }
  }

  start() {
    if (this.state.isRunning) return;
    if (!this.adapter) return;
    if (this.config.demoOnly && !this.adapter.isDemo()) {
      this.state.lastPrediction = "Blocked: ML automation is demo-only"; this.emit(); return;
    }
    this.state.isRunning = true; this.emit();
    this.timer = setInterval(() => this.tick(), 3000);
    console.log("[AutoTrade] Started");
  }

  stop() {
    this.state.isRunning = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.emit(); console.log("[AutoTrade] Stopped");
  }

  private async tick() {
    if (!this.state.isRunning || !this.adapter) return;
    const today = new Date().toDateString();
    if (today !== this.tradingDay) { this.tradingDay = today; this.reset(); }
    if (this.state.openContracts >= this.config.maxOpenContracts) return;
    if (this.config.stake > this.config.maxStakePerTrade) { this.state.lastPrediction = "Blocked: stake exceeds safety cap"; this.stop(); return; }
    if (this.state.pnlToday <= -this.config.dailyLossLimit) { this.stop(); return; }
    if (this.state.consecutiveLosses >= this.config.maxConsecutiveLosses) { this.state.lastPrediction = "Stopped: consecutive-loss limit reached"; this.stop(); return; }
    if (Date.now() - this.state.lastTradeTime < this.config.cooldownMs) return;

    const scores = this.analyzer.rankMarkets();
    const m = scores.find(s => s.symbol === this.config.symbol);
    if (!m?.bestTrade) return;
    const best = m.bestTrade;
    const om = this.analyzer.getPredictor().getOnlineMetrics();
    const predictor = this.analyzer.getPredictor();
    if (predictor.getBufferSize() < this.config.minTrainingSamples) return;
    if (om.rollingTotal < 100 || om.rollingAccuracy < this.config.minValidatedAccuracy) return;
    if (best.score < this.config.minScore) return;
    if (om.rollingAccuracy * 100 < this.config.minConfidence) return;

    const ct = this.config.contractType;
    try {
      const prop = await this.adapter!.propose({
        contract_type: ct, symbol: this.config.symbol, amount: this.config.stake,
        duration: this.config.duration, duration_unit: "t", basis: "stake", currency: "USD",
      });
      if (!prop || prop.ask_price > this.config.stake * 1.5) return;
      const c = await this.adapter!.buy(prop.id, prop.ask_price);
      if (!c?.contract_id) return;

      this.state.lastTradeTime = Date.now();
      this.state.openContracts++;
      this.state.lastPrediction = ct + " " + best.digit + " (" + best.score + ")";
      this.emit();

      this.adapter!.subscribeToContract(c.contract_id, u => {
        if (u.status === "won" || u.status === "lost") {
          this.state.openContracts = Math.max(0, this.state.openContracts - 1);
          const pnl = u.profit ?? (u.status === "won" ? this.config.stake * 8 : -this.config.stake);
          this.state.tradesToday++; this.state.pnlToday += pnl;
          this.state.lastTradeResult = u.status as "won" | "lost";
          if (u.status === "lost") this.state.consecutiveLosses++; else this.state.consecutiveLosses = 0;
          this.log.push({ time: Date.now(), symbol: this.config.symbol, prediction: this.state.lastPrediction, result: u.status as "won" | "lost", pnl });
          this.emit();
        }
      });
    } catch (e) { console.error("[AutoTrade]", e); }
  }

  reset() {
    this.state = { ...this.state, tradesToday: 0, pnlToday: 0, consecutiveLosses: 0, lastTradeResult: null, openContracts: 0 };
    this.log = []; this.emit();
  }
}

let inst: AutoTradeEngine | null = null;
export function getAutoTradeEngine(): AutoTradeEngine { if (!inst) inst = new AutoTradeEngine(); return inst; }
