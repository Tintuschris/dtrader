"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconShield,
  IconAlertTriangle,
  IconCurrencyDollar,
  IconTrendingDown,
  IconClock,
  IconTarget,
  IconToggleRight,
  IconToggleLeft,
  IconRefresh,
  IconInfoCircle,
  IconCheck,
} from "@tabler/icons-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type RiskSettings = {
  maxStake: number;
  maxStakeEnabled: boolean;
  dailyLossLimit: number;
  dailyLossLimitEnabled: boolean;
  stopLoss: number;
  stopLossEnabled: boolean;
  maxConsecutiveLosses: number;
  maxConsecutiveLossesEnabled: boolean;
  maxTradesPerSession: number;
  maxTradesPerSessionEnabled: boolean;
  sessionProfitTarget: number;
  sessionProfitTargetEnabled: boolean;
};

export type RiskState = {
  dailyPnL: number;
  consecutiveLosses: number;
  tradesThisSession: number;
  sessionPnL: number;
  isHalted: boolean;
  haltReason: string;
  lastResetDate: string;
};

type RiskManagementProps = {
  settings: RiskSettings;
  onSettingsChange: (settings: RiskSettings) => void;
  riskState: RiskState;
  currentStake: number;
  balance: number | null;
  onResetSession: () => void;
  lastResult?: { profit: number; status: string } | null;
};

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

export const defaultRiskSettings: RiskSettings = {
  maxStake: 100,
  maxStakeEnabled: false,
  dailyLossLimit: 500,
  dailyLossLimitEnabled: false,
  stopLoss: 200,
  stopLossEnabled: false,
  maxConsecutiveLosses: 10,
  maxConsecutiveLossesEnabled: false,
  maxTradesPerSession: 100,
  maxTradesPerSessionEnabled: false,
  sessionProfitTarget: 500,
  sessionProfitTargetEnabled: false,
};

export function createInitialRiskState(): RiskState {
  return {
    dailyPnL: 0,
    consecutiveLosses: 0,
    tradesThisSession: 0,
    sessionPnL: 0,
    isHalted: false,
    haltReason: "",
    lastResetDate: new Date().toISOString().split("T")[0],
  };
}

/* ------------------------------------------------------------------ */
/*  Risk check function (exported for terminal to call)                */
/* ------------------------------------------------------------------ */

export function checkRiskLimits(
  settings: RiskSettings,
  state: RiskState,
  proposedStake: number,
): { allowed: boolean; reason: string } {
  if (state.isHalted) {
    return { allowed: false, reason: `Trading halted: ${state.haltReason}` };
  }
  if (settings.maxStakeEnabled && proposedStake > settings.maxStake) {
    return { allowed: false, reason: `Stake $${proposedStake} exceeds max stake $${settings.maxStake}` };
  }
  if (settings.dailyLossLimitEnabled && Math.abs(state.dailyPnL) >= settings.dailyLossLimit && state.dailyPnL < 0) {
    return { allowed: false, reason: `Daily loss limit $${settings.dailyLossLimit} reached` };
  }
  if (settings.stopLossEnabled && Math.abs(state.sessionPnL) >= settings.stopLoss && state.sessionPnL < 0) {
    return { allowed: false, reason: `Stop-loss $${settings.stopLoss} triggered` };
  }
  if (settings.maxConsecutiveLossesEnabled && state.consecutiveLosses >= settings.maxConsecutiveLosses) {
    return { allowed: false, reason: `Max consecutive losses (${settings.maxConsecutiveLosses}) reached` };
  }
  if (settings.maxTradesPerSessionEnabled && state.tradesThisSession >= settings.maxTradesPerSession) {
    return { allowed: false, reason: `Max trades per session (${settings.maxTradesPerSession}) reached` };
  }
  if (settings.sessionProfitTargetEnabled && state.sessionPnL >= settings.sessionProfitTarget) {
    return { allowed: false, reason: `Session profit target $${settings.sessionProfitTarget} reached!` };
  }
  return { allowed: true, reason: "" };
}

export function updateRiskState(
  state: RiskState,
  settings: RiskSettings,
  tradeResult: { profit: number; status: string },
): RiskState {
  const today = new Date().toISOString().split("T")[0];
  let newState = { ...state };

  // Reset daily P&L if new day
  if (newState.lastResetDate !== today) {
    newState.dailyPnL = 0;
    newState.lastResetDate = today;
  }

  newState.dailyPnL += tradeResult.profit;
  newState.sessionPnL += tradeResult.profit;
  newState.tradesThisSession++;

  if (tradeResult.status === "lost") {
    newState.consecutiveLosses++;
  } else {
    newState.consecutiveLosses = 0;
  }

  // Check halt conditions
  const check = checkRiskLimits(settings, newState, 0);
  if (!check.allowed) {
    newState.isHalted = true;
    newState.haltReason = check.reason;
  }

  return newState;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RiskManagement({
  settings,
  onSettingsChange,
  riskState,
  currentStake,
  balance,
  onResetSession,
  lastResult,
}: RiskManagementProps) {
  const [showInfo, setShowInfo] = useState(false);

  const update = useCallback(
    (partial: Partial<RiskSettings>) => {
      onSettingsChange({ ...settings, ...partial });
    },
    [settings, onSettingsChange],
  );

  const toggle = useCallback(
    (key: keyof RiskSettings) => {
      update({ [key]: !settings[key] } as Partial<RiskSettings>);
    },
    [settings, update],
  );

  const stakeCheck = checkRiskLimits(settings, riskState, currentStake);
  const dailyUsedPct = settings.dailyLossLimitEnabled
    ? Math.min(100, (Math.abs(riskState.dailyPnL < 0 ? riskState.dailyPnL : 0) / settings.dailyLossLimit) * 100)
    : 0;
  const stopLossPct = settings.stopLossEnabled
    ? Math.min(100, (Math.abs(riskState.sessionPnL < 0 ? riskState.sessionPnL : 0) / settings.stopLoss) * 100)
    : 0;
  const tradesPct = settings.maxTradesPerSessionEnabled
    ? Math.min(100, (riskState.tradesThisSession / settings.maxTradesPerSession) * 100)
    : 0;
  const streakPct = settings.maxConsecutiveLossesEnabled
    ? Math.min(100, (riskState.consecutiveLosses / settings.maxConsecutiveLosses) * 100)
    : 0;
  const profitTargetPct = settings.sessionProfitTargetEnabled && settings.sessionProfitTarget > 0
    ? Math.min(100, Math.max(0, (riskState.sessionPnL / settings.sessionProfitTarget) * 100))
    : 0;

  return (
    <div className="risk-management">
      {/* ===== HEADER ===== */}
      <div className="portfolio-header">
        <div>
          <p className="eyebrow">RISK MANAGEMENT</p>
          <h1>Risk Controls</h1>
          <p className="muted">Set limits to protect your capital and manage risk.</p>
        </div>
        <div className="risk-header-actions">
          <button className="risk-info-btn" onClick={() => setShowInfo(!showInfo)}>
            <IconInfoCircle size={16} /> {showInfo ? "Hide" : "Guide"}
          </button>
          <button className="risk-reset-btn" onClick={onResetSession}>
            <IconRefresh size={16} /> Reset Session
          </button>
        </div>
      </div>

      {/* ===== HALT BANNER ===== */}
      {riskState.isHalted && (
        <div className="risk-halt-banner">
          <IconAlertTriangle size={20} />
          <div>
            <strong>Trading Halted</strong>
            <span>{riskState.haltReason}</span>
          </div>
          <button className="risk-halt-dismiss" onClick={onResetSession}>
            Reset & Resume
          </button>
        </div>
      )}

      {/* ===== INFO GUIDE ===== */}
      {showInfo && (
        <div className="risk-info-panel">
          <h3><IconShield size={16} /> Risk Management Guide</h3>
          <ul>
            <li><strong>Max Stake</strong> — Limits the maximum amount per trade</li>
            <li><strong>Daily Loss Limit</strong> — Stops trading when daily losses reach the limit</li>
            <li><strong>Stop Loss</strong> — Halts the session when total session losses reach the limit</li>
            <li><strong>Max Consecutive Losses</strong> — Stops after N losses in a row</li>
            <li><strong>Session Trade Limit</strong> — Caps total trades per session</li>
            <li><strong>Profit Target</strong> — Stops when session profit reaches the target</li>
          </ul>
        </div>
      )}

      {/* ===== SESSION STATUS ===== */}
      <div className="risk-status-grid">
        <div className={`risk-status-card ${riskState.sessionPnL >= 0 ? "positive" : "negative"}`}>
          <span className="rs-label">Session P&L</span>
          <strong className="rs-value">{riskState.sessionPnL >= 0 ? "+" : ""}${riskState.sessionPnL.toFixed(2)}</strong>
          {settings.sessionProfitTargetEnabled && profitTargetPct > 0 && (
            <div className="rs-progress">
              <div className={`rs-progress-bar ${riskState.sessionPnL >= 0 ? "positive" : "negative"}`} style={{ width: `${profitTargetPct}%` }} />
            </div>
          )}
        </div>
        <div className="risk-status-card">
          <span className="rs-label">Daily P&L</span>
          <strong className={`rs-value ${riskState.dailyPnL >= 0 ? "positive" : "negative"}`}>{riskState.dailyPnL >= 0 ? "+" : ""}${riskState.dailyPnL.toFixed(2)}</strong>
          {settings.dailyLossLimitEnabled && (
            <div className="rs-progress">
              <div className={`rs-progress-bar ${dailyUsedPct >= 80 ? "negative" : "info"}`} style={{ width: `${dailyUsedPct}%` }} />
            </div>
          )}
        </div>
        <div className="risk-status-card">
          <span className="rs-label">Trades</span>
          <strong className="rs-value">{riskState.tradesThisSession}</strong>
          {settings.maxTradesPerSessionEnabled && (
            <div className="rs-progress">
              <div className={`rs-progress-bar ${tradesPct >= 80 ? "warning" : "info"}`} style={{ width: `${tradesPct}%` }} />
            </div>
          )}
        </div>
        <div className="risk-status-card">
          <span className="rs-label">Consecutive Losses</span>
          <strong className={`rs-value ${riskState.consecutiveLosses > 0 ? "negative" : ""}`}>{riskState.consecutiveLosses}</strong>
          {settings.maxConsecutiveLossesEnabled && (
            <div className="rs-progress">
              <div className={`rs-progress-bar ${streakPct >= 80 ? "negative" : "warning"}`} style={{ width: `${streakPct}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* ===== CURRENT STAKE CHECK ===== */}
      <div className="risk-current-check">
        <div className="check-header">
          <IconTarget size={16} />
          <span>Current Stake Check</span>
        </div>
        <div className={`check-result ${stakeCheck.allowed ? "allowed" : "blocked"}`}>
          {stakeCheck.allowed ? (
            <><IconCheck size={16} /> Stake ${currentStake.toFixed(2)} is within limits</>
          ) : (
            <><IconAlertTriangle size={16} /> {stakeCheck.reason}</>
          )}
        </div>
      </div>

      {/* ===== SETTINGS ===== */}
      <div className="risk-settings-grid">
        {/* Max Stake */}
        <RiskToggle
          title="Max Stake"
          icon={<IconCurrencyDollar size={16} />}
          description="Limit the maximum amount per trade"
          enabled={settings.maxStakeEnabled}
          onToggle={() => toggle("maxStakeEnabled")}
        >
          <div className="risk-input-row">
            <span className="risk-currency">$</span>
            <input
              type="number"
              min="1"
              step="1"
              value={settings.maxStake}
              onChange={(e) => update({ maxStake: parseFloat(e.target.value) || 0 })}
              disabled={!settings.maxStakeEnabled}
            />
          </div>
          {settings.maxStakeEnabled && balance != null && settings.maxStake > balance && (
            <span className="risk-warning-text">Max stake exceeds current balance</span>
          )}
        </RiskToggle>

        {/* Daily Loss Limit */}
        <RiskToggle
          title="Daily Loss Limit"
          icon={<IconTrendingDown size={16} />}
          description="Stop trading when daily losses reach this limit"
          enabled={settings.dailyLossLimitEnabled}
          onToggle={() => toggle("dailyLossLimitEnabled")}
        >
          <div className="risk-input-row">
            <span className="risk-currency">$</span>
            <input
              type="number"
              min="1"
              step="10"
              value={settings.dailyLossLimit}
              onChange={(e) => update({ dailyLossLimit: parseFloat(e.target.value) || 0 })}
              disabled={!settings.dailyLossLimitEnabled}
            />
          </div>
          {settings.dailyLossLimitEnabled && (
            <span className="risk-progress-text">
              ${Math.abs(riskState.dailyPnL < 0 ? riskState.dailyPnL : 0).toFixed(2)} / ${settings.dailyLossLimit} used
            </span>
          )}
        </RiskToggle>

        {/* Stop Loss */}
        <RiskToggle
          title="Session Stop Loss"
          icon={<IconAlertTriangle size={16} />}
          description="Halt the session when cumulative losses reach this amount"
          enabled={settings.stopLossEnabled}
          onToggle={() => toggle("stopLossEnabled")}
        >
          <div className="risk-input-row">
            <span className="risk-currency">$</span>
            <input
              type="number"
              min="1"
              step="10"
              value={settings.stopLoss}
              onChange={(e) => update({ stopLoss: parseFloat(e.target.value) || 0 })}
              disabled={!settings.stopLossEnabled}
            />
          </div>
          {settings.stopLossEnabled && riskState.sessionPnL < 0 && (
            <span className="risk-progress-text">
              ${Math.abs(riskState.sessionPnL).toFixed(2)} / ${settings.stopLoss} used
            </span>
          )}
        </RiskToggle>

        {/* Max Consecutive Losses */}
        <RiskToggle
          title="Max Consecutive Losses"
          icon={<IconClock size={16} />}
          description="Pause after N losses in a row to prevent tilt"
          enabled={settings.maxConsecutiveLossesEnabled}
          onToggle={() => toggle("maxConsecutiveLossesEnabled")}
        >
          <div className="risk-input-row">
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={settings.maxConsecutiveLosses}
              onChange={(e) => update({ maxConsecutiveLosses: parseInt(e.target.value) || 0 })}
              disabled={!settings.maxConsecutiveLossesEnabled}
            />
          </div>
          {settings.maxConsecutiveLossesEnabled && (
            <span className="risk-progress-text">
              {riskState.consecutiveLosses} / {settings.maxConsecutiveLosses} losses
            </span>
          )}
        </RiskToggle>

        {/* Max Trades Per Session */}
        <RiskToggle
          title="Session Trade Limit"
          icon={<IconTarget size={16} />}
          description="Cap the total number of trades per session"
          enabled={settings.maxTradesPerSessionEnabled}
          onToggle={() => toggle("maxTradesPerSessionEnabled")}
        >
          <div className="risk-input-row">
            <input
              type="number"
              min="1"
              step="10"
              value={settings.maxTradesPerSession}
              onChange={(e) => update({ maxTradesPerSession: parseInt(e.target.value) || 0 })}
              disabled={!settings.maxTradesPerSessionEnabled}
            />
          </div>
          {settings.maxTradesPerSessionEnabled && (
            <span className="risk-progress-text">
              {riskState.tradesThisSession} / {settings.maxTradesPerSession} trades
            </span>
          )}
        </RiskToggle>

        {/* Profit Target */}
        <RiskToggle
          title="Session Profit Target"
          icon={<IconCheck size={16} />}
          description="Stop and celebrate when session profit reaches this target"
          enabled={settings.sessionProfitTargetEnabled}
          onToggle={() => toggle("sessionProfitTargetEnabled")}
        >
          <div className="risk-input-row">
            <span className="risk-currency">$</span>
            <input
              type="number"
              min="1"
              step="10"
              value={settings.sessionProfitTarget}
              onChange={(e) => update({ sessionProfitTarget: parseFloat(e.target.value) || 0 })}
              disabled={!settings.sessionProfitTargetEnabled}
            />
          </div>
          {settings.sessionProfitTargetEnabled && riskState.sessionPnL > 0 && (
            <span className="risk-progress-text positive-color">
              ${riskState.sessionPnL.toFixed(2)} / ${settings.sessionProfitTarget} target
            </span>
          )}
        </RiskToggle>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Risk Toggle sub-component                                          */
/* ------------------------------------------------------------------ */

function RiskToggle({
  title,
  icon,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`risk-toggle-card ${enabled ? "active" : ""}`}>
      <div className="rtc-header">
        <div className="rtc-title-row">
          <span className="rtc-icon">{icon}</span>
          <span className="rtc-title">{title}</span>
        </div>
        <button className={`rtc-toggle ${enabled ? "on" : ""}`} onClick={onToggle} aria-label={`Toggle ${title}`}>
          {enabled ? <IconToggleRight size={28} /> : <IconToggleLeft size={28} />}
        </button>
      </div>
      <p className="rtc-desc">{description}</p>
      <div className="rtc-body">{children}</div>
    </div>
  );
}
