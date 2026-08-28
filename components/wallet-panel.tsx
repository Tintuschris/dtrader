"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountInfo } from "./use-deriv-ws";
import {
  IconWallet,
  IconArrowRight,
  IconRefresh,
  IconX,
  IconSwitch2,
  IconCheck,
  IconAlertCircle,
} from "@tabler/icons-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type AccountBalance = {
  id: string;
  loginid: string;
  type: "demo" | "real";
  currency: string;
  balance?: number | null;
  account_type?: string; // Options, CFDs, Multipliers, Wallet, etc.
  account_subtype?: string; // Standard, Pro, etc.
  is_wallet?: boolean; // Whether this is a main wallet account
};

export type WalletBalance = {
  id: string;
  walletType: string;
  currency: string;
  balance: number | null;
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

function fmt(n: number | string | null | undefined) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [refreshing, setRefreshing] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [platformAccounts, setPlatformAccounts] = useState<AccountBalance[]>([]);
  const [walletError, setWalletError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    setRefreshing(true);
    setWalletError(null);
    try {
      const [walletRes, balancesRes] = await Promise.all([
        fetch("/api/deriv/wallets", { cache: "no-store" }).catch(() => null),
        fetch("/api/deriv/balances", { cache: "no-store" }).catch(() => null),
      ]);
      const errors: string[] = [];

      if (walletRes) {
        const data = (await walletRes.json().catch(() => ({}))) as { wallets?: WalletBalance[]; error?: string };
        if (walletRes.ok) {
          setWallets(data.wallets ?? []);
        } else {
          errors.push(data.error ?? "Unable to load wallets");
        }
      } else {
        errors.push("Unable to reach the wallet service");
      }

      if (balancesRes) {
        const data = (await balancesRes.json().catch(() => ({}))) as { accounts?: AccountBalance[]; error?: string };
        if (balancesRes.ok) {
          setPlatformAccounts(data.accounts ?? []);
        } else {
          errors.push(data.error ?? "Unable to load Options trading accounts");
        }
      } else {
        errors.push("Unable to reach the trading-account service");
      }

      if (errors.length > 0) {
        setWalletError(errors.join(". "));
      }
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Unable to load balances");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchBalances();
  }, [fetchBalances]);

  // Combine wsAccounts with fetched platformAccounts for complete representation
  const tradingAccounts: AccountBalance[] = useMemo(() => {
    const map = new Map<string, AccountBalance>();

    // Start with accounts fetched from balances API
    for (const a of platformAccounts) {
      map.set(a.id || a.loginid, { ...a });
    }

    // Overlay with live WS accounts and active balance
    for (const w of wsAccounts) {
      const existing = map.get(w.loginid);
      const isReal = w.account_type.toLowerCase().includes("real") || !w.loginid.startsWith("VR");
      if (existing) {
        if (w.loginid === activeAccountId && activeBalance !== null) {
          existing.balance = activeBalance;
        }
      } else {
        map.set(w.loginid, {
          id: w.loginid,
          loginid: w.loginid,
          type: isReal ? "real" : "demo",
          currency: w.currency || "USD",
          balance: w.loginid === activeAccountId ? activeBalance : null,
          account_type: w.landing_company_name || w.trading_type || "Options",
          is_wallet: false,
        });
      }
    }

    return Array.from(map.values()).filter((a) => !a.is_wallet);
  }, [platformAccounts, wsAccounts, activeAccountId, activeBalance]);

  // All transferrable options (Wallets + Trading Accounts)
  const allTransferrable = useMemo(() => {
    const list: Array<{ id: string; label: string; currency: string; balance: number | null }> = [];

    for (const w of wallets) {
      const walletId = w.id.includes(":") ? w.id.split(":")[0] : w.id;
      list.push({
        id: walletId,
        label: `Wallet (${w.walletType}) · ${w.currency}`,
        currency: w.currency,
        balance: w.balance,
      });
    }

    for (const a of tradingAccounts) {
      list.push({
        id: a.id || a.loginid,
        label: `${a.type === "real" ? "Real" : "Demo"} (${a.account_type || "Options"}) · ${a.id}`,
        currency: a.currency,
        balance: a.balance ?? null,
      });
    }

    return list;
  }, [wallets, tradingAccounts]);

  // Set default transfer selections when options change
  useEffect(() => {
    if (allTransferrable.length >= 2) {
      if (!transferFrom || !allTransferrable.some((a) => a.id === transferFrom)) {
        setTransferFrom(allTransferrable[0].id);
      }
      if (!transferTo || !allTransferrable.some((a) => a.id === transferTo) || transferTo === allTransferrable[0]?.id) {
        setTransferTo(allTransferrable[1]?.id ?? allTransferrable[0]?.id);
      }
    }
  }, [allTransferrable, transferFrom, transferTo]);

  const selectedFromAccount = useMemo(
    () => allTransferrable.find((a) => a.id === transferFrom),
    [allTransferrable, transferFrom],
  );

  const handleTransfer = useCallback(async () => {
    if (!transferFrom || !transferTo || !transferAmount) return;
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferError("Enter a valid transfer amount");
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
      const data = await res.json();
      if (!res.ok) {
        setTransferError(data.error ?? "Transfer failed");
      } else {
        setTransferSuccess(true);
        setTransferAmount("");
        await fetchBalances();
        setTimeout(() => setTransferSuccess(false), 4000);
      }
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : String(e));
    } finally {
      setTransferLoading(false);
    }
  }, [transferFrom, transferTo, transferAmount, fetchBalances]);

  const walletBalance = wallets.reduce((sum, wallet) => sum + (wallet.balance ?? 0), 0);
  const tradingBalance = tradingAccounts.reduce((sum, account) => sum + (account.balance ?? 0), 0);
  const visibleBalance = walletBalance + tradingBalance;

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
              onClick={() => void fetchBalances()}
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

        {/* Main Wallets Section */}
        <div className="wallet-section">
          <div className="wallet-section-title">Main Wallets</div>
          {walletError ? (
            <div className="wallet-empty">{walletError}</div>
          ) : wallets.length === 0 && refreshing ? (
            <div className="wallet-loading">Loading wallet balances…</div>
          ) : wallets.length === 0 ? (
            <div className="wallet-empty">No active wallets found.</div>
          ) : (
            wallets.map((wallet) => (
              <div key={wallet.id} className="wallet-account wallet-account-wallet">
                <div className="wallet-account-left">
                  <span className="wallet-wallet-badge">WALLET</span>
                  <div className="wallet-account-info">
                    <span className="wallet-account-id">{wallet.walletType}</span>
                    <span className="wallet-account-currency">{wallet.currency}</span>
                  </div>
                </div>
                <div className="wallet-account-right">
                  <span className="wallet-account-balance wallet-balance-highlight">
                    ${fmt(wallet.balance)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Options accounts are returned by the authenticated Options API. */}
        <div className="wallet-section">
          <div className="wallet-section-title">Options Trading Accounts</div>
          <div className="wallet-accounts">
            {tradingAccounts.length === 0 && refreshing ? (
              <div className="wallet-loading">Loading platform accounts…</div>
            ) : tradingAccounts.length === 0 ? (
              <div className="wallet-empty">No trading accounts found.</div>
            ) : (
              tradingAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`wallet-account ${account.id === activeAccountId ? "active" : ""}`}
                  onClick={() =>
                    onSelectAccount({
                      id: account.id,
                      type: account.type,
                      currency: account.currency,
                      balance: account.balance ?? undefined,
                    })
                  }
                >
                  <div className="wallet-account-left">
                    <span className={`wallet-type-badge ${account.type}`}>
                      {account.type === "real" ? "REAL" : "DEMO"}
                    </span>
                    <div className="wallet-account-info">
                      <span className="wallet-account-id">{account.id}</span>
                      <span className="wallet-account-currency">{account.currency}</span>
                      {account.account_type && (
                        <span className="wallet-account-type">{account.account_type}</span>
                      )}
                      {account.account_subtype && account.account_subtype !== "Standard" && (
                        <span className="wallet-account-subtype">{account.account_subtype}</span>
                      )}
                    </div>
                  </div>
                  <div className="wallet-account-right">
                    <span className="wallet-account-balance">${fmt(account.balance)}</span>
                    {account.id === activeAccountId && <span className="wallet-active-dot" title="Active" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Total Summary */}
        <div className="wallet-total-section">
          <div className="wallet-total-row">
            <span>Wallet Total</span>
            <strong>${fmt(walletBalance)}</strong>
          </div>
          <div className="wallet-total-row">
            <span>Trading Total</span>
            <strong>${fmt(tradingBalance)}</strong>
          </div>
          <div className="wallet-total-row wallet-total-main">
            <span>Combined Balances</span>
            <strong className="wallet-total-highlight">${fmt(visibleBalance)}</strong>
          </div>
        </div>

        {/* Transfer Action Button */}
        {allTransferrable.length >= 2 && (
          <button
            className="wallet-transfer-btn active"
            onClick={() => setShowTransfer((prev) => !prev)}
            title="Transfer funds between wallets and trading accounts"
          >
            <IconSwitch2 size={16} />
            {showTransfer ? "Hide Transfer Menu" : "Transfer Funds"}
          </button>
        )}

        {/* Transfer Modal / Drawer */}
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
                <IconCheck size={16} /> Transfer completed successfully!
              </div>
            )}
            {transferError && (
              <div className="wallet-transfer-error">
                <IconAlertCircle size={16} /> {transferError}
              </div>
            )}

            <div className="wallet-transfer-form">
              <p className="wallet-transfer-error" role="status">
                Transfers are disabled until the route performs Deriv&apos;s required validation. Options accounts are not interchangeable with MT5/cTrader platform accounts.
              </p>
              <label>From</label>
              <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}>
                {allTransferrable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} (${fmt(a.balance)})
                  </option>
                ))}
              </select>

              <div className="wallet-transfer-arrow">
                <IconArrowRight size={16} />
              </div>

              <label>To</label>
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                {allTransferrable.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.id === transferFrom}>
                    {a.label} (${fmt(a.balance)})
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label>Amount</label>
                {selectedFromAccount && typeof selectedFromAccount.balance === "number" && (
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-color, #2563eb)",
                      fontSize: "12px",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    onClick={() => setTransferAmount(String(selectedFromAccount.balance))}
                  >
                    Max (${fmt(selectedFromAccount.balance)})
                  </button>
                )}
              </div>

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
                disabled
                title="Transfer validation is being configured"
              >
                Transfer validation required
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
