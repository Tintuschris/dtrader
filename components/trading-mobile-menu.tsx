"use client";

import Link from "next/link";
import { IconChartLine, IconChartBar, IconBrain, IconRobot, IconChartPie, IconShield, IconSettings, IconX, IconWallet, IconLogout, IconLogin } from "@tabler/icons-react";
import { useTrading } from "./trading-context";

const tabRoutes: Record<string, string> = {
  workspace: "/", history: "/history", bots: "/bots", analyzer: "/analyzer",
  portfolio: "/portfolio", risk: "/risk", settings: "/settings",
};

export default function MobileMenu() {
  const t = useTrading();
  if (!t.showMobileMenu) return null;
  const navItems = [
    { key: "workspace", icon: <IconChartLine size={16} />, label: "Trade" },
    { key: "history", icon: <IconChartBar size={16} />, label: "History" },
    { key: "analyzer", icon: <IconBrain size={16} />, label: "Analyzer" },
    { key: "bots", icon: <IconRobot size={16} />, label: "Bots" },
    { key: "portfolio", icon: <IconChartPie size={16} />, label: "Portfolio" },
    { key: "risk", icon: <IconShield size={16} />, label: "Risk" },
    { key: "settings", icon: <IconSettings size={16} />, label: "Settings" },
  ];
  return (
    <div className="mobile-menu-overlay" onClick={() => t.setShowMobileMenu(false)}>
      <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-menu-header">
          <span className="brand-mark">D</span>
          <span>DTrader</span>
          <button className="mobile-menu-close" onClick={() => t.setShowMobileMenu(false)}><IconX size={18} /></button>
        </div>
        {t.balance !== null && (
          <div className="mobile-menu-balance">${Number(t.balance).toFixed(2)} {t.balanceCurrency}</div>
        )}
        <button className="mobile-menu-wallet-btn" onClick={() => { t.setShowWallet(true); t.setShowMobileMenu(false); }}><IconWallet size={16} /> Wallet & Accounts</button>
        {t.accounts.length > 0 && (
          <select className="mobile-account-select" value={t.activeAccountId} onChange={(e) => {
            const account = t.accounts.find((a) => a.id === e.target.value);
            if (account) void t.activateAccount(account);
            t.setShowMobileMenu(false);
          }}>
            {t.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.type === "real" ? "Real" : "Demo"} · {a.currency}</option>
            ))}
          </select>
        )}
        <div className="mobile-menu-links">
          {navItems.map((item) => (
            <Link key={item.key} className={t.activeTab === item.key ? "active" : ""} href={tabRoutes[item.key]} onClick={() => t.setShowMobileMenu(false)}>{item.icon} {item.label}</Link>
          ))}
        </div>
        <div className="mobile-menu-footer">
          {t.authenticated ? (
            <button className="mobile-logout-btn" onClick={() => { void t.logout(); t.setShowMobileMenu(false); }}><IconLogout size={14} /> Logout</button>
          ) : (
            <button className="mobile-login-btn" onClick={() => { void t.login(); t.setShowMobileMenu(false); }}><IconLogin size={14} /> Login with Deriv</button>
          )}
        </div>
      </div>
    </div>
  );
}