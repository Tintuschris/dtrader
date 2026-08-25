"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useDerivTrading,
  type Proposal,
  type DerivAccount,
} from "./use-deriv-ws";
import { useAuth } from "./use-auth";
import TradingHistory from "./trading-history";
import SwipeCarousel from "./swipe-carousel";
import BotBuilder from "./bot-builder";
import { useBot } from "./use-bot";

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

type ActiveTab = "workspace" | "history" | "bots" | "settings";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TradingTerminal() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("workspace");
  const [symbol, setSymbol] = useState("1HZ100V");
  const [contractGroup, setContractGroup] = useState<ContractGroup>(contractGroups[0]);
  const [subContract, setSubContract] = useState<SubContract>("over");
  const [stake, setStake] = useState("10.00");
  const [ticks, setTicks] = useState<Tick[]>(initialTicks);
  const [running, setRunning] = useState(true);
  const [selectedDigit, setSelectedDigit] = useState(4);
  const [streamMode, setStreamMode] = useState<"live" | "simulated">("simulated");
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [accountStatus, setAccountStatus] = useState("Connecting to Deriv…");
  const [duration, setDuration] = useState(5);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);

  const tickStreamWs = useRef<WebSocket | null>(null);
  const proposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    connectionStatus,
    balance,
    balanceCurrency,
    activeContract,
    currentProposal,
    proposalLoading,
    lastResult,
    lastError,
    tradeHistory,
    connect: connectTrading,
    propose,
    buy,
    buyBot,
    sell,
    subscribeToContract,
    unsubscribeFromContract,
    refreshBalance,
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
      void activateAccount(preferred);
    }
  }, [authLoading, authAccounts]);

  /* ---- activate account ---- */
  const activateAccount = useCallback(
    async (account: DerivAccount) => {
      setAccountStatus(`Opening ${account.type} session…`);
      try {
        await connectTrading(account.id);
        setActiveAccountId(account.id);
        setAccountStatus(`${account.type === "real" ? "Real" : "Demo"} account connected`);
      } catch {
        setAccountStatus("Account connection failed");
      }
    },
    [connectTrading],
  );

  /* ---- load accounts ---- */
  const loadAccounts = useCallback(async () => {
    if (authAccounts.length > 0) {
      setAccounts(authAccounts);
      const preferred = authAccounts.find((a) => a.type === "demo") ?? authAccounts[0];
      await activateAccount(preferred);
      return;
    }
    try {
      const response = await fetch("/api/deriv/accounts", { cache: "no-store" });
      const data = (await response.json()) as { accounts?: DerivAccount[] };
      if (!response.ok || !data.accounts?.length) throw new Error("No accounts available");
      setAccounts(data.accounts);
      const preferred = data.accounts.find((a) => a.type === "demo") ?? data.accounts[0];
      await activateAccount(preferred);
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

  /* ---- tick stream (public WebSocket) ---- */
  useEffect(() => {
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
      tickStreamWs.current = ws;
      ws.onopen = () => ws?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          history?: { prices?: Array<number | string>; pip_size?: number };
          tick?: { quote?: number | string; pip_size?: number };
        };
        if (message.history?.prices?.length) {
          const pipSize = message.history.pip_size ?? 2;
          setTicks(message.history.prices.slice(-100).map((price) => ({ value: Number(price), digit: digitFromQuote(price, pipSize) })));
          setStreamMode("live");
        }
        if (message.tick?.quote !== undefined) {
          const pipSize = message.tick.pip_size ?? 2;
          setTicks((prev) => [...prev.slice(-99), { value: Number(message.tick?.quote), digit: digitFromQuote(message.tick?.quote ?? 0, pipSize) }]);
          setStreamMode("live");
        }
      };
      ws.onerror = () => setStreamMode("simulated");
    } catch {
      setStreamMode("simulated");
    }
    return () => { ws?.close(); tickStreamWs.current = null; };
  }, [symbol]);

  /* ---- simulated ticks ---- */
  useEffect(() => {
    if (!running || streamMode === "live") return;
    const timer = window.setInterval(() => {
      setTicks((current) => [...current.slice(-55), makeTick(current.at(-1)?.value ?? 644.52)]);
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

  /* ---- auto-refresh proposal (paused when not on workspace tab) ---- */
  useEffect(() => {
    if (proposeTimer.current) clearTimeout(proposeTimer.current);
    if (activeTab !== "workspace") return; // Don't fire proposals when bot/other tabs are active
    setTradeError(null);
    clearError();
    if (connectionStatus !== "connected") return;
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) return;
    proposeTimer.current = setTimeout(() => {
      void propose({
        contract_type: subToApiType(subContract),
        symbol,
        amount: stakeNum,
        currency: balanceCurrency,
        duration_ticks: duration,
        barrier: subNeedsBarrier(subContract) ? String(selectedDigit) : undefined,
      });
    }, 150);
    return () => { if (proposeTimer.current) clearTimeout(proposeTimer.current); };
  }, [subContract, symbol, stake, duration, selectedDigit, connectionStatus, balanceCurrency, propose, clearError, activeTab]);

  /* ---- handle contract group change ---- */
  const handleContractGroupChange = useCallback((group: ContractGroup) => {
    setContractGroup(group);
    setSubContract(subContracts[group][0].value);
  }, []);

  /* ---- place trade ---- */
  const [isBuying, setIsBuying] = useState(false);
  const handlePlaceTrade = useCallback(async () => {
    if (!currentProposal) { setTradeError("No active proposal. Wait for pricing."); return; }
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) { setTradeError("Enter a valid stake amount."); return; }
    if (activeContract) { setTradeError("You already have an active contract. Wait for it to settle."); return; }
    setIsBuying(true);
    setTradeError(null);
    clearLastResult();
    try {
      const result = await buy(currentProposal.id, stakeNum);
      if (!result) setTradeError("Buy request failed. Try again.");
    } catch (e) {
      setTradeError(`Trade failed: ${String(e)}`);
    } finally {
      setIsBuying(false);
    }
  }, [currentProposal, stake, activeContract, buy, clearLastResult]);

  /* ---- derived ---- */
  const current = ticks.at(-1) ?? { value: 644.52, digit: 2 };
  const symbolLabel = markets.find((m) => m.symbol === symbol)?.display_name ?? (markets[0]?.display_name ?? symbol);
  const percentages = useMemo(() => {
    const counts = Array.from({ length: 10 }, () => 2);
    for (const tick of ticks) counts[tick.digit] += 1;
    const total = counts.reduce((sum, c) => sum + c, 0);
    return counts.map((c) => Number(((c / total) * 100).toFixed(1)));
  }, [ticks]);

  /* ---- chart auto-scaling ---- */
  const chartRange = useMemo(() => {
    if (ticks.length === 0) return { min: 640, max: 650, padding: 5 };
    const values = ticks.map((t) => t.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = range * 0.15;
    return { min: min - padding, max: max + padding, padding };
  }, [ticks]);

  const chartY = useCallback((value: number) => {
    const range = chartRange.max - chartRange.min || 1;
    return 30 + ((chartRange.max - value) / range) * 280;
  }, [chartRange]);

  const stakeNum = parseFloat(stake) || 0;
  const potentialPayout = currentProposal?.payout ?? 0;
  const askPrice = currentProposal?.ask_price ?? 0;
  const potentialProfit = potentialPayout > 0 && askPrice > 0 ? potentialPayout - askPrice : currentProposal?.profit ?? 0;
  const payoutRate = stakeNum > 0 ? ((potentialProfit / stakeNum) * 100).toFixed(1) : "0.0";
  const subOptions = subContracts[contractGroup];
  const needsBarrier = subNeedsBarrier(subContract);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
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
            <button className={`nav-link ${activeTab === "workspace" ? "active" : ""}`} onClick={() => setActiveTab("workspace")}>Workspace</button>
            <button className={`nav-link ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")}>
              History
              {tradeHistory.length > 0 && <span className="nav-badge">{tradeHistory.length}</span>}
            </button>
            <button className={`nav-link ${activeTab === "bots" ? "active" : ""}`} onClick={() => setActiveTab("bots")}>Bots</button>
          </nav>
        </div>
        <div className="topbar-right">
          {balance !== null && (
            <div className="balance-pill">
              <span className="balance-amount">${fmt(balance)}</span>
              <span className="balance-currency">{balanceCurrency}</span>
            </div>
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
          {authenticated ? (
            <div className="user-menu-wrap">
              <button className="avatar-btn" onClick={() => setShowUserMenu((v) => !v)}>
                {activeAccount?.type === "real" ? "R" : "D"}
              </button>
              {showUserMenu && (
                <div className="user-menu" onClick={() => setShowUserMenu(false)}>
                  <div className="user-menu-header">
                    {activeAccount?.type === "real" ? "Real" : "Demo"} Account
                  </div>
                  <button className="user-menu-item" onClick={() => void logout()}>Logout</button>
                </div>
              )}
            </div>
          ) : (
            <button className="login-btn" onClick={() => void login()} disabled={authLoading}>
              {authLoading ? "…" : "Login"}
            </button>
          )}
          <button className="mobile-menu-btn" onClick={() => setShowMobileMenu((v) => !v)} aria-label="Menu">☰</button>
        </div>
      </header>

      {/* ===== MOBILE MENU ===== */}
      {showMobileMenu && (
        <div className="mobile-menu-overlay" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span className="brand-mark">D</span>
              <span>DTrader</span>
              <button className="mobile-menu-close" onClick={() => setShowMobileMenu(false)}>✕</button>
            </div>
            {balance !== null && (
              <div className="mobile-menu-balance">${fmt(balance)} {balanceCurrency}</div>
            )}
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
              <button className={activeTab === "workspace" ? "active" : ""} onClick={() => { setActiveTab("workspace"); setShowMobileMenu(false); }}>Workspace</button>
              <button className={activeTab === "history" ? "active" : ""} onClick={() => { setActiveTab("history"); setShowMobileMenu(false); }}>History</button>
              <button className={activeTab === "settings" ? "active" : ""} onClick={() => { setActiveTab("settings"); setShowMobileMenu(false); }}>Settings</button>
            </div>
            <div className="mobile-menu-footer">
              {authenticated ? (
                <button className="mobile-logout-btn" onClick={() => { void logout(); setShowMobileMenu(false); }}>Logout</button>
              ) : (
                <button className="mobile-login-btn" onClick={() => { void login(); setShowMobileMenu(false); }}>Login with Deriv</button>
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
                <span className="live-badge"><i /> LIVE TICKS</span>
                {!isDemo && <span className="real-badge">REAL MONEY</span>}
              </p>
              <h1>Last digit trading</h1>
              <p className="muted">Read the final digit, choose a contract, and place a trade.</p>
            </div>
            <button className={`stream-button ${running ? "streaming" : ""}`} onClick={() => setRunning((v) => !v)}>
              <span /> {running ? "Streaming" : "Paused"}
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
                    <span className={`market-chevron ${showMarketPicker ? "open" : ""}`}>⌄</span>
                  </button>
                  {showMarketPicker && (
                    <div className="market-dropdown">
                      <div className="market-dropdown-header">
                        <span>Select market <span className="market-count">{markets.length}</span></span>
                        <div className="market-dropdown-actions">
                          <button className="market-refresh-btn" onClick={async () => { const res = await fetch("/api/deriv/markets?refresh=1"); const data = await res.json(); if (data.markets?.length) setMarkets(data.markets); }} title="Refresh markets">↻</button>
                          <button className="market-dropdown-close" onClick={() => setShowMarketPicker(false)}>✕</button>
                        </div>
                      </div>
                      {Object.entries(
                        markets.reduce((acc, m) => {
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
                              onClick={() => { setSymbol(m.symbol); setShowMarketPicker(false); }}
                            >
                              <span className="market-option-name">{m.display_name}</span>
                              <span className="market-option-symbol">{m.symbol}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="icon-button mobile-hide" aria-label="Chart settings">⚙</button>
              </div>
              <div className="price-row">
                <div>
                  <span className="price">{fmt(current.value)}</span>
                  <span className="price-change">+0.24 <b>▲ 0.04%</b></span>
                </div>
                <div className="last-digit">
                  <span>LAST DIGIT</span>
                  <strong>{current.digit}</strong>
                </div>
              </div>
              {/* Desktop: show both, Mobile: carousel */}
              <div className="chart-section-desktop">
                <div className="chart-wrap">
                  <div className="chart-gridlines" />
                  <svg className="chart" viewBox="0 0 900 360" preserveAspectRatio="none" aria-label="Live price chart" role="img">
                    <defs>
                      <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#37d4bd" stopOpacity=".22" />
                        <stop offset="100%" stopColor="#37d4bd" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={`M 0 ${chartY(ticks[0]?.value ?? current.value)} ${ticks.map((t, i) => `L ${(i / Math.max(ticks.length - 1, 1)) * 900} ${chartY(t.value)}`).join(" ")} L 900 360 L 0 360 Z`} fill="url(#area)" />
                    <path d={`M 0 ${chartY(ticks[0]?.value ?? current.value)} ${ticks.map((t, i) => `L ${(i / Math.max(ticks.length - 1, 1)) * 900} ${chartY(t.value)}`).join(" ")}`} fill="none" stroke="#43d6c1" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                    <line x1="870" y1="0" x2="870" y2="360" stroke="#b9a1ff" strokeDasharray="5 5" opacity=".8" />
                    <circle cx="870" cy={chartY(current.value)} r="7" fill="#b9a1ff" stroke="#fff" strokeWidth="2" />
                    {/* Bot trade markers */}
                    {activeContract && (
                      <>
                        {activeContract.entry_tick != null && (
                          <g>
                            <circle cx={870} cy={chartY(activeContract.entry_tick)} r="5" fill="#f0c040" stroke="#0b1420" strokeWidth="2" />
                            <text x={860} y={chartY(activeContract.entry_tick) - 10} textAnchor="end" fill="#f0c040" fontSize="10" fontWeight="bold">ENTRY</text>
                          </g>
                        )}
                        {activeContract.barrier && (
                          <line x1="0" y1={chartY(Number(activeContract.barrier))} x2="900" y2={chartY(Number(activeContract.barrier))} stroke="#f08080" strokeDasharray="4 4" strokeWidth="1.5" opacity=".6" />
                        )}
                      </>
                    )}
                  </svg>
                  <div className="crosshair-label" style={{ top: `${Math.max(5, Math.min(90, (chartY(current.value) / 310) * 100))}%` }}>{fmt(current.value)}</div>
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
                    <div className="chart-gridlines" />
                    <svg className="chart" viewBox="0 0 900 360" preserveAspectRatio="none" aria-label="Live price chart" role="img">
                      <defs>
                        <linearGradient id="area-m" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#37d4bd" stopOpacity=".22" />
                          <stop offset="100%" stopColor="#37d4bd" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={`M 0 ${chartY(ticks[0]?.value ?? current.value)} ${ticks.map((t, i) => `L ${(i / Math.max(ticks.length - 1, 1)) * 900} ${chartY(t.value)}`).join(" ")} L 900 360 L 0 360 Z`} fill="url(#area-m)" />
                      <path d={`M 0 ${chartY(ticks[0]?.value ?? current.value)} ${ticks.map((t, i) => `L ${(i / Math.max(ticks.length - 1, 1)) * 900} ${chartY(t.value)}`).join(" ")}`} fill="none" stroke="#43d6c1" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                      <line x1="870" y1="0" x2="870" y2="360" stroke="#b9a1ff" strokeDasharray="5 5" opacity=".8" />
                      <circle cx="870" cy={chartY(current.value)} r="7" fill="#b9a1ff" stroke="#fff" strokeWidth="2" />
                    </svg>
                    <div className="crosshair-label" style={{ top: `${Math.max(5, Math.min(90, (chartY(current.value) / 310) * 100))}%` }}>{fmt(current.value)}</div>
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
                {streamMode === "live" ? `Live ${symbolLabel}` : "Simulated feed"}
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
                    <span className="prediction-arrow">→</span>
                  </div>
                </div>
              )}

              {/* Duration + Stake */}
              <div className="two-fields">
                <div className="field-group">
                  <label>Duration</label>
                  <div className="duration-picker-wrap">
                    <button className="input-button" onClick={() => setShowDurationPicker((v) => !v)}>
                      {durationOptions.find((d) => d.value === duration)?.label ?? `${duration} ticks`}
                      <span>⌄</span>
                    </button>
                    {showDurationPicker && (
                      <div className="duration-dropdown">
                        {durationOptions.map((opt) => (
                          <button key={opt.value} className={duration === opt.value ? "active" : ""} onClick={() => { setDuration(opt.value); setShowDurationPicker(false); }}>{opt.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="field-group">
                  <label>Stake ({balanceCurrency})</label>
                  <div className="money-input">
                    <span>$</span>
                    <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
              </div>

              {/* Payout card */}
              <div className={`payout-card ${lastError && !proposalLoading && !currentProposal ? "payout-error" : ""}`}>
                <div>
                  <span>Potential payout</span>
                  <strong>
                    {proposalLoading ? "Loading…" : currentProposal ? `$${fmt(potentialPayout)}` : lastError ? "Error" : "—"}
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
                  <span className="trade-error-dismiss">✕</span>
                </div>
              )}

              {/* Buy / Sell buttons — sticky on mobile */}
              <div className="trade-actions-sticky">
                {!activeContract ? (
                  <div className="trade-actions">
                    <button
                      className="buy-button"
                      onClick={() => void handlePlaceTrade()}
                      disabled={isBuying || !currentProposal}
                    >
                      {isBuying ? "Placing…" : "Buy"}
                      <span>↑</span>
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
                      <span>↓</span>
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
                    <button className="view-all-btn" onClick={() => setActiveTab("history")}>View all →</button>
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
            <button className="stream-button" onClick={() => setActiveTab("workspace")}>← Back to Workspace</button>
          </div>
          <TradingHistory trades={tradeHistory} balance={balance} balanceCurrency={balanceCurrency} />
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
          </div>
          <div className="settings-panel panel">
            <div className="settings-section">
              <h3>Account</h3>
              <p className="muted">Connected: {activeAccount?.type === "real" ? "Real" : "Demo"} · {activeAccount?.currency ?? "—"}</p>
              <p className="muted">Status: {connectionStatus}</p>
            </div>
            <div className="settings-section">
              <h3>Authentication</h3>
              {authenticated ? (
                <div>
                  <p className="muted">Logged in via Deriv OAuth</p>
                  <button className="settings-btn danger" onClick={() => void logout()}>Logout</button>
                </div>
              ) : (
                <div>
                  <p className="muted">Login with your Deriv account via OAuth</p>
                  <button className="settings-btn" onClick={() => void login()}>Login with Deriv</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===== MOBILE BOTTOM NAV ===== */}
      <nav className="mobile-bottom-nav">
        <button className={`bottom-nav-item ${activeTab === "workspace" ? "active" : ""}`} onClick={() => setActiveTab("workspace")}>
          <span className="bottom-nav-icon">📈</span>
          <span>Trade</span>
        </button>
        <button className={`bottom-nav-item ${activeTab === "bots" ? "active" : ""}`} onClick={() => setActiveTab("bots")}>
          <span className="bottom-nav-icon">🤖</span>
          <span>Bots</span>
        </button>
        <button className={`bottom-nav-item ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")}>
          <span className="bottom-nav-icon">📊</span>
          <span>History</span>
          {tradeHistory.length > 0 && <span className="bottom-nav-badge">{tradeHistory.length}</span>}
        </button>
        <button className={`bottom-nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
          <span className="bottom-nav-icon">⚙</span>
          <span>Settings</span>
        </button>
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
