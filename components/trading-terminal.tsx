"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useDerivTrading,
  type Proposal,
  type DerivAccount,
} from "./use-deriv-ws";
import { useAuth } from "./use-auth";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const symbols = [
  { label: "Volatility 100 (1s) Index", id: "1HZ100V" },
  { label: "Volatility 75 (1s) Index", id: "1HZ75V" },
  { label: "Boom 500 Index", id: "BOOM500" },
];

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

function fmt(n: number) {
  return n.toFixed(2);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TradingTerminal() {
  const [isMounted, setIsMounted] = useState(false);
  const [symbol, setSymbol] = useState(symbols[0].id);
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
    tradeHistory,
    connect: connectTrading,
    propose,
    buy,
    sell,
    clearLastResult,
  } = useDerivTrading();

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

  /* ---- sync auth accounts into local state ---- */
  useEffect(() => {
    if (!authLoading && authAccounts.length > 0 && accounts.length === 0) {
      setAccounts(authAccounts);
      const preferred = authAccounts.find((a) => a.type === "demo") ?? authAccounts[0];
      void activateAccount(preferred);
    }
  }, [authLoading, authAccounts]);

  /* ---- load accounts ---- */
  const activateAccount = useCallback(
    async (account: DerivAccount) => {
      setAccountStatus(`Opening ${account.type} session…`);
      try {
        await connectTrading(account.id);
        setActiveAccountId(account.id);
        setAccountStatus(
          `${account.type === "real" ? "Real" : "Demo"} account connected`,
        );
      } catch {
        setAccountStatus("Account connection failed");
      }
    },
    [connectTrading],
  );

  const loadAccounts = useCallback(async () => {
    // If auth hook already has accounts, use those
    if (authAccounts.length > 0) {
      setAccounts(authAccounts);
      const preferred = authAccounts.find((a) => a.type === "demo") ?? authAccounts[0];
      await activateAccount(preferred);
      return;
    }
    // Otherwise try fetching from the API (PAT fallback)
    try {
      const response = await fetch("/api/deriv/accounts", { cache: "no-store" });
      const data = (await response.json()) as { accounts?: DerivAccount[] };
      if (!response.ok || !data.accounts?.length) throw new Error("No accounts available");
      setAccounts(data.accounts);
      const preferred =
        data.accounts.find((a) => a.type === "demo") ?? data.accounts[0];
      await activateAccount(preferred);
    } catch {
      setAccountStatus("Deriv account unavailable");
      // Still try public tick stream
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
      ws = new WebSocket(
        "wss://api.derivws.com/trading/v1/options/ws/public",
      );
      tickStreamWs.current = ws;
      ws.onopen = () =>
        ws?.send(
          JSON.stringify({
            ticks: symbol,
            subscribe: 1,
          }),
        );
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          history?: { prices?: Array<number | string>; pip_size?: number };
          tick?: { quote?: number | string; pip_size?: number };
        };
        if (message.history?.prices?.length) {
          const pipSize = message.history.pip_size ?? 2;
          setTicks(
            message.history.prices.slice(-100).map((price) => ({
              value: Number(price),
              digit: digitFromQuote(price, pipSize),
            })),
          );
          setStreamMode("live");
        }
        if (message.tick?.quote !== undefined) {
          const pipSize = message.tick.pip_size ?? 2;
          setTicks((prev) => [
            ...prev.slice(-99),
            {
              value: Number(message.tick?.quote),
              digit: digitFromQuote(message.tick?.quote ?? 0, pipSize),
            },
          ]);
          setStreamMode("live");
        }
      };
      ws.onerror = () => setStreamMode("simulated");
    } catch {
      setStreamMode("simulated");
    }
    return () => {
      ws?.close();
      tickStreamWs.current = null;
    };
  }, [symbol]);

  /* ---- simulated ticks ---- */
  useEffect(() => {
    if (!running || streamMode === "live") return;
    const timer = window.setInterval(() => {
      setTicks((current) => [
        ...current.slice(-55),
        makeTick(current.at(-1)?.value ?? 644.52),
      ]);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [running, streamMode]);

  /* ---- auto-refresh proposal when inputs change ---- */
  useEffect(() => {
    if (proposeTimer.current) clearTimeout(proposeTimer.current);
    setTradeError(null);

    // Don't propose if no trading WS or no valid account
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
    }, 300);

    return () => {
      if (proposeTimer.current) clearTimeout(proposeTimer.current);
    };
  }, [subContract, symbol, stake, duration, selectedDigit, connectionStatus, balanceCurrency, propose]);

  /* ---- handle contract group change → reset sub-contract ---- */
  const handleContractGroupChange = useCallback((group: ContractGroup) => {
    setContractGroup(group);
    const subs = subContracts[group];
    setSubContract(subs[0].value);
  }, []);

  /* ---- place trade ---- */
  const [isBuying, setIsBuying] = useState(false);
  const handlePlaceTrade = useCallback(async () => {
    if (!currentProposal) {
      setTradeError("No active proposal. Wait for pricing.");
      return;
    }
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) {
      setTradeError("Enter a valid stake amount.");
      return;
    }
    if (activeContract) {
      setTradeError("You already have an active contract. Wait for it to settle.");
      return;
    }
    setIsBuying(true);
    setTradeError(null);
    clearLastResult();
    try {
      const result = await buy(currentProposal.id, stakeNum);
      if (!result) {
        setTradeError("Buy request failed. Try again.");
      }
    } catch (e) {
      setTradeError(`Trade failed: ${String(e)}`);
    } finally {
      setIsBuying(false);
    }
  }, [currentProposal, stake, activeContract, buy, clearLastResult]);

  /* ---- derived ---- */
  const current = ticks.at(-1) ?? { value: 644.52, digit: 2 };
  const symbolLabel =
    symbols.find((s) => s.id === symbol)?.label ?? symbols[0].label;

  const percentages = useMemo(() => {
    const counts = Array.from({ length: 10 }, () => 2);
    for (const tick of ticks) counts[tick.digit] += 1;
    const total = counts.reduce((sum, c) => sum + c, 0);
    return counts.map((c) => Number(((c / total) * 100).toFixed(1)));
  }, [ticks]);

  const stakeNum = parseFloat(stake) || 0;
  const potentialPayout = currentProposal?.payout ?? 0;
  const potentialProfit = currentProposal?.profit ?? 0;
  const payoutRate = stakeNum > 0 ? ((potentialProfit / stakeNum) * 100).toFixed(1) : "0.0";

  const subOptions = subContracts[contractGroup];
  const needsBarrier = subNeedsBarrier(subContract);

  /* ---- loading gate ---- */
  if (!isMounted) {
    return <main className="app-shell terminal-loading">Preparing trading workspace…</main>;
  }

  /* ---- result overlay ---- */
  const resultOverlay = lastResult ? (
    <div
      className={`result-overlay ${lastResult.status === "won" ? "won" : "lost"}`}
      onClick={clearLastResult}
    >
      <div className="result-card" onClick={(e) => e.stopPropagation()}>
        <div className={`result-badge ${lastResult.status}`}>
          {lastResult.status === "won" ? "✓ WIN" : lastResult.status === "lost" ? "✗ LOSS" : lastResult.status.toUpperCase()}
        </div>
        <div className="result-profit">
          {lastResult.profit >= 0 ? "+" : ""}${fmt(lastResult.profit)}
        </div>
        <div className="result-detail">
          Stake: ${fmt(lastResult.buy_price)} · Payout: ${fmt(lastResult.payout)}
        </div>
        <button className="result-dismiss" onClick={clearLastResult}>
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  return (
    <main className="app-shell">
      {resultOverlay}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <span>DTrader</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#workspace">Workspace</a>
          <a className="nav-link" href="#bots">Bot Builder</a>
          <a className="nav-link" href="#academy">Academy</a>
        </nav>
        <div className="account-area">
          {balance !== null && (
            <span className="balance-pill">
              ${fmt(balance)} <span className="balance-currency">{balanceCurrency}</span>
            </span>
          )}
          {accounts.length > 0 ? (
            <label className="account-switcher">
              <span className="status-dot" />
              <select
                value={activeAccountId}
                onChange={(e) => {
                  const account = accounts.find((a) => a.id === e.target.value);
                  if (account) void activateAccount(account);
                }}
              >
                <option value="" disabled>Select account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type === "real" ? "Real" : "Demo"} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <button className="connect-button" onClick={() => void loadAccounts()}>
              Connect Deriv
            </button>
          )}
          <span className="connection-state" title={accountStatus}>
            <span className={`ws-dot ${connectionStatus}`} />
            {connectionStatus === "connected" ? accountStatus : connectionStatus}
          </span>
          {authenticated ? (
            <div className="user-menu-wrap">
              <button className="avatar" onClick={() => setShowUserMenu((v) => !v)}>U</button>
              {showUserMenu && (
                <div className="user-menu">
                  <div className="user-menu-header">Logged in via Deriv</div>
                  <button className="user-menu-item" onClick={() => { void logout(); setShowUserMenu(false); }}>
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="login-button" onClick={() => void login()} disabled={authLoading}>
              {authLoading ? "Checking…" : "Login with Deriv"}
            </button>
          )}
          <button className="menu-button" aria-label="Open menu">☰</button>
          {authError && <span className="auth-error" title={authError}>⚠</span>}
        </div>
      </header>

      <section className="workspace" id="workspace">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">
              OPTIONS WORKSPACE{" "}
              <span className="live-badge">
                <i /> LIVE TICKS
              </span>
            </p>
            <h1>Last digit trading</h1>
            <p className="muted">
              Read the final digit, choose a contract, and place a controlled demo trade.
            </p>
          </div>
          <button
            className={`stream-button ${running ? "streaming" : ""}`}
            onClick={() => setRunning((v) => !v)}
          >
            <span /> {running ? "Streaming" : "Paused"}
          </button>
        </div>

        <div className="terminal-grid">
          {/* ========== MARKET CARD ========== */}
          <section className="market-card panel">
            <div className="market-toolbar">
              <label className="select-wrap">
                <span className="asset-icon">✦</span>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {symbols.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <span className="chevron">⌄</span>
              </label>
              <div className="timeframes">
                <button className="selected">1m</button>
                <button>5m</button>
                <button>15m</button>
                <button>1h</button>
              </div>
              <button className="icon-button" aria-label="Chart settings">⚙</button>
            </div>
            <div className="price-row">
              <div>
                <span className="price">{fmt(current.value)}</span>
                <span className="price-change">
                  +0.24 <b>▲ 0.04%</b>
                </span>
              </div>
              <div className="last-digit">
                <span>LAST DIGIT</span>
                <strong>{current.digit}</strong>
              </div>
            </div>
            <div className="chart-wrap">
              <div className="chart-gridlines" />
              <svg
                className="chart"
                viewBox="0 0 900 360"
                preserveAspectRatio="none"
                aria-label="Live price chart"
                role="img"
              >
                <defs>
                  <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#37d4bd" stopOpacity=".22" />
                    <stop offset="100%" stopColor="#37d4bd" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d={`M 0 ${220 - ((ticks[0]?.value ?? 644) % 4) * 12} ${ticks.map((t, i) => `L ${(i / Math.max(ticks.length - 1, 1)) * 900} ${220 - (t.value - 643) * 34}`).join(" ")} L 900 360 L 0 360 Z`}
                  fill="url(#area)"
                />
                <path
                  d={`M 0 ${220 - ((ticks[0]?.value ?? 644) % 4) * 12} ${ticks.map((t, i) => `L ${(i / Math.max(ticks.length - 1, 1)) * 900} ${220 - (t.value - 643) * 34}`).join(" ")}`}
                  fill="none"
                  stroke="#43d6c1"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1="870" y1="0" x2="870" y2="360"
                  stroke="#b9a1ff" strokeDasharray="5 5" opacity=".8"
                />
                <circle
                  cx="870"
                  cy={220 - (current.value - 643) * 34}
                  r="7" fill="#b9a1ff" stroke="#fff" strokeWidth="2"
                />
              </svg>
              <div
                className="crosshair-label"
                style={{
                  top: `${Math.max(18, Math.min(78, 50 - (current.value - 644) * 20))}%`,
                }}
              >
                {fmt(current.value)}
              </div>
              <div className="chart-axis">
                <span>12:00</span>
                <span>12:15</span>
                <span>12:30</span>
                <span>12:45</span>
                <span>13:00</span>
              </div>
            </div>
            <div className="digit-strip-heading">
              <span>Digit frequency</span>
              <span className="muted">Moving average · last 100 ticks</span>
            </div>
            <div className="digit-strip">
              {percentages.map((pct, digit) => (
                <button
                  key={digit}
                  className={`digit-ring digit-${digit} ${digit === current.digit ? "current" : ""} ${digit === selectedDigit && needsBarrier ? "chosen" : ""}`}
                  onClick={() => setSelectedDigit(digit)}
                >
                  <strong>{digit}</strong>
                  <span>{pct}%</span>
                </button>
              ))}
            </div>
            <div className="cursor-note">
              <span className="cursor-dot" /> Current tick <b>{current.digit}</b>
              <span className="note-divider" />
              {streamMode === "live"
                ? `Live ${symbolLabel} feed`
                : "Simulated feed · reconnecting to Deriv"}
              <span className="note-divider" />
              {needsBarrier ? "Click a digit to select it" : "Select Even/Odd above"}
            </div>
          </section>

          {/* ========== TRADE PANEL ========== */}
          <aside className="trade-panel panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">TRADE TICKET</p>
                <h2>Build a contract</h2>
              </div>
              <span className={`secure ${connectionStatus}`}>
                ● {connectionStatus === "connected"
                  ? (accounts.find((a) => a.id === activeAccountId)?.type.toUpperCase() ?? "CONNECTED")
                  : connectionStatus.toUpperCase()}
              </span>
            </div>

            {/* Contract group tabs */}
            <div className="field-group">
              <label>Contract type</label>
              <div className="contract-tabs">
                {contractGroups.map((group) => (
                  <button
                    key={group}
                    className={contractGroup === group ? "active" : ""}
                    onClick={() => handleContractGroupChange(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-contract selector */}
            <div className="field-group">
              <label>{contractGroup === "Over / Under" ? "Direction" : contractGroup === "Matches / Differs" ? "Direction" : "Prediction"}</label>
              <div className="sub-contract-tabs">
                {subOptions.map((opt) => (
                  <button
                    key={opt.value}
                    className={`sub-tab ${subContract === opt.value ? "active" : ""}`}
                    onClick={() => setSubContract(opt.value)}
                  >
                    {opt.label}
                  </button>
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
                  <button
                    className="input-button"
                    onClick={() => setShowDurationPicker((v) => !v)}
                  >
                    {durationOptions.find((d) => d.value === duration)?.label ?? `${duration} ticks`}
                    <span>⌄</span>
                  </button>
                  {showDurationPicker && (
                    <div className="duration-dropdown">
                      {durationOptions.map((opt) => (
                        <button
                          key={opt.value}
                          className={duration === opt.value ? "active" : ""}
                          onClick={() => {
                            setDuration(opt.value);
                            setShowDurationPicker(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="field-group">
                <label>Stake (USD)</label>
                <div className="money-input">
                  <span>$</span>
                  <input
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            {/* Payout card */}
            <div className="payout-card">
              <div>
                <span>Potential payout</span>
                <strong>
                  {proposalLoading
                    ? "Loading…"
                    : currentProposal
                      ? `$${fmt(potentialPayout)}`
                      : "—"}
                </strong>
              </div>
              <div className="payout-rate">
                {proposalLoading
                  ? "…"
                  : currentProposal
                    ? `+${payoutRate}%`
                    : "—"}
              </div>
            </div>

            {/* Active contract status */}
            {activeContract && (
              <div className="active-contract-banner">
                <div className="contract-pulse" />
                <span>
                  Contract active · {activeContract.contract_type} ·{" "}
                  {activeContract.current_tick !== undefined
                    ? `Tick ${activeContract.current_tick}`
                    : "Waiting…"}
                </span>
                <button
                  className="sell-button"
                  onClick={() => sell(activeContract.contract_id)}
                >
                  Sell
                </button>
              </div>
            )}

            {/* Error message */}
            {tradeError && <div className="trade-error">{tradeError}</div>}

            {/* Buy button */}
            <button
              className="buy-button"
              onClick={() => void handlePlaceTrade()}
              disabled={isBuying || !currentProposal || !!activeContract}
            >
              {isBuying
                ? "Placing trade…"
                : activeContract
                  ? "Contract in progress"
                  : "Place demo trade"}
              <span>→</span>
            </button>
            <p className="risk-copy">
              Demo trading only. Real-money trading will be enabled after Deriv OAuth and risk
              controls are connected.
            </p>

            {/* Trade history */}
            {tradeHistory.length > 0 && (
              <div className="trade-history">
                <div className="trade-history-header">
                  <span>Recent trades</span>
                  <span className="muted">{tradeHistory.length}</span>
                </div>
                <div className="trade-history-list">
                  {tradeHistory.map((t) => (
                    <div
                      key={t.id}
                      className={`trade-row ${t.status}`}
                    >
                      <div className="trade-row-main">
                        <span className="trade-row-type">{t.contract_type}</span>
                        <span className="trade-row-digit">#{t.digit_prediction}</span>
                      </div>
                      <div className="trade-row-secondary">
                        <span className={`trade-row-status ${t.status}`}>
                          {t.status.toUpperCase()}
                        </span>
                        <span className={`trade-row-profit ${t.profit >= 0 ? "positive" : "negative"}`}>
                          {t.profit >= 0 ? "+" : ""}${fmt(t.profit)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>

      <footer className="footer">
        <span>© 2026 DTrader</span>
        <span>Market data is simulated for this prototype</span>
        <span>Responsible trading · Help</span>
      </footer>
    </main>
  );
}
