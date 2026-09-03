"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useDerivTrading, type Proposal, type DerivAccount } from "./use-deriv-ws";
import { useAuth } from "./use-auth";
import { useBot } from "./use-bot";
import { getGlobalAnalyzer } from "../lib/market-analyzer";
import type { TradeRecommendation } from "./market-analyzer";
import { defaultRiskSettings, createInitialRiskState, checkRiskLimits, updateRiskState, type RiskSettings, type RiskState } from "./risk-management";
import { pushNotification } from "./notification-system";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  saveNotificationSettings,
  loadPriceAlerts,
  savePriceAlerts,
  PRICE_ALERT_CAP,
  type NotificationSettings,
  type PriceAlert,
} from "../lib/notification-store";
import { digitFromQuote } from "../lib/format-utils";
import { getAutoTradeEngine } from "../lib/auto-trade";

type Market = { symbol: string; display_name: string; market: string; market_display_name: string; submarket: string; submarket_display_name: string; exchange_is_open: number; };
type ContractGroup = "Over / Under" | "Matches / Differs" | "Even / Odd";
type SubContract = "over" | "under" | "match" | "differs" | "even" | "odd";
type Tick = { value: number; digit: number };
const tabRoutes: Record<ActiveTab, string> = { workspace: "/", history: "/history", bots: "/bots", analyzer: "/analyzer", portfolio: "/portfolio", risk: "/risk", settings: "/settings" };
export { tabRoutes };

type ResolvedTrade = { exit_tick: number; status: "won" | "lost"; epoch: number; profit: number; digit: number };

type ActiveTab = "workspace" | "history" | "bots" | "settings" | "analyzer" | "portfolio" | "risk";

export const contractGroups: ContractGroup[] = ["Over / Under", "Matches / Differs", "Even / Odd"];
export const subContracts: Record<ContractGroup, {label:string;value:SubContract}[]> = {
  "Over / Under": [{label:"Over",value:"over"},{label:"Under",value:"under"}],
  "Matches / Differs": [{label:"Match",value:"match"},{label:"Differs",value:"differs"}],
  "Even / Odd": [{label:"Even",value:"even"},{label:"Odd",value:"odd"}],
};
export function subToApiType(sub: SubContract): string {
  const map: Record<SubContract, string> = { over:"DIGITOVER", under:"DIGITUNDER", match:"DIGITMATCH", differs:"DIGITDIFF", even:"DIGITEVEN", odd:"DIGITODD" };
  return map[sub];
}
export function subNeedsBarrier(sub: SubContract): boolean {
  return sub === "over" || sub === "under" || sub === "match" || sub === "differs";
}
export const durationOptions = [{label:"1 tick",value:1},{label:"5 ticks",value:5},{label:"10 ticks",value:10},{label:"15 ticks",value:15},{label:"25 ticks",value:25},{label:"50 ticks",value:50}];
export function fmt(n: number | string) {
  return Number(n).toFixed(2);
}
const initialTicks: Tick[] = Array.from({ length: 100 }, (_, i) => {
  const value = 644.52 + Math.sin(i * 0.38) * 1.35 + Math.cos(i * 0.11) * 0.55;
  return { value, digit: Number(value.toFixed(2).replace(".", "").slice(-1)) };
});

function makeTick(previous: number): Tick {
  const value = Math.max(640, previous + (Math.random() - 0.47) * 1.8);
  return { value, digit: Number(value.toFixed(2).replace(".", "").slice(-1)) };
}

export function formatContractType(type: string): string {
  const map: Record<string, string> = { DIGITOVER:"Over", DIGITUNDER:"Under", DIGITMATCH:"Match", DIGITDIFF:"Differs", DIGITEVEN:"Even", DIGITODD:"Odd" };
  return map[type] ?? type;
}

export type TradingContextValue = {
  isMounted: boolean;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  symbol: string;
  setSymbol: (s: string) => void;
  contractGroup: ContractGroup;
  setContractGroup: (g: ContractGroup) => void;
  subContract: SubContract;
  setSubContract: (s: SubContract) => void;
  stake: string;
  setStake: (s: string) => void;
  ticks: Tick[];
  running: boolean;
  setRunning: (r: boolean | ((v: boolean) => boolean)) => void;
  selectedDigit: number;
  setSelectedDigit: (d: number) => void;
  streamMode: "live" | "simulated";
  tickStreamStatus: "connecting" | "live" | "reconnecting" | "simulated";
  chartLoading: boolean;
  chartSkeletonMounted: boolean;
  accounts: DerivAccount[];
  activeAccountId: string;
  accountStatus: string;
  duration: number;
  setDuration: (d: number) => void;
  tradeError: string | null;
  setTradeError: (e: string | null) => void;
  showUserMenu: boolean;
  setShowUserMenu: (v: boolean | ((v: boolean) => boolean)) => void;
  showMobileMenu: boolean;
  setShowMobileMenu: (v: boolean | ((v: boolean) => boolean)) => void;
  showMarketPicker: boolean;
  setShowMarketPicker: (v: boolean | ((v: boolean) => boolean)) => void;
  marketSearch: string;
  setMarketSearch: (s: string) => void;
  markets: Market[];
  setMarkets: (m: Market[] | ((m: Market[]) => Market[])) => void;
  marketsLoading: boolean;
  showWallet: boolean;
  setShowWallet: (v: boolean | ((v: boolean) => boolean)) => void;
  showNotificationCenter: boolean;
  setShowNotificationCenter: (v: boolean | ((v: boolean) => boolean)) => void;
  riskSettings: RiskSettings;
  setRiskSettings: (s: RiskSettings | ((s: RiskSettings) => RiskSettings)) => void;
  riskState: RiskState;
  setRiskState: (s: RiskState | ((s: RiskState) => RiskState)) => void;
  notifSettings: NotificationSettings;
  setNotifSettings: (s: NotificationSettings | ((s: NotificationSettings) => NotificationSettings)) => void;
  priceAlerts: PriceAlert[];
  addPriceAlert: (price: number, direction: "above" | "below") => void;
  removePriceAlert: (id: string) => void;
  resolvedDigit: number | null;
  setResolvedDigit: (d: number | null) => void;
  resolvedOutcome: "won" | "lost" | null;
  contractTickElapsed: number;
  indicatorDuration: number;
  setIndicatorDuration: (d: number) => void;
  isBuying: boolean;
  setIsBuying: (v: boolean | ((v: boolean) => boolean)) => void;
  current: Tick;
  priceDelta: number;
  priceChangePct: number;
  symbolLabel: string;
  percentages: number[];
  subOptions: { label: string; value: SubContract }[];
  needsBarrier: boolean;
  isDemo: boolean;
  stakeNum: number;
  activeAccount: DerivAccount | undefined;
  activeContract: any;
  handlePlaceTrade: () => Promise<void>;
  handleUseRecommendation: (rec: TradeRecommendation) => void;
  handleContractGroupChange: (group: ContractGroup) => void;
  handleHedge: () => void;
  activateAccount: (account: DerivAccount) => void;
  loadAccounts: () => Promise<void>;
  formatContractType: (type: string) => string;
  balance: number | null;
  balanceCurrency: string;
  connectionStatus: string;
  reconnectAttempt: number;
  lastResult: any;
  clearLastResult: () => void;
  tradeHistory: any[];
  currentProposal: Proposal | null;
  proposalRef: React.MutableRefObject<Proposal | null>;
  proposalLoading: boolean;
  buy: (id: string, price: number) => Promise<any>;
  sell: (id: string) => void;
  subscribeProposal: (params: any) => void;
  clearError: () => void;
  lastError: string | null;
  authenticated: boolean;
  authLoading: boolean;
  resolvedTrades: ResolvedTrade[];
  login: () => Promise<void>;
  logout: () => Promise<void>;
  fetchProfitTable: any;
  fetchPortfolio: any;
  botApi: any;
  propose: any;
  buyBot: any;
  subscribeToContract: any;
  unsubscribeFromContract: any;
  wsAccounts: any[];
};





const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({ children, initialTab = "workspace" }: { children: React.ReactNode; initialTab?: ActiveTab }) {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [symbol, setSymbol] = useState("1HZ100V");
  const [contractGroup, setContractGroup] = useState<ContractGroup>(contractGroups[0]);
  const [subContract, setSubContract] = useState<SubContract>("over");
  const [stake, setStake] = useState("10.00");
  const [ticks, setTicks] = useState<Tick[]>(initialTicks);
  const pipSizeRef = useRef(2);
  const [running, setRunning] = useState(true);
  const [selectedDigit, setSelectedDigit] = useState(4);
  const [streamMode, setStreamMode] = useState<"live" | "simulated">("simulated");
  const [tickStreamStatus, setTickStreamStatus] = useState<"connecting" | "live" | "reconnecting" | "simulated">("connecting");
  const [chartLoading, setChartLoading] = useState(true);
  const [chartSkeletonMounted, setChartSkeletonMounted] = useState(true);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const [accountStatus, setAccountStatus] = useState("Connecting to Deriv…");
  const [duration, setDuration] = useState(5);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [showWallet, setShowWallet] = useState(false);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(defaultRiskSettings);
  const [riskState, setRiskState] = useState<RiskState>(createInitialRiskState);
  const [resolvedDigit, setResolvedDigit] = useState<number | null>(null);
  const [resolvedOutcome, setResolvedOutcome] = useState<"won" | "lost" | null>(null);
  const [resolvedTrades, setResolvedTrades] = useState<ResolvedTrade[]>([]);
  const [contractTickElapsed, setContractTickElapsed] = useState(0);
  const [indicatorDuration, setIndicatorDuration] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("freebuff_indicatorDuration");
      return saved ? Number(saved) : 3;
    }
    return 3;
  });

  const tickStreamWs = useRef<WebSocket | null>(null);
  const proposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickReconnectAttempts = useRef(0);
  const tickReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSymbolRef = useRef(symbol);
  const queryClient = useQueryClient();

  /* ---- notification settings (persisted) ---- */
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_NOTIFICATION_SETTINGS };
    try { return loadNotificationSettings(window.localStorage); } catch { return { ...DEFAULT_NOTIFICATION_SETTINGS }; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    saveNotificationSettings(window.localStorage, notifSettings);
  }, [notifSettings]);

  /* ---- price alerts (one-shot, persisted per market) ---- */
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(() => {
    if (typeof window === "undefined") return [];
    try { return loadPriceAlerts(window.localStorage); } catch { return []; }
  });
  const priceAlertsRef = useRef(priceAlerts);
  useEffect(() => {
    priceAlertsRef.current = priceAlerts;
    if (typeof window === "undefined") return;
    savePriceAlerts(window.localStorage, priceAlerts);
  }, [priceAlerts]);

  /* ---- balance watcher: last own-trade action timestamp for suppression ---- */
  const lastTradeActionAtRef = useRef(0);
  const prevBalanceRef = useRef<number | null>(null);

  const {
    connectionStatus,
    reconnectAttempt,
    balance,
    balanceCurrency,
    activeContract,
    currentProposal,
    proposalLoading,
    proposalRef,
    lastResult,
    lastError,
    tradeHistory,
    connect: connectTrading,
    propose,
    subscribeProposal,
    buy,
    buyBot,
    sell,
    subscribeToContract,
    unsubscribeFromContract,
    refreshBalance,
    fetchProfitTable,
    fetchPortfolio,
    refreshAccounts,
    accounts: wsAccounts,
    clearLastResult,
    clearError,
  } = useDerivTrading();

  /* ---- bot: lift to terminal level so state persists across tab switches ---- */
  const wsDeps = useMemo(() => ({
    propose,
    buy,
    buyBot,
    subscribeToContract,
    unsubscribeFromContract,
    refreshBalance,
    connected: connectionStatus === "connected",
  }), [propose, buy, buyBot, subscribeToContract, unsubscribeFromContract, refreshBalance, connectionStatus]);
  const botApi = useBot(wsDeps);

  const {
    loading: authLoading,
    authenticated,
    accounts: authAccounts,
    error: authError,
    login,
    logout,
  } = useAuth();

  /* ---- mount ---- */
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Navigation is URL-driven. The terminal itself remains mounted in the root
  // layout so a route change does not tear down the authenticated WebSocket.
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  /* ---- wire auto-trade engine ---- */
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    const engine = getAutoTradeEngine();
    engine.setAdapter({
      propose: async (req) => {
        const p = await propose({
          contract_type: req.contract_type,
          symbol: req.symbol,
          amount: req.amount,
          currency: req.currency,
          duration_ticks: req.duration,
        });
        if (!p) return null;
        return { id: p.id, ask_price: p.ask_price, payout: p.payout };
      },
      buy: async (proposalId, price) => {
        const c = await buy(proposalId, price);
        if (!c) return null;
        return { contract_id: c.contract_id };
      },
      subscribeToContract,
      isDemo: () => activeAccount?.type !== "real",
    });
  }, [connectionStatus, propose, buy, subscribeToContract, activeAccount?.type]);

  /* ---- load markets from API ---- */
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/deriv/markets", { cache: "no-store" });
        const data = (await res.json()) as { markets?: Market[] };
        if (data.markets?.length) {
          setMarkets(data.markets);
          if (!data.markets.find((m) => m.symbol === symbol)) {
            setSymbol(data.markets[0].symbol);
          }
        }
      } catch {
        setMarkets([
          { symbol: "1HZ100V", display_name: "Volatility 100 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
          { symbol: "1HZ75V", display_name: "Volatility 75 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
          { symbol: "1HZ50V", display_name: "Volatility 50 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
          { symbol: "1HZ25V", display_name: "Volatility 25 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
          { symbol: "1HZ10V", display_name: "Volatility 10 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
          { symbol: "BOOM500", display_name: "Boom 500 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
          { symbol: "BOOM1000", display_name: "Boom 1000 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
          { symbol: "CRASH500", display_name: "Crash 500 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
          { symbol: "CRASH1000", display_name: "Crash 1000 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
          { symbol: "RDBULL", display_name: "Bull Market Index", market: "synthetic_index", market_display_name: "Derived", submarket: "range_break", submarket_display_name: "Range Break", exchange_is_open: 1 },
          { symbol: "RDBEAR", display_name: "Bear Market Index", market: "synthetic_index", market_display_name: "Derived", submarket: "range_break", submarket_display_name: "Range Break", exchange_is_open: 1 },
          { symbol: "frxEURUSD", display_name: "EUR/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
          { symbol: "frxGBPUSD", display_name: "GBP/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
          { symbol: "frxUSDJPY", display_name: "USD/JPY", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
        ]);
      } finally {
        setMarketsLoading(false);
      }
    })();
  }, []);

  /* ---- sync auth accounts into local state ---- */
  useEffect(() => {
    if (!authLoading && authAccounts.length > 0 && accounts.length === 0) {
      setAccounts(authAccounts);
      const preferred = authAccounts.find((a) => a.type === "demo") ?? authAccounts[0];
      activateAccount(preferred);
    }
  }, [authLoading, authAccounts]);

  /* ---- activate account ---- */
  const activateAccount = useCallback(
    (account: DerivAccount) => {
      setActiveAccountId(account.id);
      setAccountStatus(`Opening ${account.type} session…`);
      void connectTrading(account.id);
    },
    [connectTrading],
  );

  useEffect(() => {
    if (!activeAccountId) return;
    if (connectionStatus === "connected") {
      setAccountStatus(`${activeAccount?.type === "real" ? "Real" : "Demo"} account connected`);
    } else if (connectionStatus === "error") {
      setAccountStatus("Account connection failed");
    }
  }, [activeAccountId, activeAccount?.type, connectionStatus]);

  /* ---- load accounts ---- */
  const loadAccounts = useCallback(async () => {
    if (authAccounts.length > 0) {
      setAccounts(authAccounts);
      const preferred = authAccounts.find((a) => a.type === "demo") ?? authAccounts[0];
      activateAccount(preferred);
      return;
    }
    try {
      const response = await fetch("/api/deriv/accounts", { cache: "no-store" });
      const data = (await response.json()) as { accounts?: DerivAccount[] };
      if (!response.ok || !data.accounts?.length) throw new Error("No accounts available");
      setAccounts(data.accounts);
      const preferred = data.accounts.find((a) => a.type === "demo") ?? data.accounts[0];
      activateAccount(preferred);
    } catch {
      setAccountStatus("Deriv account unavailable");
      setStreamMode("simulated");
    }
  }, [activateAccount, authAccounts]);

  useEffect(() => {
    if (!authLoading) {
      void loadAccounts();
    }
  }, [loadAccounts, authLoading]);

  /* ---- keep symbol ref in sync ---- */
  useEffect(() => { currentSymbolRef.current = symbol; }, [symbol]);

  /* ---- tick stream (Options API public WebSocket) with auto-reconnect ---- */
  useEffect(() => {
    let alive = true;
    let tickReceived = false;
    const MAX_ATTEMPTS = 10;
    const BASE_DELAY = 1000;
    const MAX_DELAY = 30000;

    function jitteredDelay(attempt: number): number {
      const base = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
      return Math.round(base * (0.8 + Math.random() * 0.4));
    }

    async function connect() {
      if (!alive) return;
      const sym = currentSymbolRef.current;
      await getGlobalAnalyzer().setLearningSymbol(sym);
      getGlobalAnalyzer().setTerminalSymbol(sym);
      if (!alive) return;

      // Close any previous connection
      if (tickStreamWs.current) {
        tickStreamWs.current.close();
        tickStreamWs.current = null;
      }

      setTickStreamStatus(tickReconnectAttempts.current > 0 ? "reconnecting" : "connecting");

      try {
        const ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
        tickStreamWs.current = ws;

        ws.onopen = () => {
          tickReconnectAttempts.current = 0;
          console.log("[TickStream] Connected, requesting history + live ticks for", sym);
          // Step 1: Fetch initial tick history (one-shot)
          ws.send(JSON.stringify({ ticks_history: sym, style: "ticks", count: 2000, end: "latest" }));
          // Step 2: Subscribe to live tick stream (persistent feed)
          ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as Record<string, unknown>;
            const msgType = message.msg_type as string | undefined;

            if (msgType === "history") {
              const history = message.history as { prices?: Array<number | string>; pip_size?: number } | undefined;
              const pipSize = history?.pip_size ?? 2;
              pipSizeRef.current = pipSize;
              const prices = history?.prices ?? [];
              if (prices.length) {
                setTicks(prices.slice(-100).map((quote) => ({ value: Number(quote), digit: digitFromQuote(quote, pipSize) })));
                prices.slice(-2000).forEach((quote) => getGlobalAnalyzer().addTick(sym, { quote: Number(quote), epoch: 0 }));
                tickReceived = true; setChartLoading(false); setStreamMode("live"); setTimeout(() => setChartSkeletonMounted(false), 500);
              }
              return;
            }
            if (msgType === "tick") {
              const tick = message.tick as { quote?: number | string; pip_size?: number } | undefined;
              if (tick?.quote !== undefined) {
                if (!tickReceived) {
                  tickReceived = true;
                  setChartLoading(false);
                  setTimeout(() => setChartSkeletonMounted(false), 500);
                }
                // Reset reconnect attempts on successful tick receipt
                tickReconnectAttempts.current = 0;
                setTickStreamStatus("live");
                setStreamMode("live");
                const tickPipSize = tick.pip_size ?? 2;
                pipSizeRef.current = tickPipSize;
                setTicks((prev) => [...prev.slice(-99), { value: Number(tick.quote), digit: digitFromQuote(tick.quote ?? 0, tickPipSize) }]);
                try { getGlobalAnalyzer().addTick(sym, { quote: Number(tick.quote), epoch: 0 }); } catch { /* analyzer may not be mounted */ }
                evaluateAlertsRef.current(Number(tick.quote));
              }
            }

            // Subscription confirmation from ticks subscribe
            if (msgType === "tickstream") {
              console.log("[TickStream] Live subscription confirmed for", sym);
            }
            // Handle error responses
            if (message.error) {
              console.warn("[TickStream] API error:", (message.error as any).message || (message.error as any).code);
            }
          } catch { /* ignore parse errors */ }
        };

        ws.onerror = () => {
          // onerror is always followed by onclose — reconnection is handled there
        };

        ws.onclose = (event) => {
          if (!alive) return;
          console.log("[TickStream] WS closed, code=" + event.code + ", reason=" + (event.reason || "none"));
          // Normal closure codes — don't reconnect
          if (event.code === 1000 || event.code === 1001) {
            if (!tickReceived) {
              setTickStreamStatus("simulated");
              setStreamMode("simulated");
            }
            return;
          }
          // Abnormal closure — attempt reconnect with exponential backoff
          if (tickReconnectAttempts.current < MAX_ATTEMPTS) {
            const attempt = tickReconnectAttempts.current;
            tickReconnectAttempts.current = attempt + 1;
            const delay = jitteredDelay(attempt);
            setTickStreamStatus("reconnecting");
            if (!tickReceived) {
              setChartLoading(false);
              setTimeout(() => setChartSkeletonMounted(false), 500);
            }
            tickReconnectTimer.current = setTimeout(() => {
              if (alive) connect();
            }, delay);
          } else {
            // Exhausted all attempts — fall back to simulated
            setTickStreamStatus("simulated");
            setStreamMode("simulated");
            if (!tickReceived) {
              setChartLoading(false);
              setTimeout(() => setChartSkeletonMounted(false), 500);
            }
          }
        };
      } catch {
        // Connection creation failed
        setTickStreamStatus("simulated");
        setStreamMode("simulated");
        if (!tickReceived) {
          setChartLoading(false);
          setTimeout(() => setChartSkeletonMounted(false), 500);
        }
      }
    }

    // Safety timeout — dismiss skeleton after 5s even if no ticks arrive
    const skeletonTimeout = setTimeout(() => {
      if (!tickReceived) {
        setChartLoading(false);
        setTimeout(() => setChartSkeletonMounted(false), 500);
      }
    }, 5000);

    connect();

    return () => {
      alive = false;
      clearTimeout(skeletonTimeout);
      if (tickReconnectTimer.current) {
        clearTimeout(tickReconnectTimer.current);
        tickReconnectTimer.current = null;
      }
      if (tickStreamWs.current) {
        tickStreamWs.current.close();
        tickStreamWs.current = null;
      }
    };
  }, [symbol]);

/* ---- simulated ticks ---- */
  const lastSimTickRef = useRef(640);
  useEffect(() => {
    if (!running || streamMode === "live") return;
    const timer = window.setInterval(() => {
      const newTick = makeTick(lastSimTickRef.current);
      lastSimTickRef.current = newTick.value;
      setTicks((current) => [...current.slice(-55), newTick]);
      try { getGlobalAnalyzer().addTick(symbol, { quote: newTick.value, epoch: 0 }); } catch { /* ok */ }
      evaluateAlertsRef.current(newTick.value);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [running, streamMode]);

  /* ---- reset tick counter when trade starts ---- */
  useEffect(() => {
    if (activeContract && activeContract.status === "open") {
      contractTickElapsedRef.current = 0;
      setContractTickElapsed(0);
    }
  }, [activeContract?.contract_id]);

  /* ---- feed bot contract ticks into the chart ---- */
  const lastContractTickRef = useRef<number | null>(null);
  const contractTickElapsedRef = useRef(0);
  useEffect(() => {
    const tick = activeContract?.current_tick;
    if (!tick || tick === lastContractTickRef.current) return;
    lastContractTickRef.current = tick;
    setTicks((prev) => [...prev.slice(-99), { value: tick, digit: digitFromQuote(tick, 2) }]);
    evaluateAlertsRef.current(tick);
  }, [activeContract?.current_tick]);

  /* ---- auto-dismiss errors after a few seconds ---- */
  useEffect(() => {
    if (!lastError) return;
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [lastError, clearError]);

  /* ---- trade result sound/vibration ---- */
  useEffect(() => {
    if (!lastResult) return;
    if (!notifSettings.soundEnabled) return; // sound & vibration toggle
    try {
      if (navigator.vibrate) {
        navigator.vibrate(lastResult.status === "won" ? 100 : [50, 30, 50]);
      }
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.12;
      osc.frequency.value = lastResult.status === "won" ? 880 : 220;
      osc.type = "sine";
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.stop(ctx.currentTime + 0.25);
    } catch { /* audio not available */ }
  }, [lastResult, notifSettings.soundEnabled]);
  /* ---- notifications for trade results ---- */
  useEffect(() => {
    if (!lastResult) return;
    lastTradeActionAtRef.current = Date.now(); // suppress the balance-change toast for this settle
    if (notifSettings.tradeResults) {
      pushNotification({
        type: "trade",
        title: lastResult.status === "won" ? "Trade Won!" : "Trade Lost",
        message: `${lastResult.status === "won" ? "You won" : "You lost"} $${Math.abs(lastResult.profit).toFixed(2)}${lastResult.exit_tick != null ? ` · settled on digit ${digitFromQuote(lastResult.exit_tick, pipSizeRef.current)} at ${lastResult.exit_tick}` : ""}.`,
        profit: lastResult.profit,
        severity: lastResult.status === "won" ? "success" : "error",
      });
    }
    // Update risk state
    setRiskState((prev) => updateRiskState(prev, riskSettings, lastResult));
    // Auto-refresh wallet balances after trade settles
    queryClient.invalidateQueries({ queryKey: ["deriv", "wallets"] });
    queryClient.invalidateQueries({ queryKey: ["deriv", "platformAccounts"] });
  }, [lastResult, riskSettings, queryClient, notifSettings.tradeResults]);

  /* ---- balance-change notifications (own buy/settle deltas suppressed) ---- */
  useEffect(() => {
    if (balance === null) {
      prevBalanceRef.current = null;
      return;
    }
    const prev = prevBalanceRef.current;
    prevBalanceRef.current = balance;
    if (prev === null || !notifSettings.balanceChanges) return;
    const delta = balance - prev;
    if (Math.abs(delta) < 0.005) return; // no real change (duplicate feed value)
    // A fresh buy or settlement already toasts its own result — don't double-notify.
    if (Date.now() - lastTradeActionAtRef.current < 4000) return;
    const up = delta > 0;
    pushNotification({
      type: "balance",
      title: up ? "Balance increased" : "Balance decreased",
      message: `Balance ${up ? "rose" : "fell"} by ${up ? "+" : "-"}${Math.abs(delta).toFixed(2)} ${balanceCurrency} to ${balance.toFixed(2)}`,
      profit: delta,
      severity: up ? "success" : "warning",
    });
  }, [balance, balanceCurrency, notifSettings.balanceChanges]);

  /* ---- price alert management ---- */
  const addPriceAlert = useCallback((price: number, direction: "above" | "below") => {
    if (!Number.isFinite(price) || price <= 0) return;
    const alert: PriceAlert = {
      id: `pa-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      symbol,
      direction,
      price,
      createdAt: Date.now(),
    };
    setPriceAlerts((prev) => [alert, ...prev].slice(0, PRICE_ALERT_CAP));
    pushNotification({
      type: "system",
      title: "Price alert set",
      message: `${symbol} — notify when price moves ${direction === "above" ? "above" : "below"} ${fmt(price)}`,
      severity: "info",
    });
  }, [symbol]);

  const removePriceAlert = useCallback((id: string) => {
    setPriceAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /* ---- evaluate one-shot alerts on each fresh tick (never on backfill) ---- */
  const evaluateAlerts = useCallback((price: number) => {
    if (!notifSettings.priceAlerts) return; // disabled — alerts stay armed
    const list = priceAlertsRef.current;
    const fired = list.filter(
      (a) => a.symbol === symbol && (a.direction === "above" ? price >= a.price : price <= a.price),
    );
    if (fired.length === 0) return;
    setPriceAlerts((prev) => prev.filter((a) => !fired.some((f) => f.id === a.id)));
    for (const a of fired) {
      pushNotification({
        type: "alert",
        title: "Price alert triggered",
        message: `${a.symbol} ${a.direction === "above" ? "rose above" : "fell below"} ${fmt(a.price)} (now ${fmt(price)})`,
        severity: "info",
      });
    }
  }, [notifSettings.priceAlerts, symbol]);
  const evaluateAlertsRef = useRef(evaluateAlerts);
  useEffect(() => {
    evaluateAlertsRef.current = evaluateAlerts;
  });

  /* ---- resolved digit indicator on digit strip (colored by win/loss) ---- */
  useEffect(() => {
    if (!lastResult) return;
    const resolvedTick = lastResult.exit_tick;
    if (resolvedTick != null) {
      setResolvedDigit(digitFromQuote(resolvedTick, pipSizeRef.current));
      setResolvedOutcome(lastResult.status === "won" ? "won" : "lost");
    } else {
      setResolvedDigit(null);
      setResolvedOutcome(null);
    }
    const timer = setTimeout(() => {
      setResolvedDigit(null);
      setResolvedOutcome(null);
    }, indicatorDuration * 1000);
    return () => clearTimeout(timer);
  }, [lastResult, indicatorDuration]);

  /* ---- record resolved trades for chart history markers ---- */
  useEffect(() => {
    if (!lastResult) return;
    const resolvedTick = lastResult.exit_tick;
    if (typeof resolvedTick === "number") {
      setResolvedTrades((prev) => [
        ...prev.slice(-19),
        { exit_tick: resolvedTick, status: lastResult.status as "won" | "lost", epoch: Date.now(), profit: lastResult.profit, digit: digitFromQuote(resolvedTick, pipSizeRef.current) },
      ]);
    }
  }, [lastResult]);

  /* ---- daily risk reset ---- */
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    if (riskState.lastResetDate !== today) {
      setRiskState((prev) => ({ ...prev, dailyPnL: 0, lastResetDate: today }));
    }
  }, [riskState.lastResetDate]);

  /* ---- proposal subscription (debounced to avoid pricing storms) ---- */
  // When any trade parameter changes, re-subscribe to a new proposal.
  // The subscription sends continuous updates — no gaps, no stale button.
  useEffect(() => {
    if (activeTab !== "workspace") return;
    setTradeError(null);
    clearError();
    if (connectionStatus !== "connected") return;
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) return;
    if (proposeTimer.current) clearTimeout(proposeTimer.current);
    proposeTimer.current = setTimeout(() => {
      subscribeProposal({
        contract_type: subToApiType(subContract),
        symbol,
        amount: stakeNum,
        currency: balanceCurrency,
        duration_ticks: duration,
        barrier: subNeedsBarrier(subContract) ? String(selectedDigit) : undefined,
      });
    }, 100);
    return () => {
      if (proposeTimer.current) clearTimeout(proposeTimer.current);
    };
  }, [subContract, symbol, stake, duration, selectedDigit, connectionStatus, balanceCurrency, subscribeProposal, clearError, activeTab, lastResult?.contract_id]);

  /* ---- handle trade recommendation from analyzer ---- */
  const handleUseRecommendation = useCallback((rec: TradeRecommendation) => {
    // Map subContract to the right contractGroup
    const groupMap: Record<string, ContractGroup> = {
      over: "Over / Under",
      under: "Over / Under",
      match: "Matches / Differs",
      differs: "Matches / Differs",
      even: "Even / Odd",
      odd: "Even / Odd",
    };
    const group = groupMap[rec.subContract] ?? "Over / Under";
    setContractGroup(group);
    setSubContract(rec.subContract);
    if (rec.digit !== undefined) setSelectedDigit(rec.digit);
    if (rec.symbol && rec.symbol !== symbol) setSymbol(rec.symbol);
    setActiveTab("workspace");
  }, [symbol]);

  /* ---- handle contract group change ---- */
  const handleContractGroupChange = useCallback((group: ContractGroup) => {
    setContractGroup(group);
    setSubContract(subContracts[group][0].value);
  }, []);

  /* ---- hedge: auto-fill opposite contract ---- */
  const handleHedge = useCallback(() => {
    if (!activeContract) return;
    const ct = activeContract.contract_type;
    const digit = Number(activeContract.barrier ?? selectedDigit);
    // Map to opposite sub-contract
    const hedgeMap: Record<string, { sub: SubContract; group: ContractGroup }> = {
      DIGITOVER:  { sub: "under",  group: "Over / Under" },
      DIGITUNDER: { sub: "over",   group: "Over / Under" },
      DIGITEVEN:  { sub: "odd",    group: "Even / Odd" },
      DIGITODD:   { sub: "even",   group: "Even / Odd" },
      DIGITMATCH: { sub: "differs", group: "Matches / Differs" },
      DIGITDIFF:  { sub: "match",  group: "Matches / Differs" },
    };
    const hedge = ct ? hedgeMap[ct] : undefined;
    if (!hedge) return;
    setContractGroup(hedge.group);
    setSubContract(hedge.sub);
    setSelectedDigit(digit);
    setTradeError(null);
    clearError();
  }, [activeContract, selectedDigit, clearError]);


  /* ---- place trade ---- */
  const [isBuying, setIsBuying] = useState(false);
  const isBuyingRef = useRef(false);
  const handlePlaceTrade = useCallback(async () => {
    if (isBuyingRef.current) return;
    // Never attempt a buy over a dead/reconnecting trading socket: the request
    // cannot be delivered, and the proposal itself is stale by the time the
    // connection comes back. Show the real state instead of a confusing failure.
    if (connectionStatus !== "connected") {
      setTradeError(
        connectionStatus === "reconnecting"
          ? "Trading connection interrupted — reconnecting, please wait…"
          : "Trading connection unavailable — please reconnect.",
      );
      return;
    }
    const proposal = proposalRef.current;
    if (!proposal) { setTradeError("No active proposal. Wait for pricing."); return; }
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) { setTradeError("Enter a valid stake amount."); return; }
    if (activeContract) { setTradeError("You already have an active contract. Wait for it to settle."); return; }
    // Risk management check
    const riskCheck = checkRiskLimits(riskSettings, riskState, stakeNum);
    if (!riskCheck.allowed) {
      setTradeError(riskCheck.reason);
      if (notifSettings.riskWarnings) {
        pushNotification({ type: "risk", title: "Trade Blocked", message: riskCheck.reason, severity: "warning" });
      }
      return;
    }
    // Balance validation
    if (balance !== null && stakeNum > balance) {
      setTradeError(`Insufficient balance. You have $${fmt(balance)} ${balanceCurrency} but need $${fmt(stakeNum)}.`);
      return;
    }
    if (stakeNum > 0 && balance !== null && stakeNum > balance * 0.5) {
      // Warning for large stakes but allow it
      console.warn(`Large stake: $${fmt(stakeNum)} is >50% of balance $${fmt(balance)}`);
    }
    if (balance !== null && stakeNum > balance * 0.5) {
      const confirmed = window.confirm("You are staking $" + fmt(stakeNum) + " which is >50% of your balance ($" + fmt(balance) + "). Continue?");
      if (!confirmed) return;
    }
    setIsBuying(true);
    isBuyingRef.current = true;
    setTradeError(null);
    // For 1-tick trades, provide immediate visual feedback
    if (duration === 1 && notifSettings.tradeResults) {
      pushNotification({ type: "trade", title: "Placing Trade", message: "1-tick trade submitting…", severity: "info" });
    }
    try {
      console.log("[Trade] Buying proposal:", proposal.id, "price:", proposal.ask_price, "stake:", stakeNum);
      const result = await buy(proposal.id, proposal.ask_price);
      console.log("[Trade] Buy result:", result ? "contract_id=" + result.contract_id : "null", "status:", result?.status);
      if (result) lastTradeActionAtRef.current = Date.now(); // suppress balance toast for this buy
      if (!result) setTradeError("Buy request failed — check console for details.");
    } catch (e) {
      setTradeError(`Trade failed: ${String(e)}`);
    } finally {
      setIsBuying(false);
      isBuyingRef.current = false;
    }
  }, [stake, activeContract, buy, balance, balanceCurrency, riskSettings, riskState, duration, connectionStatus, notifSettings.riskWarnings, notifSettings.tradeResults]);

  /* ---- keyboard shortcuts ---- */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        void handlePlaceTrade();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlaceTrade]);

  /* ---- derived (current is in derived block below) ---- */

  const current = ticks.at(-1) ?? { value: 644.52, digit: 2 };
  const previous = ticks.at(-2)?.value ?? current.value;
  const priceDelta = current.value - previous;
  const priceChangePct = previous === 0 ? 0 : (priceDelta / previous) * 100;
  const symbolLabel = markets.find((m) => m.symbol === symbol)?.display_name ?? (markets[0]?.display_name ?? symbol);
  const percentages = useMemo(() => {
    const counts = Array.from({ length: 10 }, () => 2);
    for (const tick of ticks) counts[tick.digit] += 1;
    const total = counts.reduce((sum, c) => sum + c, 0);
    return counts.map((c) => Number(((c / total) * 100).toFixed(1)));
  }, [ticks]);

  /* ---- chart auto-scaling with Deriv-style axes ---- */
  const CHART_LEFT = 50;
  const CHART_RIGHT = 860;
  const CHART_TOP = 15;
  const CHART_BOTTOM = 335;
  const CHART_WIDTH = CHART_RIGHT - CHART_LEFT;
  const CHART_HEIGHT = CHART_BOTTOM - CHART_TOP;

  const chartRange = useMemo(() => {
    if (ticks.length === 0) return { min: 640, max: 650, padding: 5 };
    const values = ticks.map((t) => t.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = range * 0.15;
    return { min: min - padding, max: max + padding, padding };
  }, [ticks]);

  const chartX = useCallback((index: number) => {
    const total = Math.max(ticks.length - 1, 1);
    return CHART_LEFT + (index / total) * CHART_WIDTH;
  }, [ticks.length]);

  const chartY = useCallback((value: number) => {
    const range = chartRange.max - chartRange.min || 1;
    return CHART_TOP + ((chartRange.max - value) / range) * CHART_HEIGHT;
  }, [chartRange]);

  const priceAxisTicks = useMemo(() => {
    const { min, max } = chartRange;
    const count = 5;
    const result = [];
    for (let i = 0; i < count; i++) {
      const val = min + (i / (count - 1)) * (max - min);
      result.push({ value: val, y: chartY(val) });
    }
    return result;
  }, [chartRange, chartY]);

  const timeAxisTicks = useMemo(() => {
    if (ticks.length < 2) return [];
    const count = Math.min(5, ticks.length);
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor((i / (count - 1)) * (ticks.length - 1));
      const now = new Date();
      now.setSeconds(now.getSeconds() - (ticks.length - 1 - idx));
      const label = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      result.push({ label, x: chartX(idx) });
    }
    return result;
  }, [ticks, chartX]);

  const stakeNum = parseFloat(stake) || 0;
  const potentialPayout = currentProposal?.payout ?? 0;
  const askPrice = currentProposal?.ask_price ?? 0;
  const potentialProfit = potentialPayout > 0 && askPrice > 0 ? potentialPayout - askPrice : currentProposal?.profit ?? 0;
  const payoutRate = stakeNum > 0 ? ((potentialProfit / stakeNum) * 100).toFixed(1) : "0.0";
  const subOptions = subContracts[contractGroup];
  const needsBarrier = subNeedsBarrier(subContract);
  const isDemo = activeAccount?.type === "demo";

  const value: TradingContextValue = {
    // State
    isMounted, activeTab, setActiveTab, symbol, setSymbol, contractGroup, setContractGroup,
    subContract, setSubContract, stake, setStake, ticks, running, setRunning,
    selectedDigit, setSelectedDigit, streamMode, tickStreamStatus,
    chartLoading, chartSkeletonMounted, accounts, activeAccountId, accountStatus,
    duration, setDuration, tradeError, setTradeError, showUserMenu, setShowUserMenu,
    showMobileMenu, setShowMobileMenu, showMarketPicker, setShowMarketPicker,
    marketSearch, setMarketSearch, markets, marketsLoading, showWallet, setShowWallet,
    showNotificationCenter, setShowNotificationCenter, riskSettings, setRiskSettings,
    riskState, setRiskState, resolvedDigit, setResolvedDigit, contractTickElapsed,
    resolvedOutcome, indicatorDuration, setIndicatorDuration, isBuying, setIsBuying,
    notifSettings, setNotifSettings, priceAlerts, addPriceAlert, removePriceAlert,
    // Derived
    current, priceDelta, priceChangePct, symbolLabel, percentages,
    subOptions, needsBarrier, isDemo, stakeNum, activeAccount,
    // Callbacks
    handlePlaceTrade, handleUseRecommendation, handleContractGroupChange, handleHedge,
    activateAccount, loadAccounts, formatContractType,
    // From hooks
    balance, balanceCurrency, connectionStatus, reconnectAttempt, lastResult, clearLastResult,
    tradeHistory, currentProposal, proposalRef, proposalLoading, activeContract, buy, sell,
    setMarkets, authLoading, resolvedTrades,
    subscribeProposal, clearError, lastError, authenticated, login, logout,
    fetchProfitTable, fetchPortfolio, botApi, wsAccounts, propose, buyBot, subscribeToContract, unsubscribeFromContract,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}

export function useTrading(): TradingContextValue {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error("useTrading must be used within TradingProvider");
  return ctx;
}
