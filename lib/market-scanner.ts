/**
 * Market Scanner — the user's manual-trading market finder.
 *
 * Watches every Volatility 1s index continuously and tells you which market
 * to trade, based on exactly two hard rules:
 *
 *   UNDER 8  → digit 8 AND digit 9 each appear in < 10% of the window
 *   OVER 1   → digit 0 AND digit 1 each appear in < 10% of the window
 *
 * All percentages are computed EXACTLY from real tick data — count divided by
 * window size, no estimation, no smoothing. A digit at exactly 10.0% does NOT
 * qualify (the rule is strictly "below 10%").
 *
 * The live engine mirrors the app's proven public-endpoint pattern
 * (lib/market-analyzer.ts): one WebSocket per symbol to the Options API v1
 * public endpoint, backfilled with ticks_history so the window is meaningful
 * immediately, then subscribed live. Each socket pings every 15s, a stale
 * watchdog closes half-dead connections after 45s of silence, stalled markets
 * (no tick for 6s) are re-subscribed, and every abnormal close reconnects with
 * jittered exponential backoff.
 */

import { digitFromQuote } from "./format-utils";
import { StaleWatchdog } from "./ws-lifecycle";

/* ------------------------------------------------------------------ */
/*  Markets                                                            */
/* ------------------------------------------------------------------ */

export type ScannerMarket = { symbol: string; name: string };

export const SCANNER_MARKETS: ScannerMarket[] = [
  { symbol: "1HZ10V", name: "Volatility 10 (1s)" },
  { symbol: "1HZ25V", name: "Volatility 25 (1s)" },
  { symbol: "1HZ50V", name: "Volatility 50 (1s)" },
  { symbol: "1HZ75V", name: "Volatility 75 (1s)" },
  { symbol: "1HZ100V", name: "Volatility 100 (1s)" },
];

export const SCANNER_MARKET_SYMBOLS = SCANNER_MARKETS.map((m) => m.symbol);

/** Danger digits must appear STRICTLY below this many percent. */
export const SCANNER_THRESHOLD_PCT = 10;
export const SCANNER_DANGER_THRESHOLDS = [10, 8, 5] as const;
export type ScannerDangerThreshold = (typeof SCANNER_DANGER_THRESHOLDS)[number];

export const SCANNER_LOOKBACK_OPTIONS = [50, 100, 200] as const;
export const SCANNER_DEFAULT_LOOKBACK = 100;
export const SCANNER_MAX_LOOKBACK = Math.max(...SCANNER_LOOKBACK_OPTIONS);

export type RuleKey = "under8" | "over1";
export type BetRecord = {
  win: boolean;
  at: number;
  symbol: string;
  rule: RuleKey;
  barrierDigit: number;
};
export type RuleTrack = { bets: number; wins: number; recent: BetRecord[] };
export type SignalTracks = Map<string, Map<RuleKey, RuleTrack>>;

const TRACK_RULES: RuleKey[] = ["under8", "over1"];
const TRACK_STORAGE_KEY = "freebuff_scanner_signals_v1";
const THRESHOLD_STORAGE_KEY = "freebuff_scanner_thresholds_v1";
const pendingByLedger = new WeakMap<SignalTracks, Map<string, Record<RuleKey, boolean>>>();

function emptyRuleTrack(): RuleTrack {
  return { bets: 0, wins: 0, recent: [] };
}

function getRuleTrack(ledger: SignalTracks, symbol: string, rule: RuleKey): RuleTrack {
  let market = ledger.get(symbol);
  if (!market) {
    market = new Map<RuleKey, RuleTrack>();
    ledger.set(symbol, market);
  }
  let track = market.get(rule);
  if (!track) {
    track = emptyRuleTrack();
    market.set(rule, track);
  }
  return track;
}

export function recordBet(
  ledger: SignalTracks,
  symbol: string,
  rule: RuleKey,
  win: boolean,
  at: number,
): void {
  const track = getRuleTrack(ledger, symbol, rule);
  track.bets += 1;
  if (win) track.wins += 1;
  track.recent.push({ win, at, symbol, rule, barrierDigit: rule === "under8" ? 8 : 1 });
  if (track.recent.length > 30) track.recent.splice(0, track.recent.length - 30);
}

/**
 * Advance one market by one settled tick. A qualifying tick is entered at
 * its own price and settled by the following tick, matching the trader.
 */
export function advanceSignalLedger(
  digit: number,
  qualifies: { under8: boolean; over1: boolean },
  ledger: SignalTracks,
  symbol: string,
  now: number,
): void {
  let symbolPending = pendingByLedger.get(ledger);
  if (!symbolPending) {
    symbolPending = new Map();
    pendingByLedger.set(ledger, symbolPending);
  }
  const pending = symbolPending.get(symbol);
  for (const rule of TRACK_RULES) {
    if (!pending?.[rule]) continue;
    recordBet(ledger, symbol, rule, rule === "under8" ? digit < 8 : digit > 1, now);
  }
  symbolPending.set(symbol, { under8: qualifies.under8, over1: qualifies.over1 });
}

/** Replay one digit stream through exactly the same settle/re-arm semantics. */
export function simulateRuleHits(digits: number[], lookback: number): Map<RuleKey, RuleTrack> {
  const ledger: SignalTracks = new Map();
  const history: number[] = [];
  for (const digit of digits) {
    history.push(digit);
    const cls = classifyDigits(history.slice(-lookback), lookback);
    advanceSignalLedger(digit, cls, ledger, "simulation", history.length);
  }
  return ledger.get("simulation") ?? new Map<RuleKey, RuleTrack>();
}

function loadSignalTracks(): SignalTracks {
  const ledger: SignalTracks = new Map();
  if (typeof window === "undefined") return ledger;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRACK_STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return ledger;
    for (const [symbol, rawMarket] of Object.entries(parsed as Record<string, unknown>)) {
      if (!rawMarket || typeof rawMarket !== "object") continue;
      const market = new Map<RuleKey, RuleTrack>();
      for (const rule of TRACK_RULES) {
        const raw = (rawMarket as Record<string, unknown>)[rule] as Partial<RuleTrack> | undefined;
        if (!raw) continue;
        const recent = Array.isArray(raw.recent) ? raw.recent.filter((r): r is BetRecord =>
          !!r && typeof r === "object" && typeof (r as BetRecord).win === "boolean" &&
          typeof (r as BetRecord).at === "number" && (r as BetRecord).rule === rule,
        ).slice(-30) : [];
        market.set(rule, {
          bets: Number.isFinite(raw.bets) ? Math.max(0, Number(raw.bets)) : recent.length,
          wins: Number.isFinite(raw.wins) ? Math.max(0, Number(raw.wins)) : recent.filter((r) => r.win).length,
          recent,
        });
      }
      if (market.size) ledger.set(symbol, market);
    }
  } catch { /* localStorage is optional and may contain corrupt data */ }
  return ledger;
}

function serializeSignalTracks(ledger: SignalTracks): Record<string, Record<RuleKey, RuleTrack>> {
  const out: Record<string, Record<RuleKey, RuleTrack>> = {};
  for (const [symbol, market] of ledger) {
    out[symbol] = {} as Record<RuleKey, RuleTrack>;
    for (const rule of TRACK_RULES) {
      const track = market.get(rule);
      if (track) out[symbol][rule] = { bets: track.bets, wins: track.wins, recent: track.recent.slice(-30) };
    }
  }
  return out;
}

function loadThresholds(): Map<string, ScannerDangerThreshold> {
  const thresholds = new Map<string, ScannerDangerThreshold>();
  if (typeof window === "undefined") return thresholds;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(THRESHOLD_STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return thresholds;
    for (const market of SCANNER_MARKETS) {
      const value = parsed[market.symbol];
      if (SCANNER_DANGER_THRESHOLDS.includes(value as ScannerDangerThreshold)) {
        thresholds.set(market.symbol, value as ScannerDangerThreshold);
      }
    }
  } catch { /* optional preference */ }
  return thresholds;
}

/** Persistent per-market signal ledger. It remains Map-compatible so the
 * incremental helper can be used directly with it in tests and backtests. */
export class SignalLedger extends Map<string, Map<RuleKey, RuleTrack>> {
  constructor() {
    super();
    const loaded = loadSignalTracks();
    for (const [symbol, market] of loaded) this.set(symbol, market);
  }
}

/* ------------------------------------------------------------------ */
/*  Exact digit-window statistics (pure, unit-testable)                */
/* ------------------------------------------------------------------ */

export type DigitStat = {
  digit: number;
  count: number; // exact count in the analyzed window
  freq: number;  // exact percentage = count / windowSize * 100
};

export type MarketSignal = {
  symbol: string;
  name: string;
  lookback: number;      // requested window size
  ticks: number;         // how many ticks were actually analyzed (min(lookback, received))
  lastQuote: number | null;
  lastDigit: number | null;
  pipSize: number;
  digits: DigitStat[];   // digits 0..9 with exact counts + frequencies
  // UNDER 8 rule: 8 and 9 each < 10%
  under8: boolean;
  under8Freq: { d8: number; d9: number };
  // OVER 1 rule: 0 and 1 each < 10%
  over1: boolean;
  over1Freq: { d0: number; d1: number };
  updatedAt: number;
  thresholdPct: number;
};

/** Extract the last decimal digit of a quote exactly as Deriv displays it. */
export function lastDigitOf(quote: number | string, pipSize = 2): number {
  return digitFromQuote(quote, pipSize);
}

/** A tick buffer kept at SCANNER_MAX_LOOKBACK so the window can grow instantly. */
export class DigitWindow {
  private digits: number[] = [];
  private pipSize = 2;
  private lastQuote: number | null = null;

  push(quote: number | string, pipSize?: number): void {
    this.lastQuote = Number(quote);
    if (typeof pipSize === "number" && Number.isFinite(pipSize) && pipSize > 0) {
      this.pipSize = pipSize;
    }
    const d = digitFromQuote(quote, this.pipSize);
    if (!Number.isInteger(d) || d < 0 || d > 9) return;
    this.digits.push(d);
    if (this.digits.length > SCANNER_MAX_LOOKBACK) {
      this.digits.splice(0, this.digits.length - SCANNER_MAX_LOOKBACK);
    }
  }

  seed(quotes: Array<number | string>, pipSize?: number): void {
    if (typeof pipSize === "number" && Number.isFinite(pipSize) && pipSize > 0) {
      this.pipSize = pipSize;
    }
    for (const q of quotes) this.push(q, this.pipSize);
  }

  get length(): number {
    return this.digits.length;
  }

  get lastDigit(): number | null {
    return this.digits.length > 0 ? this.digits[this.digits.length - 1] : null;
  }

  get lastQuoteValue(): number | null {
    return this.lastQuote;
  }

  get pipSizeValue(): number {
    return this.pipSize;
  }

  /** Slice of the last `lookback` digits. */
  recent(lookback: number): number[] {
    return this.digits.slice(-lookback);
  }

  clear(): void {
    this.digits = [];
  }
}

/**
 * Classify a digit sequence against the two rules with exact math.
 * Pure — takes the digit list and returns statistics; never touches the DOM.
 */
export function classifyDigits(
  digits: number[],
  lookback: number = SCANNER_DEFAULT_LOOKBACK,
  thresholdPct: number = SCANNER_THRESHOLD_PCT,
): Omit<MarketSignal, "symbol" | "name" | "lastQuote" | "pipSize" | "updatedAt"> {
  const window = digits.slice(-lookback);
  const n = window.length;
  const counts = new Array<number>(10).fill(0);
  for (const d of window) {
    if (Number.isInteger(d) && d >= 0 && d <= 9) counts[d]++;
  }
  const stats: DigitStat[] = counts.map((count, digit) => ({
    digit,
    count,
    // Round only float noise away — every real frequency (count/n over
    // n ≤ 200) is a multiple of 0.5%, so 4 decimals never distorts a value.
    freq: n > 0 ? Math.round(((count / n) * 100) * 1e4) / 1e4 : 0,
  }));
  const freqOf = (d: number) => stats[d].freq;
  const hasData = n > 0;

  return {
    lookback,
    ticks: n,
    lastDigit: n > 0 ? window[n - 1] : null,
    digits: stats,
    under8: hasData && freqOf(8) < thresholdPct && freqOf(9) < thresholdPct,
    under8Freq: { d8: freqOf(8), d9: freqOf(9) },
    over1: hasData && freqOf(0) < thresholdPct && freqOf(1) < thresholdPct,
    thresholdPct,
    over1Freq: { d0: freqOf(0), d1: freqOf(1) },
  };
}

export type TradeSuggestion = {
  symbol: string;
  name: string;
  subContract: "under" | "over";
  digit: 8 | 1;
  /** How far below 10% the tightest danger digit is — bigger is stronger. */
  strength: number;
};

/**
 * Rank all qualifying signals. A suggestion's strength is the smallest margin
 * among its two danger digits (the binding constraint), so the strongest
 * suggestion is the one furthest below the 10% ceiling on both digits.
 */
export function rankSuggestions(signals: MarketSignal[]): TradeSuggestion[] {
  const out: TradeSuggestion[] = [];
  for (const s of signals) {
    if (s.under8) {
      out.push({
        symbol: s.symbol,
        name: s.name,
        subContract: "under",
        digit: 8,
        strength: Math.min((s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.under8Freq.d8, (s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.under8Freq.d9),
      });
    }
    if (s.over1) {
      out.push({
        symbol: s.symbol,
        name: s.name,
        subContract: "over",
        digit: 1,
        strength: Math.min((s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.over1Freq.d0, (s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.over1Freq.d1),
      });
    }
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/* ------------------------------------------------------------------ */
/*  Live engine                                                        */
/* ------------------------------------------------------------------ */

export type ScannerSymbolStatus = "connecting" | "live" | "stalled" | "reconnecting" | "failed";

export type ScannerStatus = {
  state: "connecting" | "live" | "reconnecting" | "failed";
  reconnectAttempt: number;   // highest per-symbol reconnect attempt currently in flight
  connectedAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
};

const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
const PING_INTERVAL_MS = 15_000;      // Deriv best practice: periodic ping keeps it alive
const STALE_MS = 45_000;              // no message at all for this long → close + reconnect
const STALLED_MS = 6_000;             // 1s markets tick ~1/s; silence past this → resubscribe
const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1000;
const EMIT_MIN_INTERVAL_MS = 300;     // throttle UI re-renders to ~3/sec

function jitteredDelay(attempt: number): number {
  const base = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

type SymbolSocket = {
  ws: WebSocket;
  watchdog: StaleWatchdog;
  pingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  lastTickAt: number;
};

export class MarketScanner {
  private windows: Map<string, DigitWindow> = new Map();
  private ledger: SignalLedger;
  private thresholds: Map<string, ScannerDangerThreshold>;
  private ledgerSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private sockets: Map<string, SymbolSocket> = new Map();
  /** Per-symbol status persists even while a socket is between connect attempts. */
  private symbolStatuses: Map<string, ScannerSymbolStatus> = new Map();
  private status: ScannerStatus = {
    state: "connecting",
    reconnectAttempt: 0,
    connectedAt: null,
    lastCloseAt: null,
    lastCloseCode: null,
  };
  private lookback: number = SCANNER_DEFAULT_LOOKBACK;
  private wantConnected = false;
  private updateCbs = new Set<() => void>();
  private statusCbs = new Set<(s: ScannerStatus) => void>();
  private lastEmitAt = 0;
  private quietWatcher: ReturnType<typeof setInterval> | null = null;

  constructor(lookback: number = SCANNER_DEFAULT_LOOKBACK) {
    this.lookback = lookback;
    this.ledger = new SignalLedger();
    this.thresholds = loadThresholds();
    for (const m of SCANNER_MARKETS) {
      this.windows.set(m.symbol, new DigitWindow());
      this.symbolStatuses.set(m.symbol, "connecting");
    }
  }

  /* ---- lifecycle ---- */

  start(): void {
    if (this.wantConnected) return;
    this.wantConnected = true;
    for (const m of SCANNER_MARKETS) this.connectSymbol(m.symbol, 0);
    this.quietWatcher = setInterval(() => this.checkQuietSockets(), 2000);
  }

  destroy(): void {
    this.wantConnected = false;
    for (const sym of SCANNER_MARKET_SYMBOLS) this.disconnectSymbol(sym);
    if (this.quietWatcher) {
      clearInterval(this.quietWatcher);
      this.quietWatcher = null;
    }
    if (this.ledgerSaveTimer) clearTimeout(this.ledgerSaveTimer);
    this.saveLedger();
    this.updateCbs.clear();
    this.statusCbs.clear();
  }

  setLookback(n: number): void {
    const v = SCANNER_LOOKBACK_OPTIONS.includes(n as (typeof SCANNER_LOOKBACK_OPTIONS)[number])
      ? n
      : SCANNER_DEFAULT_LOOKBACK;
    this.lookback = v;
    this.emitUpdate();
  }

  getLookback(): number {
    return this.lookback;
  }

  /* ---- per-symbol sockets ---- */

  private connectSymbol(symbol: string, startingAttempt: number): void {
    const existing = this.sockets.get(symbol);
    if (existing) {
      if (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING) return;
      this.disconnectSymbol(symbol);
    }

    const attempt = startingAttempt;
    this.symbolStatuses.set(symbol, attempt > 0 ? "reconnecting" : "connecting");
    this.aggregateStatus();

    const conn: SymbolSocket = {
      ws: null as unknown as WebSocket,
      watchdog: null as unknown as StaleWatchdog,
      pingTimer: null,
      reconnectTimer: null,
      attempt,
      lastTickAt: Date.now(),
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(PUBLIC_WS);
    } catch {
      this.scheduleReconnect(symbol, conn.attempt);
      return;
    }
    conn.ws = ws;
    this.sockets.set(symbol, conn);

    const watchdog = new StaleWatchdog({
      staleMs: STALE_MS,
      onStale: () => {
        // A superseded socket must never touch the live connection.
        if (this.sockets.get(symbol) !== conn) return;
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4000, "scanner stale watchdog");
        }
      },
    });
    conn.watchdog = watchdog;

    ws.onopen = () => {
      if (this.sockets.get(symbol) !== conn) return;
      conn.attempt = 0;
      conn.lastTickAt = Date.now();
      this.status.connectedAt = Date.now();
      this.symbolStatuses.set(symbol, "connecting"); // live once ticks/history arrive
      this.aggregateStatus();
      // Backfill the window so the scanner is meaningful immediately, then go live.
      ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: SCANNER_MAX_LOOKBACK,
        end: "latest",
        style: "ticks",
      }));
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      watchdog.arm();
      this.startPing(symbol);
    };

    ws.onmessage = (event) => {
      if (this.sockets.get(symbol) !== conn) return;
      watchdog.poke();
      this.handleMessage(symbol, conn, event);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — reconnect handled there
    };

    ws.onclose = (event) => {
      watchdog.disarm();
      this.stopPing(symbol);
      if (this.sockets.get(symbol) !== conn) return;
      this.sockets.delete(symbol);
      this.setStatus({
        ...this.status,
        lastCloseAt: Date.now(),
        lastCloseCode: event.code ?? 1006,
      });
      if (!this.wantConnected) {
        this.symbolStatuses.set(symbol, "failed");
        this.aggregateStatus();
        return;
      }
      // Normal shutdowns (1000/1001) still need a live feed — reconnect.
      this.scheduleReconnect(symbol, conn.attempt);
    };
  }

  private scheduleReconnect(symbol: string, previousAttempt: number): void {
    if (!this.wantConnected) return;
    const attempt = previousAttempt + 1;
    this.symbolStatuses.set(symbol, "reconnecting");
    this.aggregateStatus();
    const delay = jitteredDelay(attempt);
    const timer = setTimeout(() => {
      if (!this.wantConnected) return;
      this.connectSymbol(symbol, attempt);
    }, delay);
    const conn = this.sockets.get(symbol);
    if (conn) conn.reconnectTimer = timer;
  }

  private disconnectSymbol(symbol: string): void {
    const conn = this.sockets.get(symbol);
    if (!conn) return;
    this.stopPing(symbol);
    conn.watchdog.disarm();
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    try { conn.ws.close(1000, "scanner dispose"); } catch { /* ignore */ }
    this.sockets.delete(symbol);
  }

  private startPing(symbol: string): void {
    this.stopPing(symbol);
    const conn = this.sockets.get(symbol);
    if (!conn) return;
    conn.pingTimer = setInterval(() => {
      const c = this.sockets.get(symbol);
      if (c && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(symbol: string): void {
    const conn = this.sockets.get(symbol);
    if (conn?.pingTimer) {
      clearInterval(conn.pingTimer);
      conn.pingTimer = null;
    }
  }

  /** Close + reconnect sockets whose market has gone quiet while supposedly live. */
  private checkQuietSockets(): void {
    const now = Date.now();
    for (const sym of SCANNER_MARKET_SYMBOLS) {
      const conn = this.sockets.get(sym);
      if (!conn || this.symbolStatuses.get(sym) !== "live") continue;
      if (now - conn.lastTickAt > STALLED_MS) {
        this.symbolStatuses.set(sym, "stalled");
        this.aggregateStatus();
        try { conn.ws.close(4000, "scanner market stalled"); } catch { /* ignore */ }
      }
    }
  }

  /* ---- message handling ---- */

  private handleMessage(symbol: string, conn: SymbolSocket, event: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.msg_type === "history") {
      const history = msg.history as
        | { prices?: Array<number | string>; pip_size?: number }
        | undefined;
      if (history && Array.isArray(history.prices) && history.prices.length > 0) {
        this.windows.get(symbol)?.seed(history.prices, history.pip_size);
        conn.lastTickAt = Date.now();
        this.symbolStatuses.set(symbol, "live");
        this.aggregateStatus();
        this.emitUpdate();
      }
      return;
    }

    if (msg.msg_type === "tick") {
      const tick = msg.tick as { quote?: number | string; pip_size?: number } | undefined;
      if (tick && tick.quote !== undefined) {
        const w = this.windows.get(symbol);
        w?.push(tick.quote, tick.pip_size);
        if (w && w.lastDigit !== null) {
          const cls = classifyDigits(w.recent(this.lookback), this.lookback, this.getDangerThreshold(symbol));
          advanceSignalLedger(w.lastDigit!, cls, this.ledger, symbol, Date.now());
          this.scheduleLedgerSave();
        }
        conn.lastTickAt = Date.now();
        if (this.symbolStatuses.get(symbol) !== "live") {
          this.symbolStatuses.set(symbol, "live");
          this.aggregateStatus();
        }
        this.emitUpdate();
      }
      return;
    }

    if (msg.error) {
      const err = msg.error as { message?: string; code?: string };
      console.warn(`[Scanner] ${symbol} API error:`, err?.message ?? err?.code ?? JSON.stringify(msg.error));
    }
  }

  /* ---- status bookkeeping ---- */

  private aggregateStatus(): void {
    const states = SCANNER_MARKET_SYMBOLS.map(
      (sym) => this.symbolStatuses.get(sym) ?? "connecting",
    );
    let maxAttempt = 0;
    for (const sym of SCANNER_MARKET_SYMBOLS) {
      const conn = this.sockets.get(sym);
      if (conn && conn.attempt > maxAttempt) maxAttempt = conn.attempt;
    }
    let state: ScannerStatus["state"];
    if (states.some((s) => s === "failed")) {
      state = "failed";
    } else if (states.some((s) => s === "reconnecting" || s === "stalled")) {
      state = "reconnecting";
    } else if (states.some((s) => s === "connecting")) {
      state = "connecting";
    } else {
      state = "live";
    }
    this.setStatus({ ...this.status, state, reconnectAttempt: maxAttempt });
  }

  private setStatus(s: ScannerStatus): void {
    this.status = s;
    for (const cb of this.statusCbs) cb(this.status);
  }

  private emitUpdate(): void {
    const now = Date.now();
    if (now - this.lastEmitAt < EMIT_MIN_INTERVAL_MS) return;
    this.lastEmitAt = now;
    for (const cb of this.updateCbs) cb();
  }

  /* ---- public reads ---- */

  getSignals(): MarketSignal[] {
    const now = Date.now();
    const out: MarketSignal[] = [];
    for (const m of SCANNER_MARKETS) {
      const w = this.windows.get(m.symbol);
      if (!w) continue;
      const thresholdPct = this.getDangerThreshold(m.symbol);
      const base = classifyDigits(w.recent(this.lookback), this.lookback, thresholdPct);
      out.push({
        ...base,
        symbol: m.symbol,
        name: m.name,
        lastQuote: w.lastQuoteValue,
        pipSize: w.pipSizeValue,
        updatedAt: now,
      });
    }
    return out;
  }

  getSuggestions(): TradeSuggestion[] {
    return rankSuggestions(this.getSignals());
  }

  getTracks(): SignalTracks {
    return this.ledger;
  }

  getDangerThreshold(symbol: string): ScannerDangerThreshold {
    return this.thresholds.get(symbol) ?? SCANNER_THRESHOLD_PCT;
  }

  setDangerThreshold(symbol: string, thresholdPct: ScannerDangerThreshold): void {
    if (!SCANNER_DANGER_THRESHOLDS.includes(thresholdPct)) return;
    this.thresholds.set(symbol, thresholdPct);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(THRESHOLD_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.thresholds)));
      } catch { /* optional preference */ }
    }
    this.emitUpdate();
  }

  private scheduleLedgerSave(): void {
    if (typeof window === "undefined" || this.ledgerSaveTimer) return;
    this.ledgerSaveTimer = setTimeout(() => {
      this.ledgerSaveTimer = null;
      this.saveLedger();
    }, 1500);
  }

  private saveLedger(): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(TRACK_STORAGE_KEY, JSON.stringify(serializeSignalTracks(this.ledger))); } catch { /* optional */ }
  }

  getStatus(): ScannerStatus {
    return { ...this.status };
  }

  getSymbolStatuses(): Map<string, ScannerSymbolStatus> {
    return new Map(this.symbolStatuses);
  }

  getWindowLength(symbol: string): number {
    return this.windows.get(symbol)?.length ?? 0;
  }

  onUpdate(cb: () => void): () => void {
    this.updateCbs.add(cb);
    return () => this.updateCbs.delete(cb);
  }

  onStatus(cb: (s: ScannerStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }
}

/* ------------------------------------------------------------------ */
/*  Global singleton — survives page navigation like getGlobalAnalyzer  */
/* ------------------------------------------------------------------ */

let globalScanner: MarketScanner | null = null;

export function getGlobalScanner(): MarketScanner {
  if (!globalScanner) {
    globalScanner = new MarketScanner();
  }
  return globalScanner;
}
