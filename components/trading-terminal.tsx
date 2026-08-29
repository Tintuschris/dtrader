"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconSettings, IconMenu2, IconX, IconRefresh, IconChevronDown,
  IconArrowUp, IconArrowDown, IconArrowRight, IconChartLine,
  IconRobot, IconChartBar, IconLogout, IconLogin, IconInfoCircle,
  IconSwitch2, IconAlertTriangle, IconCurrencyDollar, IconUser, IconBrain, IconWallet,
  IconBell, IconChartPie, IconShield,
} from "@tabler/icons-react";
import {
  useDerivTrading,
  type Proposal,
  type DerivAccount,
} from "./use-deriv-ws";
import { useAuth } from "./use-auth";
import TradingHistory from "./trading-history";
import SwipeCarousel from "./swipe-carousel";
import BotBuilder from "./bot-builder";
import dynamic from "next/dynamic";
const MarketAnalyzerPanel = dynamic(() => import("./market-analyzer"), { ssr: false, loading: () => <div className="workspace"><div className="workspace-heading"><div><p className="eyebrow">ANALYZER</p><h1>Market Analyzer</h1><p className="muted">Loading neural network engine…</p></div></div></div> });
import { useBot } from "./use-bot";
import WalletPanel from "./wallet-panel";
import TickChart from "./tick-chart";
import ErrorBoundary from "./error-boundary";
import { ToastContainer, NotificationCenter, pushNotification } from "./notification-system";
import PortfolioDashboard from "./portfolio-dashboard";
import { getGlobalAnalyzer } from "../lib/market-analyzer";
import { getAutoTradeEngine } from "../lib/auto-trade";
import RiskManagement, { defaultRiskSettings, createInitialRiskState, checkRiskLimits, updateRiskState, type RiskSettings, type RiskState } from "./risk-management";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Market = {
  symbol: string;
  display_name: string;
  market: string;
  market_display_name: string;
  submarket: string;
  submarket_display_name: string;
  exchange_is_open: number;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type ContractGroup = "Over / Under" | "Matches / Differs" | "Even / Odd";
const contractGroups: ContractGroup[] = [
  "Over / Under",
  "Matches / Differs",
  "Even / Odd",
];

type SubContract = "over" | "under" | "match" | "differs" | "even" | "odd";

const subContracts: Record<ContractGroup, { label: string; value: SubContract }[]> = {
  "Over / Under": [
    { label: "Over", value: "over" },
    { label: "Under", value: "under" },
  ],
  "Matches / Differs": [
    { label: "Match", value: "match" },
    { label: "Differs", value: "differs" },
  ],
  "Even / Odd": [
    { label: "Even", value: "even" },
    { label: "Odd", value: "odd" },
  ],
};

function subToApiType(sub: SubContract): string {
  const map: Record<SubContract, string> = {
    over: "DIGITOVER",
    under: "DIGITUNDER",
    match: "DIGITMATCH",
    differs: "DIGITDIFF",
    even: "DIGITEVEN",
    odd: "DIGITODD",
  };
  return map[sub];
}

function subNeedsBarrier(sub: SubContract): boolean {
  return sub === "over" || sub === "under" || sub === "match" || sub === "differs";
}

const durationOptions = [
  { label: "1 tick", value: 1 },
  { label: "5 ticks", value: 5 },
  { label: "10 ticks", value: 10 },
  { label: "15 ticks", value: 15 },
  { label: "25 ticks", value: 25 },
  { label: "50 ticks", value: 50 },
];

type Tick = { value: number; digit: number };

const initialTicks: Tick[] = Array.from({ length: 100 }, (_, index) => {
  const value =
    644.52 + Math.sin(index * 0.38) * 1.35 + Math.cos(index * 0.11) * 0.55;
  return {
    value,
    digit: Number(value.toFixed(2).replace(".", "").slice(-1)),
  };
});

function makeTick(previous: number): Tick {
  const value = Math.max(640, previous + (Math.random() - 0.47) * 1.8);
  return {
    value,
    digit: Number(value.toFixed(2).replace(".", "").slice(-1)),
  };
}

function digitFromQuote(quote: number | string, pipSize = 2) {
  return Number(Number(quote).toFixed(pipSize).replace(".", "").slice(-1));
}

function fmt(n: number | string) {
  return Number(n).toFixed(2);
}

export type ActiveTab = "workspace" | "history" | "bots" | "settings" | "analyzer" | "portfolio" | "risk";

const tabRoutes: Record<ActiveTab, string> = {
  workspace: "/",
  history: "/history",
  bots: "/bots",
  analyzer: "/analyzer",
  portfolio: "/portfolio",
  risk: "/risk",
  settings: "/settings",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TradingTerminal({ initialTab = "workspace" }: { initialTab?: ActiveTab }) {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [symbol, setSymbol] = useState("1HZ100V");
  const [contractGroup, setContractGroup] = useState<ContractGroup>(contractGroups[0]);
  const [subContract, setSubContract] = useState<SubContract>("over");
  const [stake, setStake] = useState("10.00");
  const [ticks, setTicks] = useState<Tick[]>(initialTicks);
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

  const tickStreamWs = useRef<WebSocket | null>(null);
  const proposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickReconnectAttempts = useRef(0);
  const tickReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSymbolRef = useRef(symbol);
  const queryClient = useQueryClient();

  const {
    connectionStatus,
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
                setTicks((prev) => [...prev.slice(-99), { value: Number(tick.quote), digit: digitFromQuote(tick.quote ?? 0, tickPipSize) }]);
                try { getGlobalAnalyzer().addTick(sym, { quote: Number(tick.quote), epoch: 0 }); } catch { /* analyzer may not be mounted */ }
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
    }, 1200);
    return () => window.clearInterval(timer);
  }, [running, streamMode]);

  /* ---- feed bot contract ticks into the chart ---- */
  const lastContractTickRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = activeContract?.current_tick;
    if (!tick || tick === lastContractTickRef.current) return;
    lastContractTickRef.current = tick;
    setTicks((prev) => [...prev.slice(-99), { value: tick, digit: digitFromQuote(tick, 2) }]);
  }, [activeContract?.current_tick]);

  /* ---- auto-dismiss errors after a few seconds ---- */
  useEffect(() => {
    if (!lastError) return;
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [lastError, clearError]);

  /* ---- notifications for trade results ---- */
  useEffect(() => {
    if (!lastResult) return;
    pushNotification({
      type: "trade",
      title: lastResult.status === "won" ? "Trade Won!" : "Trade Lost",
      message: lastResult.status === "won"
        ? `You won $${Math.abs(lastResult.profit).toFixed(2)} on your trade!`
        : `You lost $${Math.abs(lastResult.profit).toFixed(2)} on your trade.`,
      profit: lastResult.profit,
      severity: lastResult.status === "won" ? "success" : "error",
    });
    // Update risk state
    setRiskState((prev) => updateRiskState(prev, riskSettings, lastResult));
    // Auto-refresh wallet balances after trade settles
    queryClient.invalidateQueries({ queryKey: ["deriv", "wallets"] });
    queryClient.invalidateQueries({ queryKey: ["deriv", "platformAccounts"] });
  }, [lastResult, riskSettings, queryClient]);

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

  /* ---- handle contract group change ---- */
  const handleContractGroupChange = useCallback((group: ContractGroup) => {
    setContractGroup(group);
    setSubContract(subContracts[group][0].value);
  }, []);

  /* ---- place trade ---- */
  const [isBuying, setIsBuying] = useState(false);
  const handlePlaceTrade = useCallback(async () => {
    if (isBuying) return;
    const proposal = proposalRef.current ?? currentProposal;
    if (!proposal) { setTradeError("No active proposal. Wait for pricing."); return; }
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) { setTradeError("Enter a valid stake amount."); return; }
    if (activeContract) { setTradeError("You already have an active contract. Wait for it to settle."); return; }
    // Risk management check
    const riskCheck = checkRiskLimits(riskSettings, riskState, stakeNum);
    if (!riskCheck.allowed) {
      setTradeError(riskCheck.reason);
      pushNotification({ type: "risk", title: "Trade Blocked", message: riskCheck.reason, severity: "warning" });
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
    setIsBuying(true);
    setTradeError(null);
    // For 1-tick trades, provide immediate visual feedback
    if (duration === 1) {
      pushNotification({ type: "trade", title: "Placing Trade", message: "1-tick trade submitting…", severity: "info" });
    }
    try {
      console.log("[Trade] Buying proposal:", proposal.id, "price:", proposal.ask_price, "stake:", stakeNum);
      const result = await buy(proposal.id, proposal.ask_price);
      console.log("[Trade] Buy result:", result ? "contract_id=" + result.contract_id : "null", "status:", result?.status);
      if (!result) setTradeError("Buy request failed — check console for details.");
    } catch (e) {
      setTradeError(`Trade failed: ${String(e)}`);
    } finally {
      setIsBuying(false);
    }
  }, [isBuying, currentProposal, stake, activeContract, buy, clearLastResult, balance, balanceCurrency]);

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

  /* ---- derived ---- */
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

  /* ---- win/loss streak ---- */
  const streak = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (let i = tradeHistory.length - 1; i >= 0; i--) {
      if (tradeHistory[i].status === "won") {
        if (losses > 0) break;
        wins++;
      } else if (tradeHistory[i].status === "lost") {
        if (wins > 0) break;
        losses++;
      } else break;
    }
    return wins > 0 ? { type: "win" as const, count: wins } : losses > 0 ? { type: "loss" as const, count: losses } : null;
  }, [tradeHistory]);

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

  if (!isMounted) {
    return <main className="app-shell terminal-loading">Preparing trading workspace…</main>;
  }

  /* ---- result overlay ---- */
  const resultOverlay = lastResult ? (
    <div className="result-overlay" onClick={clearLastResult}>
      <div className="result-card" onClick={(e) => e.stopPropagation()}>
        <div className={`result-badge ${lastResult.status}`}>
          {lastResult.status === "won" ? "✓ WIN" : lastResult.status === "lost" ? "✗ LOSS" : lastResult.status.toUpperCase()}
        </div>
        <div className={`result-profit ${lastResult.status === "won" ? "won" : "lost"}`}>
          {lastResult.profit >= 0 ? "+" : ""}${fmt(lastResult.profit)}
        </div>
        <div className="result-detail">Stake: ${fmt(lastResult.buy_price)} · Payout: ${fmt(lastResult.payout)}</div>
        <button className="result-dismiss" onClick={clearLastResult}>Dismiss</button>
      </div>
    </div>
  ) : null;

  return (
    <main className="app-shell">
      {resultOverlay}

      {/* ===== TOP BAR ===== */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <span className="brand-mark">D</span>
            <span className="brand-text">DTrader</span>
          </div>
          <nav className="main-nav" aria-label="Main navigation">
            <Link className={`nav-link ${activeTab === "workspace" ? "active" : ""}`} href={tabRoutes.workspace}>
              <IconChartLine size={15} /><span className="nav-label">Trade</span>
            </Link>
            <Link className={`nav-link ${activeTab === "history" ? "active" : ""}`} href={tabRoutes.history}>
              <IconChartBar size={15} /><span className="nav-label">History</span>
              {tradeHistory.length > 0 && <span className="nav-badge">{tradeHistory.length}</span>}
            </Link>
            <Link className={`nav-link ${activeTab === "analyzer" ? "active" : ""}`} href={tabRoutes.analyzer}>
              <IconBrain size={15} /><span className="nav-label">Analyze</span>
            </Link>
            <Link className={`nav-link ${activeTab === "bots" ? "active" : ""}`} href={tabRoutes.bots}>
              <IconRobot size={15} /><span className="nav-label">Bots</span>
            </Link>
            <Link className={`nav-link ${activeTab === "portfolio" ? "active" : ""}`} href={tabRoutes.portfolio}>
              <IconChartPie size={15} /><span className="nav-label">Portfolio</span>
            </Link>
            <Link className={`nav-link ${activeTab === "risk" ? "active" : ""}`} href={tabRoutes.risk}>
              <IconShield size={15} /><span className="nav-label">Risk</span>
            </Link>
            <Link className={`nav-link ${activeTab === "settings" ? "active" : ""}`} href={tabRoutes.settings}>
              <IconSettings size={15} /><span className="nav-label">Settings</span>
            </Link>
          </nav>
        </div>
        <div className="topbar-right">
          {balance !== null && (
            <button className="balance-pill" onClick={() => setShowWallet((v) => !v)} title="Click to view all accounts">
              <span className="balance-amount">${fmt(balance)}</span>
              <span className="balance-currency">{balanceCurrency}</span>
              <span className="balance-expand" /> 
            </button>
          )}
          {accounts.length > 0 ? (
            <div className="account-select-wrap">
              <span className={`account-type-dot ${isDemo ? "demo" : "real"}`} />
              <select
                className="account-select"
                value={activeAccountId}
                onChange={(e) => {
                  const account = accounts.find((a) => a.id === e.target.value);
                  if (account) void activateAccount(account);
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type === "real" ? "Real" : "Demo"} · {a.currency}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button className="connect-btn" onClick={() => void loadAccounts()}>Connect</button>
          )}
          <span className="ws-status" title={accountStatus}>
            <span className={`ws-dot ${connectionStatus}`} />
          </span>
          <button className="nc-bell-btn" onClick={() => setShowNotificationCenter((v) => !v)} title="Notifications">
            <IconBell size={18} />
          </button>
          {authenticated ? (
            <div className="user-menu-wrap">
              <button className="avatar-btn" onClick={() => setShowUserMenu((v) => !v)}>
                <IconUser size={16} />
              </button>
              {showUserMenu && (
                <div className="user-menu" onClick={() => setShowUserMenu(false)}>
                  <div className="user-menu-header">
                    {activeAccount?.type === "real" ? "Real" : "Demo"} Account
                  </div>
                  <button className="user-menu-item" onClick={() => void logout()}><IconLogout size={14} /> Logout</button>
                </div>
              )}
            </div>
          ) : (
            <button className="login-btn" onClick={() => void login()} disabled={authLoading}>
              {authLoading ? "…" : <><IconLogin size={14} /> Login</>}
            </button>
          )}
          <button className="mobile-menu-btn" onClick={() => setShowMobileMenu((v) => !v)} aria-label="Menu"><IconMenu2 size={20} /></button>
        </div>
      </header>

      {/* ===== MOBILE MENU ===== */}
      {showMobileMenu && (
        <div className="mobile-menu-overlay" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span className="brand-mark">D</span>
              <span>DTrader</span>
              <button className="mobile-menu-close" onClick={() => setShowMobileMenu(false)}><IconX size={18} /></button>
            </div>
            {balance !== null && (
              <div className="mobile-menu-balance">${fmt(balance)} {balanceCurrency}</div>
            )}
            <button className="mobile-menu-wallet-btn" onClick={() => { setShowWallet(true); setShowMobileMenu(false); }}><IconWallet size={16} /> Wallet & Accounts</button>
            {accounts.length > 0 && (
              <select
                className="mobile-account-select"
                value={activeAccountId}
                onChange={(e) => {
                  const account = accounts.find((a) => a.id === e.target.value);
                  if (account) void activateAccount(account);
                  setShowMobileMenu(false);
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.type === "real" ? "Real" : "Demo"} · {a.currency}</option>
                ))}
              </select>
            )}
            <div className="mobile-menu-links">
              <Link className={activeTab === "workspace" ? "active" : ""} href={tabRoutes.workspace} onClick={() => setShowMobileMenu(false)}><IconChartLine size={16} /> Trade</Link>
              <Link className={activeTab === "history" ? "active" : ""} href={tabRoutes.history} onClick={() => setShowMobileMenu(false)}><IconChartBar size={16} /> History</Link>
              <Link className={activeTab === "analyzer" ? "active" : ""} href={tabRoutes.analyzer} onClick={() => setShowMobileMenu(false)}><IconBrain size={16} /> Analyzer</Link>
              <Link className={activeTab === "bots" ? "active" : ""} href={tabRoutes.bots} onClick={() => setShowMobileMenu(false)}><IconRobot size={16} /> Bots</Link>
              <Link className={activeTab === "portfolio" ? "active" : ""} href={tabRoutes.portfolio} onClick={() => setShowMobileMenu(false)}><IconChartPie size={16} /> Portfolio</Link>
              <Link className={activeTab === "risk" ? "active" : ""} href={tabRoutes.risk} onClick={() => setShowMobileMenu(false)}><IconShield size={16} /> Risk</Link>
              <Link className={activeTab === "settings" ? "active" : ""} href={tabRoutes.settings} onClick={() => setShowMobileMenu(false)}><IconSettings size={16} /> Settings</Link>
            </div>
            <div className="mobile-menu-footer">
              {authenticated ? (
                <button className="mobile-logout-btn" onClick={() => { void logout(); setShowMobileMenu(false); }}><IconLogout size={14} /> Logout</button>
              ) : (
                <button className="mobile-login-btn" onClick={() => { void login(); setShowMobileMenu(false); }}><IconLogin size={14} /> Login with Deriv</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      {activeTab === "workspace" && (
        <section className="workspace" id="workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">
                OPTIONS WORKSPACE
                <span className={`live-badge ${tickStreamStatus === "reconnecting" ? "reconnecting" : ""}`}><i /> {tickStreamStatus === "reconnecting" ? "RECONNECTING…" : tickStreamStatus === "simulated" ? "SIMULATED" : "LIVE TICKS"}</span>
                {!isDemo && <span className="real-badge">REAL MONEY</span>}
              </p>
              <h1>Last digit trading</h1>
              <p className="muted">Read the final digit, choose a contract, and place a trade.</p>
            </div>
            <button className={`stream-button ${running ? "streaming" : ""} ${tickStreamStatus === "reconnecting" ? "reconnecting" : ""}`} onClick={() => setRunning((v) => !v)}>
              <span /> {tickStreamStatus === "reconnecting" ? "Reconnecting…" : running ? "Streaming" : "Paused"}
            </button>
          </div>

          <div className="terminal-grid">
            {/* ========== MARKET CARD ========== */}
            <section className="market-card panel" onClick={() => { if (showMarketPicker) setShowMarketPicker(false); }}>
              <div className="market-toolbar">
                <div className="market-selector" onClick={(e) => e.stopPropagation()}>
                  <button className="market-selector-btn" onClick={() => setShowMarketPicker((v) => !v)}>
                    <span className="market-icon">✦</span>
                    <div className="market-selector-text">
                      <span className="market-name">{symbolLabel}</span>
                      <span className="market-sub">{markets.find((m) => m.symbol === symbol)?.market_display_name ?? "Derived"}</span>
                    </div>
                    <span className={`market-chevron ${showMarketPicker ? "open" : ""}`}><IconChevronDown size={16} /></span>
                  </button>
                  {showMarketPicker && (
                    <div className="market-dropdown">
                      <div className="market-dropdown-header">
                        <span>Select market <span className="market-count">{marketSearch ? markets.filter((m) => m.display_name.toLowerCase().includes(marketSearch.toLowerCase()) || m.symbol.toLowerCase().includes(marketSearch.toLowerCase())).length : markets.length}</span></span>
                        <div className="market-dropdown-actions">
                          <button className="market-refresh-btn" onClick={async () => { const res = await fetch("/api/deriv/markets?refresh=1"); const data = await res.json(); if (data.markets?.length) setMarkets(data.markets); }} title="Refresh markets"><IconRefresh size={16} /></button>
                          <button className="market-dropdown-close" onClick={() => setShowMarketPicker(false)}><IconX size={14} /></button>
                        </div>
                      </div>
                      <div className="market-search-wrap">
                        <input
                          className="market-search-input"
                          type="text"
                          placeholder="Search markets..."
                          value={marketSearch}
                          onChange={(e) => setMarketSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="market-dropdown-list">{Object.entries(
                        markets
                          .filter((m) => {
                            if (!marketSearch) return true;
                            const q = marketSearch.toLowerCase();
                            return m.display_name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q);
                          })
                          .reduce((acc, m) => {
                            const group = m.submarket_display_name || m.market_display_name || "Other";
                            if (!acc[group]) acc[group] = [];
                            acc[group].push(m);
                            return acc;
                          }, {} as Record<string, Market[]>)
                      ).map(([group, items]) => (
                        <div key={group} className="market-group">
                          <div className="market-group-label">{group}</div>
                          {items.map((m) => (
                            <button
                              key={m.symbol}
                              className={`market-option ${symbol === m.symbol ? "active" : ""}`}
                              onClick={() => { setSymbol(m.symbol); setShowMarketPicker(false); setMarketSearch(""); }}
                            >
                              <span className="market-option-name">{m.display_name}</span>
                              <span className="market-option-symbol">{m.symbol}</span>
                            </button>
                          ))}
                        </div>
                      ))}</div>
                    </div>
                  )}
                </div>
                <button className="icon-button mobile-hide" aria-label="Chart settings"><IconSettings size={18} /></button>
              </div>
              <div className="price-row">
                <div>
                  <span className="price">{fmt(current.value)}</span>
                  <span className={`price-change ${priceDelta < 0 ? "negative" : ""}`}>{priceDelta >= 0 ? "+" : ""}{fmt(priceDelta)} <b>{priceDelta >= 0 ? "▲" : "▼"} {Math.abs(priceChangePct).toFixed(2)}%</b></span>
                </div>
                <div className="last-digit">
                  <span>LAST DIGIT</span>
                  <strong>{current.digit}</strong>
                </div>
              </div>
              {/* Desktop: show both, Mobile: carousel */}
              <div className="chart-section-desktop">
                <div className="chart-wrap">
                  {chartSkeletonMounted && (
                    <div className={`chart-skeleton ${chartLoading ? "" : "chart-skeleton-hidden"}`}>
                      <div className="chart-skeleton-line" />
                      <div className="chart-skeleton-line short" />
                      <div className="chart-skeleton-line medium" />
                      <div className="chart-skeleton-shimmer" />
                    </div>
                  )}
                  <TickChart ticks={ticks} activeContract={activeContract} />
                </div>
                <div className="digit-strip-heading">
                  <span>Digit frequency</span>
                  <span className="muted">Last 100 ticks</span>
                </div>
                <div className="digit-strip">
                  {percentages.map((pct, digit) => (
                    <button key={digit} className={`digit-ring digit-${digit} ${digit === current.digit ? "current" : ""} ${digit === selectedDigit && needsBarrier ? "chosen" : ""}`} onClick={() => setSelectedDigit(digit)}>
                      <strong>{digit}</strong>
                      <span>{pct}%</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="chart-section-mobile">
                <SwipeCarousel labels={["Chart", "Digits"]}>
                  {/* Slide 1: Chart */}
                  <div className="chart-wrap">
                    {chartSkeletonMounted && (
                      <div className={`chart-skeleton ${chartLoading ? "" : "chart-skeleton-hidden"}`}>
                        <div className="chart-skeleton-line" />
                        <div className="chart-skeleton-line short" />
                        <div className="chart-skeleton-line medium" />
                        <div className="chart-skeleton-shimmer" />
                      </div>
                    )}
                    <TickChart ticks={ticks} activeContract={activeContract} />
                  </div>
                  {/* Slide 2: Digit strip */}
                  <div className="digit-strip-slide">
                    <div className="digit-strip-heading">
                      <span>Digit frequency</span>
                      <span className="muted">Last 100 ticks</span>
                    </div>
                    <div className="digit-strip">
                      {percentages.map((pct, digit) => (
                        <button key={digit} className={`digit-ring digit-${digit} ${digit === current.digit ? "current" : ""} ${digit === selectedDigit && needsBarrier ? "chosen" : ""}`} onClick={() => setSelectedDigit(digit)}>
                          <strong>{digit}</strong>
                          <span>{pct}%</span>
                        </button>
                      ))}
                    </div>
                    <div className="cursor-note">
                      <span className="cursor-dot" /> Current tick <b>{current.digit}</b>
                    </div>
                  </div>
                </SwipeCarousel>
              </div>
              <div className="cursor-note desktop-only">
                <span className="cursor-dot" /> Current tick <b>{current.digit}</b>
                <span className="note-divider" />
                {tickStreamStatus === "reconnecting" ? "Reconnecting…" : streamMode === "live" ? `Live ${symbolLabel}` : "Simulated feed"}
                <span className="note-divider" />
                {needsBarrier ? "Click digit to select" : "Select Even/Odd"}
              </div>
            </section>

            {/* ========== TRADE PANEL ========== */}
            <aside className="trade-panel panel">
              <div className="panel-title">
                <div>
                  <p className="eyebrow">TRADE TICKET</p>
                  <h2>Build a contract</h2>
                </div>
                <span className={`account-badge ${isDemo ? "demo" : "real"}`}>
                  {isDemo ? "DEMO" : "REAL"}
                </span>
              </div>

              {/* Contract group tabs */}
              <div className="field-group">
                <label>Contract type</label>
                <div className="contract-tabs">
                  {contractGroups.map((group) => (
                    <button key={group} className={contractGroup === group ? "active" : ""} onClick={() => handleContractGroupChange(group)}>{group}</button>
                  ))}
                </div>
              </div>

              {/* Sub-contract selector */}
              <div className="field-group">
                <label>{needsBarrier ? "Direction" : "Prediction"}</label>
                <div className="sub-contract-tabs">
                  {subOptions.map((opt) => (
                    <button key={opt.value} className={`sub-tab ${subContract === opt.value ? "active" : ""}`} onClick={() => setSubContract(opt.value)}>{opt.label}</button>
                  ))}
                </div>
              </div>

              {/* Prediction / barrier */}
              {needsBarrier && (
                <div className="field-group">
                  <label>Digit prediction</label>
                  <div className="prediction-card">
                    <div>
                      <span className="prediction-label">Last digit</span>
                      <strong>{selectedDigit}</strong>
                    </div>
                    <span className="prediction-arrow"><IconArrowRight size={20} /></span>
                  </div>
                </div>
              )}

              {/* Duration + Stake */}
              <div className="two-fields">
                <div className="field-group">
                  <label>Duration</label>
                  <div className="duration-quick-select">
                    {durationOptions.map((opt) => (
                      <button key={opt.value} className={"duration-btn" + (duration === opt.value ? " active" : "")} onClick={() => setDuration(opt.value)}>{opt.label}</button>
                    ))}
                  </div>
                </div>
                <div className="field-group">
                  <label>Stake ({balanceCurrency})</label>
                  <div className="stake-presets">
                    {["1", "5", "10", "25", "50"].map((amt) => (
                      <button key={amt} className={"stake-preset" + (stake === amt ? " active" : "")} onClick={() => setStake(amt)}>{"$" + amt}</button>
                    ))}
                  </div>
                  <div className="money-input">
                    <span>$</span>
                    <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
              </div>

              {/* Payout card */}
              <div className={`payout-card ${lastError && !proposalLoading && !currentProposal && !proposalRef.current ? "payout-error" : ""}`}>
                <div>
                  <span>Potential payout</span>
                  <strong>
                    {proposalLoading && !proposalRef.current ? "Loading…" : (currentProposal ?? proposalRef.current) ? `$${fmt(potentialPayout)}` : lastError ? "Error" : "—"}
                  </strong>
                </div>
                <div className="payout-rate">
                  {proposalLoading ? "…" : currentProposal ? `+${payoutRate}%` : "—"}
                </div>
              </div>

              {/* Active contract status */}
              {activeContract && (
                <div className="active-contract-banner">
                  <div className="contract-pulse" />
                  <span>
                    Contract active · {activeContract.contract_type} ·{" "}
                    {activeContract.current_tick !== undefined ? `Tick ${activeContract.current_tick}` : "Waiting…"}
                  </span>
                  <button className="sell-button" onClick={() => sell(activeContract.contract_id)}>Sell</button>
                </div>
              )}

              {/* Error */}
              {(tradeError || lastError) && (
                <div className="trade-error" onClick={() => { setTradeError(null); clearError(); }}>
                  {tradeError ?? lastError}
                  <span className="trade-error-dismiss"><IconX size={14} /></span>
                </div>
              )}

              {/* Buy / Sell buttons — sticky on mobile */}
              <div className="trade-actions-sticky">
                {!activeContract ? (
                  <div className="trade-actions">
                    <button
                      className="buy-button"
                      onClick={() => void handlePlaceTrade()}
                      disabled={isBuying || (!currentProposal && !proposalRef.current)}
                    >
                      {isBuying ? "Placing…" : "Buy"}
                      <span><IconArrowUp size={16} /></span>
                    </button>
                    <button className="sell-button-lg" disabled>SELL</button>
                  </div>
                ) : (
                  <div className="trade-actions">
                    <button className="buy-button" disabled>BUY</button>
                    <button
                      className="sell-button-lg active"
                      onClick={() => sell(activeContract.contract_id)}
                    >
                      Sell
                      <span><IconArrowDown size={16} /></span>
                    </button>
                  </div>
                )}
              </div>
              {isDemo && <p className="risk-copy">Demo account · Switch to real for live trading.</p>}
              {!isDemo && <p className="risk-copy real-warning">⚠ Real money trading. Trade responsibly.</p>}

              {/* Quick history */}
              {tradeHistory.length > 0 && (
                <div className="trade-history">
                  <div className="trade-history-header">
                    <span>Recent trades</span>
                    <Link className="view-all-btn" href="/history">View all <IconArrowRight size={12} /></Link>
                  </div>
                  <div className="trade-history-list">
                    {tradeHistory.slice(0, 5).map((t) => (
                      <div key={t.id} className={`trade-row ${t.status}`}>
                        <div className="trade-row-main">
                          <span className="trade-row-type">{formatContractType(t.contract_type)}</span>
                          <span className="trade-row-digit">#{t.digit_prediction}</span>
                        </div>
                        <div className="trade-row-secondary">
                          <span className={`trade-row-status ${t.status}`}>{t.status.toUpperCase()}</span>
                          <span className={`trade-row-profit ${t.profit >= 0 ? "positive" : "negative"}`}>{t.profit >= 0 ? "+" : ""}${fmt(t.profit)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {/* ===== HISTORY TAB ===== */}
      {activeTab === "history" && (
        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">TRADING HISTORY</p>
              <h1>Trade history & reports</h1>
              <p className="muted">Track your performance across all trades.</p>
            </div>
            <Link className="stream-button" href="/">← Back to Workspace</Link>
          </div>
          <TradingHistory accountId={activeAccountId} balanceCurrency={balanceCurrency} fetchTrades={fetchProfitTable ? (opts) => fetchProfitTable(opts) : undefined} />
        </section>
      )}

      {/* ===== BOTS TAB ===== */}
      {activeTab === "bots" && (
        <section className="workspace">
          <BotBuilder
            markets={markets.map((m) => ({ symbol: m.symbol, display_name: m.display_name }))}
            balance={balance}
            balanceCurrency={balanceCurrency}
            botApi={botApi}
            tradingAdapter={{
              propose,
              buy,
              buyBot,
              sell,
              subscribeToContract,
              unsubscribeFromContract,
              getBalance: () => balance,
              isConnected: () => connectionStatus === "connected",
            }}
          />
        </section>
      )}

      {/* ===== ANALYZER TAB ===== */}
      {activeTab === "analyzer" && (
        <section className="workspace">
          <ErrorBoundary name="MarketAnalyzer" fallback={<div style={{ padding: 40, textAlign: "center" }}><IconAlertTriangle size={32} color="#f59e0b" /><h3 style={{ margin: "12px 0 8px" }}>Analyzer Failed to Load</h3><p style={{ color: "var(--muted)", fontSize: 13 }}>The neural network engine encountered an error. Try refreshing the page.</p></div>}>
            <MarketAnalyzerPanel />
          </ErrorBoundary>
        </section>
      )}

      {/* ===== PORTFOLIO TAB ===== */}
      {activeTab === "portfolio" && (
        <section className="workspace">
          <ErrorBoundary name="PortfolioDashboard">
            <PortfolioDashboard accountId={activeAccountId} balance={balance} balanceCurrency={balanceCurrency} fetchPositions={fetchPortfolio} />
          </ErrorBoundary>
        </section>
      )}

      {/* ===== RISK MANAGEMENT TAB ===== */}
      {activeTab === "risk" && (
        <section className="workspace">
          <RiskManagement
            settings={riskSettings}
            onSettingsChange={setRiskSettings}
            riskState={riskState}
            currentStake={parseFloat(stake) || 0}
            balance={balance}
            onResetSession={() => setRiskState(createInitialRiskState())}
            lastResult={lastResult}
          />
        </section>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {activeTab === "settings" && (
        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">SETTINGS</p>
              <h1>Settings</h1>
            </div>
            <Link className="stream-button" href="/">← Back to Workspace</Link>
          </div>
          <div className="settings-panel panel">
            <div className="settings-section">
              <h3>Account</h3>
              <p className="muted">Connected: {activeAccount?.type === "real" ? "Real" : "Demo"} · {activeAccount?.currency ?? "—"}</p>
              <p className="muted">Status: {connectionStatus}</p>
              <p className="muted">Balance: ${balance !== null ? fmt(balance) : '—'} {balanceCurrency}</p>
              <button className="settings-btn" onClick={() => setShowWallet(true)}><IconWallet size={14} /> Open Wallet</button>
            </div>
            <div className="settings-section">
              <h3>Authentication</h3>
              {authenticated ? (
                <div>
                  <p className="muted">Logged in via Deriv OAuth</p>
                  <button className="settings-btn danger" onClick={() => void logout()}><IconLogout size={14} /> Logout</button>
                </div>
              ) : (
                <div>
                  <p className="muted">Login with your Deriv account via OAuth</p>
                  <button className="settings-btn" onClick={() => void login()}><IconLogin size={14} /> Login with Deriv</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===== WALLET PANEL ===== */}
      {showWallet && (
        <ErrorBoundary name="WalletPanel" fallback={<><div className="wallet-panel-overlay" onClick={() => setShowWallet(false)} /><div className="wallet-panel"><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Failed to load wallet. <button onClick={() => setShowWallet(false)} style={{ color: "var(--teal)", background: "none", border: "none", cursor: "pointer" }}>Close</button></div></div></>}>
        <WalletPanel
          activeAccountId={activeAccountId}
          accounts={wsAccounts}
          activeBalance={balance}
          activeCurrency={balanceCurrency}
          onSelectAccount={(account) => {
            void activateAccount({ id: account.id, type: account.type, currency: account.currency, balance: account.balance ?? undefined });
            setShowWallet(false);
          }}
          onClose={() => setShowWallet(false)}
        />
        </ErrorBoundary>
      )}

      {/* ===== NOTIFICATION CENTER ===== */}
      {showNotificationCenter && (
        <NotificationCenter onClose={() => setShowNotificationCenter(false)} />
      )}

      {/* ===== TOAST NOTIFICATIONS ===== */}
      <ToastContainer />

      {/* ===== MOBILE BOTTOM NAV ===== */}
      <nav className="mobile-bottom-nav">
        <Link className={`bottom-nav-item ${activeTab === "workspace" ? "active" : ""}`} href={tabRoutes.workspace}>
          <span className="bottom-nav-icon"><IconChartLine size={20} /></span>
          <span>Trade</span>
        </Link>
        <Link className={`bottom-nav-item ${activeTab === "bots" ? "active" : ""}`} href={tabRoutes.bots}>
          <span className="bottom-nav-icon"><IconRobot size={20} /></span>
          <span>Bots</span>
        </Link>
        <Link className={`bottom-nav-item ${activeTab === "analyzer" ? "active" : ""}`} href={tabRoutes.analyzer}>
          <span className="bottom-nav-icon"><IconBrain size={20} /></span>
          <span>Analyzer</span>
        </Link>
        <Link className={`bottom-nav-item ${activeTab === "portfolio" ? "active" : ""}`} href={tabRoutes.portfolio}>
          <span className="bottom-nav-icon"><IconChartPie size={20} /></span>
          <span>Portfolio</span>
        </Link>
        <Link className={`bottom-nav-item ${activeTab === "history" ? "active" : ""}`} href={tabRoutes.history}>
          <span className="bottom-nav-icon"><IconChartBar size={20} /></span>
          <span>History</span>
          {tradeHistory.length > 0 && <span className="bottom-nav-badge">{tradeHistory.length}</span>}
        </Link>
        <Link className={`bottom-nav-item ${activeTab === "settings" ? "active" : ""}`} href={tabRoutes.settings}>
          <span className="bottom-nav-icon"><IconSettings size={20} /></span>
          <span>Settings</span>
        </Link>
      </nav>

      <footer className="footer">
        <span>© 2026 DTrader</span>
        <span>Responsible trading · Help</span>
      </footer>
    </main>
  );
}

function formatContractType(type: string): string {
  const map: Record<string, string> = {
    DIGITOVER: "Over", DIGITUNDER: "Under", DIGITMATCH: "Match",
    DIGITDIFF: "Differs", DIGITEVEN: "Even", DIGITODD: "Odd",
  };
  return map[type] ?? type;
}
