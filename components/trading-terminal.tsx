"use client";

import { useEffect, useMemo, useCallback, useState } from "react";
import Link from "next/link";
import {
  IconSettings, IconMenu2, IconX, IconRefresh, IconChevronDown,
  IconArrowUp, IconArrowDown, IconArrowRight, IconChartLine,
  IconRobot, IconChartBar, IconLogout, IconLogin, IconInfoCircle,
  IconSwitch2, IconAlertTriangle, IconCurrencyDollar, IconUser, IconBrain, IconWallet,
  IconBell, IconChartPie, IconShield,
} from "@tabler/icons-react";
import { TradingProvider, useTrading, fmt, contractGroups, durationOptions, tabRoutes } from "./trading-context";
import TradingHistory from "./trading-history";
import SwipeCarousel from "./swipe-carousel";
import BotBuilder from "./bot-builder";
import dynamic from "next/dynamic";
const MarketAnalyzerPanel = dynamic(() => import("./market-analyzer"), { ssr: false, loading: () => <div className="workspace"><div className="workspace-heading"><div><p className="eyebrow">ANALYZER</p><h1>Market Analyzer</h1><p className="muted">Loading neural network engine…</p></div></div></div> });
import WalletPanel from "./wallet-panel";
import TickChart from "./tick-chart";
import ErrorBoundary from "./error-boundary";
import { ToastContainer, NotificationCenter, pushNotification } from "./notification-system";
import PortfolioDashboard from "./portfolio-dashboard";
import { getGlobalAnalyzer } from "../lib/market-analyzer";
import type { TradeRecommendation } from "./market-analyzer";
import RiskManagement, { defaultRiskSettings, createInitialRiskState, type RiskSettings } from "./risk-management";
import TopBar from "./trading-top-bar";
import MobileMenu from "./trading-mobile-menu";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Market = {
  symbol: string; display_name: string; market: string; market_display_name: string;
  submarket: string; submarket_display_name: string; exchange_is_open: number;
};

type ContractGroup = "Over / Under" | "Matches / Differs" | "Even / Odd";
type SubContract = "over" | "under" | "match" | "differs" | "even" | "odd";
type ActiveTab = "workspace" | "history" | "bots" | "settings" | "analyzer" | "portfolio" | "risk";

export type { ActiveTab };

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TradingTerminal({ initialTab = "workspace" }: { initialTab?: ActiveTab }) {
  return (
    <TradingProvider initialTab={initialTab}>
      <TradingTerminalInner />
    </TradingProvider>
  );
}

function TradingTerminalInner() {
  const t = useTrading();
  // Destructure for backward-compatible JSX references
  const {
    isMounted, activeTab, setActiveTab, symbol, setSymbol, contractGroup, setContractGroup,
    subContract, setSubContract, stake, setStake, ticks, running, setRunning,
    selectedDigit, setSelectedDigit, streamMode, tickStreamStatus,
    chartLoading, chartSkeletonMounted, accounts, activeAccountId, accountStatus,
    duration, setDuration, tradeError, setTradeError, showUserMenu, setShowUserMenu,
    showMobileMenu, setShowMobileMenu, showMarketPicker, setShowMarketPicker,
    marketSearch, setMarketSearch, markets, marketsLoading, showWallet, setShowWallet,
    showNotificationCenter, setShowNotificationCenter, riskSettings, setRiskSettings,
    riskState, setRiskState, resolvedDigit, contractTickElapsed, indicatorDuration,
    current, priceDelta, priceChangePct, symbolLabel, percentages,
    subOptions, needsBarrier, isDemo, stakeNum, activeAccount,
    handlePlaceTrade, handleUseRecommendation, handleContractGroupChange, handleHedge,
    balance, balanceCurrency, connectionStatus, lastResult, clearLastResult,
    tradeHistory, currentProposal, proposalRef, proposalLoading, buy, sell,
    clearError, lastError, authenticated, login, logout,
    fetchProfitTable, fetchPortfolio, botApi, wsAccounts, 
    activeContract, setMarkets, loadAccounts, authLoading, isBuying, setIsBuying,
    activateAccount, setIndicatorDuration, propose, buyBot, subscribeToContract, unsubscribeFromContract,
  } = t;

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
                  <TickChart ticks={ticks} activeContract={activeContract} displayDuration={indicatorDuration * 1000} tickElapsed={contractTickElapsed} tickTotal={activeContract?.tick_count} />
                </div>
                <div className="digit-strip-heading">
                  <span>Digit frequency</span>
                  <span className="muted">Last 100 ticks</span>
                </div>
                <div className="digit-strip">
                  {percentages.map((pct, digit) => (
                    <button key={digit} className={`digit-ring digit-${digit} ${digit === current.digit ? "current" : ""} ${digit === selectedDigit && needsBarrier ? "chosen" : ""} ${digit === resolvedDigit ? "resolved" : ""}`} onClick={() => setSelectedDigit(digit)}>
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
                    <TickChart ticks={ticks} activeContract={activeContract} displayDuration={indicatorDuration * 1000} tickElapsed={contractTickElapsed} tickTotal={activeContract?.tick_count} />
                  </div>
                  {/* Slide 2: Digit strip */}
                  <div className="digit-strip-slide">
                    <div className="digit-strip-heading">
                      <span>Digit frequency</span>
                      <span className="muted">Last 100 ticks</span>
                    </div>
                    <div className="digit-strip">
                      {percentages.map((pct, digit) => (
                        <button key={digit} className={`digit-ring digit-${digit} ${digit === current.digit ? "current" : ""} ${digit === selectedDigit && needsBarrier ? "chosen" : ""} ${digit === resolvedDigit ? "resolved" : ""}`} onClick={() => setSelectedDigit(digit)}>
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
              {/* Payout card */}
              <div className={`payout-card ${lastError && !proposalLoading && !currentProposal && !proposalRef.current ? "payout-error" : ""}`}>
                <div>
                  <span>Potential payout</span>
                  <strong className={proposalLoading && !proposalRef.current ? "payout-skeleton" : ""}>
                    {currentProposal ? "$" + fmt(currentProposal.payout) : proposalRef.current ? "$" + fmt(proposalRef.current.payout) : proposalLoading ? "   " : lastError ? "Error" : "—"}
                  </strong>
                </div>
                <div className="payout-rate">
                  {currentProposal ? "+" + ((currentProposal.payout - currentProposal.ask_price) / currentProposal.ask_price * 100).toFixed(1) + "%" : proposalRef.current ? "+" + ((proposalRef.current.payout - proposalRef.current.ask_price) / proposalRef.current.ask_price * 100).toFixed(1) + "%" : proposalLoading ? " " : "—"}
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
                  <button className="hedge-button" onClick={handleHedge} title="Auto-fill opposite contract">Hedge</button>
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
                    <button className="sell-button-lg sell-inactive" disabled>SELL</button>
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
            <MarketAnalyzerPanel onUseRecommendation={handleUseRecommendation} />
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
            <div className="settings-section">
              <h3>Display</h3>
              <div className="field-group">
                <label>Trade resolution indicator duration</label>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={0.5}
                    value={indicatorDuration}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setIndicatorDuration(val);
                      localStorage.setItem("freebuff_indicatorDuration", String(val));
                    }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontFamily: "Space Grotesk", fontWeight: 600, minWidth: 40, textAlign: "right" }}>{indicatorDuration}s</span>
                </div>
                <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>How long the WIN/LOSS marker and resolved digit highlight stay visible on the chart after a trade settles.</p>
              </div>
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
