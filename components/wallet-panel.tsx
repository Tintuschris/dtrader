"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountInfo } from "./use-deriv-ws";
import {
  IconWallet,
  IconArrowRight,
  IconRefresh,
  IconX,
  IconSwitch2,
} from "@tabler/icons-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AccountBalance = {
  id: string;
  type: "demo" | "real";
  currency: string;
  balance?: number | null;
  account_type?: string; // Options, CFDs, Multipliers, Wallet, etc.
  account_subtype?: string; // Standard, Pro, etc.
  is_wallet?: boolean; // Whether this is a main wallet account
};

type WalletPanelProps = {
  activeAccountId: string;
  accounts: AccountInfo[];
  activeBalance: number | null;
  activeCurrency: string;
  onSelectAccount: (account: { id: string; type: "demo" | "real"; currency: string; balance?: number }) => void;
  onClose: () => void;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(n: number | string | null) {
  if (n === null || n === undefined) return "—";
  return Number(n).toFixed(2);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WalletPanel({
  activeAccountId,
  accounts: wsAccounts,
  activeBalance,
  activeCurrency,
  onSelectAccount,
  onClose,
}: WalletPanelProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);

  const fetchBalances = useCallback(() => {
    // Account list comes from the WS hook - just set transfer defaults
    if (wsAccounts.length >= 2 && !transferFrom) {
      setTransferFrom(wsAccounts[0].loginid);
      setTransferTo(wsAccounts[1].loginid);
    }
  }, [wsAccounts, transferFrom]);

  // Accounts arrive automatically via the WS hook on connect

  const handleTransfer = useCallback(async () => {
    if (!transferFrom || !transferTo || !transferAmount) return;
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferError("Enter a valid amount");
      return;
    }
    setTransferLoading(true);
    setTransferError(null);
    setTransferSuccess(false);
    try {
      const res = await fetch("/api/deriv/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: transferFrom, to: transferTo, amount }),
      });
      const data = (await res.json());
      if (!res.ok) {
        setTransferError(data.error ?? "Transfer failed");
      } else {
        setTransferSuccess(true);
        setTransferAmount("");
        // Refresh balances
        // Account list is live from WS
        setTimeout(() => setTransferSuccess(false), 3000);
      }
    } catch (e) {
      setTransferError(String(e));
    } finally {
      setTransferLoading(false);
    }
  }, [transferFrom, transferTo, transferAmount, fetchBalances]);

  const walletAccounts: AccountBalance[] = [];
  const tradingAccounts: AccountBalance[] = [];
  for (const a of wsAccounts) {
    const isWallet = a.loginid.startsWith("CRW") || a.loginid.startsWith("VRW");
    const acctType: "demo" | "real" = a.account_type.toLowerCase().includes("real") ? "real" : "demo";
    const entry: AccountBalance = {
      id: a.loginid,
      type: acctType,
      currency: a.currency,
      balance: a.loginid === activeAccountId ? (activeBalance ?? undefined) : undefined,
      account_type: a.landing_company_name || (isWallet ? "Wallet" : a.trading_type || "Options"),
      is_wallet: isWallet,
    };
    if (isWallet) walletAccounts.push(entry); else tradingAccounts.push(entry);
  }
  
  const walletBalance = walletAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
  const tradingBalance = tradingAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
  
  const totalBalance = activeBalance ?? 0;

  return (
    <>
      <div className="wallet-panel-overlay" onClick={onClose} />
      <div className="wallet-panel">
        <div className="wallet-panel-header">
          <div className="wallet-panel-title">
            <IconWallet size={18} />
            <span>Wallet & Accounts</span>
          </div>
          <div className="wallet-panel-actions">
            <button
              className="wallet-icon-btn"
              onClick={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 1000); }}
              disabled={refreshing}
              title="Refresh balances"
            >
              <IconRefresh size={16} className={refreshing ? "spin" : ""} />
            </button>
            <button className="wallet-icon-btn" onClick={onClose}>
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Wallet Balance */}
        {walletAccounts.length > 0 && (
          <div className="wallet-section">
            <div className="wallet-section-title">Main Wallet</div>
            {walletAccounts.map((account) => (
              <div
                key={account.id}
                className={`wallet-account wallet-account-wallet ${account.id === activeAccountId ? "active" : ""}`}
                onClick={() => onSelectAccount({ id: account.id, type: account.type, currency: account.currency, balance: account.balance ?? undefined })}
              >
                <div className="wallet-account-left">
                  <span className="wallet-wallet-badge">WALLET</span>
                  <div className="wallet-account-info">
                    <span className="wallet-account-id">{account.id}</span>
                    <span className="wallet-account-currency">{account.currency}</span>
                  </div>
                </div>
                <div className="wallet-account-right">
                  <span className="wallet-account-balance wallet-balance-highlight">
                    ${fmt(account.balance ?? 0)}
                  </span>
                  {account.id === activeAccountId && (
                    <span className="wallet-active-dot" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Trading Accounts */}
        {tradingAccounts.length > 0 && (
          <div className="wallet-section">
            <div className="wallet-section-title">Trading Accounts</div>
            <div className="wallet-accounts">
              {loading ? (
                <div className="wallet-loading">Loading balances…</div>
              ) : tradingAccounts.length === 0 ? (
                <div className="wallet-empty">No trading accounts found.</div>
              ) : (
                tradingAccounts.map((account) => (
                  <div
                    key={account.id}
                    className={`wallet-account ${account.id === activeAccountId ? "active" : ""}`}
                    onClick={() => onSelectAccount({ id: account.id, type: account.type, currency: account.currency, balance: account.balance ?? undefined })}
                  >
                    <div className="wallet-account-left">
                      <span className={`wallet-type-badge ${account.type}`}>
                        {account.type === "real" ? "REAL" : "DEMO"}
                      </span>
                      <div className="wallet-account-info">
                        <span className="wallet-account-id">{account.id}</span>
                        <span className="wallet-account-currency">
                          {account.currency}
                        </span>
                        {account.account_type && (
                          <span className="wallet-account-type">{account.account_type}</span>
                        )}
                        {account.account_subtype && account.account_subtype !== "Standard" && (
                          <span className="wallet-account-subtype">{account.account_subtype}</span>
                        )}
                      </div>
                    </div>
                    <div className="wallet-account-right">
                      <span className="wallet-account-balance">
                        ${fmt(account.balance ?? 0)}
                      </span>
                      {account.id === activeAccountId && (
                        <span className="wallet-active-dot" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Total Balance */}
        <div className="wallet-total-section">
          <div className="wallet-total-row">
            <span>Wallet Balance</span>
            <strong>${fmt(walletBalance)}</strong>
          </div>
          <div className="wallet-total-row">
            <span>Trading Balance</span>
            <strong>${fmt(tradingBalance)}</strong>
          </div>
          <div className="wallet-total-row wallet-total-main">
            <span>Total Portfolio</span>
            <strong className="wallet-total-highlight">${fmt(totalBalance)}</strong>
          </div>
        </div>

        {/* Transfer button */}
        {wsAccounts.length >= 2 && (
          <button
            className="wallet-transfer-btn"
            onClick={() => setShowTransfer(true)}
          >
            <IconSwitch2 size={16} />
            Transfer Between Accounts
          </button>
        )}

        {/* Transfer modal */}
        {showTransfer && (
          <div className="wallet-transfer">
            <div className="wallet-transfer-header">
              <span>Transfer Funds</span>
              <button
                className="wallet-icon-btn"
                onClick={() => {
                  setShowTransfer(false);
                  setTransferError(null);
                  setTransferSuccess(false);
                }}
              >
                <IconX size={14} />
              </button>
            </div>

            {transferSuccess && (
              <div className="wallet-transfer-success">
                ✓ Transfer completed successfully!
              </div>
            )}
            {transferError && (
              <div className="wallet-transfer-error">{transferError}</div>
            )}

            <div className="wallet-transfer-form">
              <label>From</label>
              <select
                value={transferFrom}
                onChange={(e) => setTransferFrom(e.target.value)}
              >
                {wsAccounts.map((a) => (
                  <option key={a.loginid} value={a.loginid}>
                    {a.account_type === "real" ? "Real" : "Demo"} · {a.currency}
                  </option>
                ))}
              </select>

              <div className="wallet-transfer-arrow">
                <IconArrowRight size={16} />
              </div>

              <label>To</label>
              <select
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              >
                {wsAccounts.map((a) => (
                  <option key={a.loginid} value={a.loginid}>
                    {a.account_type === "real" ? "Real" : "Demo"} · {a.currency}
                  </option>
                ))}
              </select>

              <label>Amount</label>
              <div className="wallet-transfer-amount">
                <span>$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                />
              </div>

              <button
                className="wallet-transfer-submit"
                onClick={() => void handleTransfer()}
                disabled={
                  transferLoading ||
                  !transferFrom ||
                  !transferTo ||
                  !transferAmount ||
                  transferFrom === transferTo
                }
              >
                {transferLoading ? "Transferring…" : "Transfer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
