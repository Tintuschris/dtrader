"use client";

import React from "react";
import Link from "next/link";
import { IconSettings, IconMenu2, IconChartLine, IconChartBar, IconBrain, IconRobot, IconChartPie, IconShield, IconLogout, IconLogin, IconUser, IconBell } from "@tabler/icons-react";
import { useTrading } from "./trading-context";

const tabRoutes = {
  workspace: "/",
  history: "/history",
  bots: "/bots",
  analyzer: "/analyzer",
  portfolio: "/portfolio",
  risk: "/risk",
  settings: "/settings",
};

export default function TopBar() {
  const t = useTrading();
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-mark">D</span>
          <span className="brand-text">DTrader</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {(["workspace","history","analyzer","bots","portfolio","risk","settings"] as const).map((key) => {
            const icons: Record<string, React.ReactNode> = {
              workspace: <IconChartLine size={15} />,
              history: <IconChartBar size={15} />,
              analyzer: <IconBrain size={15} />,
              bots: <IconRobot size={15} />,
              portfolio: <IconChartPie size={15} />,
              risk: <IconShield size={15} />,
              settings: <IconSettings size={15} />,
            };
            const labels: Record<string, string> = {
              workspace: "Trade", history: "History", analyzer: "Analyze",
              bots: "Bots", portfolio: "Portfolio", risk: "Risk", settings: "Settings",
            };
            return (
              <Link key={key} className={`nav-link ${t.activeTab === key ? "active" : ""}`} href={tabRoutes[key]}>
                {icons[key]}<span className="nav-label">{labels[key]}</span>
                {key === "history" && t.tradeHistory.length > 0 && <span className="nav-badge">{t.tradeHistory.length}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="topbar-right">
        {t.balance !== null && (
          <button className="balance-pill" onClick={() => t.setShowWallet((v) => !v)} title="Click to view all accounts">
            <span className="balance-amount">${Number(t.balance).toFixed(2)}</span>
            <span className="balance-currency">{t.balanceCurrency}</span>
          </button>
        )}
        {t.accounts.length > 0 ? (
          <div className="account-select-wrap">
            <span className={`account-type-dot ${t.isDemo ? "demo" : "real"}`} />
            <select className="account-select" value={t.activeAccountId} onChange={(e) => {
              const account = t.accounts.find((a) => a.id === e.target.value);
              if (account) void t.activateAccount(account);
            }}>
              {t.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.type === "real" ? "Real" : "Demo"} · {a.currency}</option>
              ))}
            </select>
          </div>
        ) : (
          <button className="connect-btn" onClick={() => void t.activateAccount(t.accounts[0])}>Connect</button>
        )}
        <span className="ws-status" title={t.accountStatus}>
          <span className={`ws-dot ${t.connectionStatus}`} />
        </span>
        <button className="nc-bell-btn" onClick={() => t.setShowNotificationCenter((v) => !v)} title="Notifications">
          <IconBell size={18} />
        </button>
        {t.authenticated ? (
          <div className="user-menu-wrap">
            <button className="avatar-btn" onClick={() => t.setShowUserMenu((v) => !v)}><IconUser size={16} /></button>
            {t.showUserMenu && (
              <div className="user-menu" onClick={() => t.setShowUserMenu(false)}>
                <div className="user-menu-header">{t.activeAccount?.type === "real" ? "Real" : "Demo"} Account</div>
                <button className="user-menu-item" onClick={() => void t.logout()}><IconLogout size={14} /> Logout</button>
              </div>
            )}
          </div>
        ) : (
          <button className="login-btn" onClick={() => void t.login()}>{<><IconLogin size={14} /> Login</>}</button>
        )}
        <button className="mobile-menu-btn" onClick={() => t.setShowMobileMenu((v) => !v)} aria-label="Menu"><IconMenu2 size={20} /></button>
      </div>
    </header>
  );
}