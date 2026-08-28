"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountInfo } from "./use-deriv-ws";
import { useWallets, usePlatformAccounts, useTransactions, useTransfer, useExchangeRate } from "./use-deriv-data";
import type { WalletBalance, AccountBalance, Transaction, TransferPreview } from "./use-deriv-data";
import {
  IconWallet,
  IconArrowRight,
  IconRefresh,
  IconX,
  IconSwitch2,
  IconCheck,
  IconAlertCircle,
  IconReceipt,
} from "@tabler/icons-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

function fmtCurrency(n: number | string | null | undefined, currency: string) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const val = Number(n);
  if (currency === "USD" || currency === "USDT") return `$${fmt(val)}`;
  return `${fmt(val)} ${currency}`;
}

function timeAgo(dateStr: string) {
  if (!dateStr) return "—";
  let timestamp: number;
  if (/^\d+$/.test(dateStr.trim())) {
    const num = Number(dateStr);
    timestamp = num > 1e12 ? num : num * 1000;
  } else {
    timestamp = new Date(dateStr).getTime();
  }
  if (Number.isNaN(timestamp) || timestamp <= 0) return "—";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 0) return "just now";
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

type Tab = "balances" | "transactions";

/* ------------------------------------------------------------------ */
/*  Skeleton Components                                                */
/* ------------------------------------------------------------------ */

function WalletSkeleton() {
  return (
    <div className="wallet-skeleton">
      {[1, 2].map((i) => (
        <div key={i} className="wallet-skeleton-row" style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
          borderBottom: "1px solid var(--border, #222)",
        }}>
          <div style={{ width: 50, height: 16, borderRadius: 4, background: "rgba(255,255,255,.06)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: "60%", height: 14, borderRadius: 4, background: "rgba(255,255,255,.06)", marginBottom: 4 }} />
            <div style={{ width: "30%", height: 10, borderRadius: 4, background: "rgba(255,255,255,.04)" }} />
          </div>
          <div style={{ width: 60, height: 16, borderRadius: 4, background: "rgba(255,255,255,.06)" }} />
        </div>
      ))}
    </div>
  );
}

function TransactionSkeleton() {
  return (
    <div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          padding: "10px 0", borderBottom: "1px solid var(--border, #222)", fontSize: 13,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ width: "70%", height: 14, borderRadius: 4, background: "rgba(255,255,255,.06)", marginBottom: 6 }} />
            <div style={{ width: "40%", height: 10, borderRadius: 4, background: "rgba(255,255,255,.04)" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ width: 50, height: 14, borderRadius: 4, background: "rgba(255,255,255,.06)", marginBottom: 6 }} />
            <div style={{ width: 40, height: 10, borderRadius: 4, background: "rgba(255,255,255,.04)" }} />
          </div>
        </div>
      ))}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<Tab>("balances");

  // React Query hooks for data
  const { data: wallets = [], isLoading: walletsLoading, error: walletsError, refetch: refetchWallets } = useWallets();
  const { data: platformAccounts = [], isLoading: accountsLoading } = usePlatformAccounts();

  // Transfer state (local UI)
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferPreview, setTransferPreview] = useState<TransferPreview | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [transferSuccess, setTransferSuccess] = useState(false);

  // Transfer mutations
  const { validate: validateMutation, execute: executeMutation } = useTransfer();

  // Transactions
  const [txWalletType, setTxWalletType] = useState("main");
  const { transactions, isLoading: txLoading, error: txError, hasMore, loadMore, refetch: refetchTx } = useTransactions(txWalletType, activeTab === "transactions");

  /* ── Derived state ──────────────────────────────────────────── */

  const tradingAccounts: AccountBalance[] = useMemo(() => {
    const map = new Map<string, AccountBalance>();
    for (const a of platformAccounts) map.set(a.id || a.loginid, { ...a });
    for (const w of wsAccounts) {
      const existing = map.get(w.loginid);
      const isReal = w.account_type.toLowerCase().includes("real") || !w.loginid.startsWith("VR");
      if (existing) {
        if (w.loginid === activeAccountId && activeBalance !== null) existing.balance = activeBalance;
      } else {
        map.set(w.loginid, {
          id: w.loginid, loginid: w.loginid, type: isReal ? "real" : "demo",
          currency: w.currency || "USD",
          balance: w.loginid === activeAccountId ? activeBalance : null,
          account_type: w.landing_company_name || w.trading_type || "Options",
          is_wallet: false,
        });
      }
    }
    return Array.from(map.values()).filter((a) => !a.is_wallet);
  }, [platformAccounts, wsAccounts, activeAccountId, activeBalance]);

  const allTransferrable = useMemo(() => {
    const list: Array<{ id: string; label: string; currency: string; balance: number | null }> = [];
    for (const w of wallets) {
      const walletId = w.id.includes(":") ? w.id.split(":")[0] : w.id;
      list.push({ id: walletId, label: `Wallet (${w.walletType}) · ${w.currency}`, currency: w.currency, balance: w.balance });
    }
    for (const a of tradingAccounts) {
      if (a.type === "real") {
        list.push({ id: a.id || a.loginid, label: `${a.account_type || "Options"} · ${a.id}`, currency: a.currency, balance: a.balance ?? null });
      }
    }
    return list;
  }, [wallets, tradingAccounts]);

  useEffect(() => {
    if (allTransferrable.length >= 2) {
      if (!transferFrom || !allTransferrable.some((a) => a.id === transferFrom)) setTransferFrom(allTransferrable[0].id);
      if (!transferTo || !allTransferrable.some((a) => a.id === transferTo) || transferTo === allTransferrable[0]?.id) setTransferTo(allTransferrable[1]?.id ?? allTransferrable[0]?.id);
    }
  }, [allTransferrable, transferFrom, transferTo]);

  const selectedFromAccount = useMemo(() => allTransferrable.find((a) => a.id === transferFrom), [allTransferrable, transferFrom]);
  const selectedToAccount = useMemo(() => allTransferrable.find((a) => a.id === transferTo), [allTransferrable, transferTo]);

  // Exchange rate (must be after allTransferrable is defined)
  const isCrossCurrency = selectedFromAccount && selectedToAccount && selectedFromAccount.currency !== selectedToAccount.currency;
  const { data: exchangeRate, isLoading: rateLoading } = useExchangeRate(
    selectedFromAccount?.currency ?? "",
    selectedToAccount?.currency ?? "",
    isCrossCurrency && !!transferAmount && parseFloat(transferAmount) > 0,
  );

  const walletBalance = wallets.reduce((sum, w) => sum + (w.balance ?? 0), 0);
  const tradingBalance = tradingAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const visibleBalance = walletBalance + tradingBalance;

  /* ── Transfer handlers ──────────────────────────────────────── */

  const handleValidate = useCallback(async () => {
    if (!transferFrom || !transferTo || !transferAmount) return;
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      const result = await validateMutation.mutateAsync({ from: transferFrom, to: transferTo, amount });
      setTransferPreview(result);
      setShowConfirm(true);
    } catch {
      // Error is in validateMutation.error
    }
  }, [transferFrom, transferTo, transferAmount, validateMutation]);

  const handleConfirm = useCallback(async () => {
    if (!transferFrom || !transferTo || !transferAmount) return;
    const amount = parseFloat(transferAmount);

    try {
      await executeMutation.mutateAsync({ from: transferFrom, to: transferTo, amount });
      setTransferSuccess(true);
      setShowConfirm(false);
      setTransferPreview(null);
      setTransferAmount("");
      setTimeout(() => setTransferSuccess(false), 4000);
    } catch {
      // Error is in executeMutation.error
      setShowConfirm(false);
    }
  }, [transferFrom, transferTo, transferAmount, executeMutation]);

  const resetTransfer = useCallback(() => {
    setShowConfirm(false);
    setTransferPreview(null);
    setTransferSuccess(false);
    setTransferAmount("");
    validateMutation.reset();
    executeMutation.reset();
  }, [validateMutation, executeMutation]);

  const transferError = validateMutation.error?.message ?? executeMutation.error?.message ?? null;
  const transferLoading = validateMutation.isPending || executeMutation.isPending;

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <>
      <div className="wallet-panel-overlay" onClick={onClose} />
      <div className="wallet-panel">
        {/* Header */}
        <div className="wallet-panel-header">
          <div className="wallet-panel-title">
            <IconWallet size={18} />
            <span>Wallet & Accounts</span>
          </div>
          <div className="wallet-panel-actions">
            <button className="wallet-icon-btn" onClick={() => { void refetchWallets(); }} disabled={walletsLoading} title="Refresh balances">
              <IconRefresh size={16} className={walletsLoading ? "spin" : ""} />
            </button>
            <button className="wallet-icon-btn" onClick={onClose}><IconX size={16} /></button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="wallet-tabs" style={{ display: "flex", borderBottom: "1px solid var(--border, #333)", marginBottom: 8 }}>
          <button
            style={{
              flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: activeTab === "balances" ? "2px solid var(--accent-color, #2563eb)" : "2px solid transparent",
              color: activeTab === "balances" ? "var(--text-primary, #fff)" : "var(--text-secondary, #888)", cursor: "pointer", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
            onClick={() => setActiveTab("balances")}
          >
            <IconWallet size={14} /> Balances
          </button>
          <button
            style={{
              flex: 1, padding: "8px 0", background: "none", border: "none", borderBottom: activeTab === "transactions" ? "2px solid var(--accent-color, #2563eb)" : "2px solid transparent",
              color: activeTab === "transactions" ? "var(--text-primary, #fff)" : "var(--text-secondary, #888)", cursor: "pointer", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
            onClick={() => setActiveTab("transactions")}
          >
            <IconReceipt size={14} /> Transactions
          </button>
        </div>

        {/* ═══ BALANCES TAB ═══ */}
        {activeTab === "balances" && (
          <div style={{ overflowY: "auto", flex: 1 }}>
            {/* Main Wallets */}
            <div className="wallet-section">
              <div className="wallet-section-title">Main Wallets</div>
              {walletsError ? (
                <div className="wallet-empty">{walletsError.message}</div>
              ) : walletsLoading ? (
                <WalletSkeleton />
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
                      <span className="wallet-account-balance wallet-balance-highlight">${fmt(wallet.balance)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Trading Accounts */}
            <div className="wallet-section">
              <div className="wallet-section-title">Options Trading Accounts</div>
              <div className="wallet-accounts">
                {accountsLoading ? (
                  <WalletSkeleton />
                ) : tradingAccounts.length === 0 ? (
                  <div className="wallet-empty">No trading accounts found.</div>
                ) : (
                  tradingAccounts.map((account) => (
                    <div key={account.id} className={`wallet-account ${account.id === activeAccountId ? "active" : ""}`}
                      onClick={() => onSelectAccount({ id: account.id, type: account.type, currency: account.currency, balance: account.balance ?? undefined })}
                    >
                      <div className="wallet-account-left">
                        <span className={`wallet-type-badge ${account.type}`}>{account.type === "real" ? "REAL" : "DEMO"}</span>
                        <div className="wallet-account-info">
                          <span className="wallet-account-id">{account.id}</span>
                          <span className="wallet-account-currency">{account.currency}</span>
                          {account.account_type && <span className="wallet-account-type">{account.account_type}</span>}
                          {account.account_subtype && account.account_subtype !== "Standard" && <span className="wallet-account-subtype">{account.account_subtype}</span>}
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

            {/* Totals */}
            <div className="wallet-total-section">
              <div className="wallet-total-row"><span>Wallet Total</span><strong>${fmt(walletBalance)}</strong></div>
              <div className="wallet-total-row"><span>Trading Total</span><strong>${fmt(tradingBalance)}</strong></div>
              <div className="wallet-total-row wallet-total-main">
                <span>Combined Balances</span>
                <strong className="wallet-total-highlight">${fmt(visibleBalance)}</strong>
              </div>
            </div>

            {/* Transfer button */}
            {allTransferrable.length >= 2 && (
              <button className="wallet-transfer-btn active" onClick={() => { setShowTransfer((p) => !p); if (showTransfer) resetTransfer(); }}
                title="Transfer funds between wallets and trading accounts">
                <IconSwitch2 size={16} />
                {showTransfer ? "Hide Transfer Menu" : "Transfer Funds"}
              </button>
            )}

            {/* Transfer form */}
            {showTransfer && (
              <div className="wallet-transfer">
                <div className="wallet-transfer-header">
                  <span>{showConfirm ? "Confirm Transfer" : "Transfer Funds"}</span>
                  <button className="wallet-icon-btn" onClick={resetTransfer}><IconX size={14} /></button>
                </div>

                {transferSuccess && (
                  <div className="wallet-transfer-success"><IconCheck size={16} /> Transfer completed successfully!</div>
                )}
                {transferError && (
                  <div className="wallet-transfer-error"><IconAlertCircle size={16} /> {transferError}</div>
                )}

                {/* Confirmation dialog */}
                {showConfirm && transferPreview ? (
                  <div className="wallet-transfer-form" style={{ fontSize: 13 }}>
                    <div style={{ background: "var(--bg-secondary, #1a1a2e)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-secondary, #888)" }}>From</span>
                        <span style={{ fontWeight: 500 }}>{selectedFromAccount?.label ?? transferFrom}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-secondary, #888)" }}>To</span>
                        <span style={{ fontWeight: 500 }}>{selectedToAccount?.label ?? transferTo}</span>
                      </div>
                      <div style={{ borderTop: "1px solid var(--border, #333)", paddingTop: 8, marginTop: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: "var(--text-secondary, #888)" }}>Amount</span>
                          <span>{fmtCurrency(transferPreview.amount, transferPreview.source_currency)}</span>
                        </div>
                        {Number(transferPreview.fee) > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ color: "var(--text-secondary, #888)" }}>Fee</span>
                            <span style={{ color: "var(--warning-color, #f59e0b)" }}>-{fmtCurrency(transferPreview.fee, transferPreview.source_currency)}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: "var(--text-secondary, #888)" }}>You send</span>
                          <span style={{ fontWeight: 600 }}>{fmtCurrency(transferPreview.net_amount, transferPreview.source_currency)}</span>
                        </div>
                        {transferPreview.exchange_rate && (
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ color: "var(--text-secondary, #888)" }}>Exchange Rate</span>
                            <span>1 {transferPreview.source_currency} = {Number(transferPreview.exchange_rate).toFixed(6)} {transferPreview.destination_currency}</span>
                          </div>
                        )}
                        {transferPreview.estimated_destination_amount && transferPreview.source_currency !== transferPreview.destination_currency && (
                          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, borderTop: "1px solid var(--border, #333)", marginTop: 4 }}>
                            <span style={{ color: "var(--text-secondary, #888)", fontWeight: 600 }}>You receive (est.)</span>
                            <span style={{ fontWeight: 700, color: "var(--accent-color, #2563eb)" }}>{fmtCurrency(transferPreview.estimated_destination_amount, transferPreview.destination_currency)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="wallet-transfer-submit" style={{ flex: 1 }}
                        disabled={transferLoading} onClick={() => void handleConfirm()}>
                        {transferLoading ? "Processing…" : "Confirm Transfer"}
                      </button>
                      <button className="wallet-transfer-submit" style={{ flex: 1, background: "var(--bg-secondary, #1a1a2e)", color: "var(--text-primary, #fff)" }}
                        onClick={() => { setShowConfirm(false); setTransferPreview(null); }}>
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Transfer form */
                  <div className="wallet-transfer-form">
                    {/* Live exchange rate banner */}
                    {isCrossCurrency && (
                      <div style={{ fontSize: 12, color: "var(--text-secondary, #888)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        <IconSwitch2 size={12} />
                        {rateLoading ? (
                          <span>Fetching exchange rate…</span>
                        ) : exchangeRate ? (
                          <span>
                            Live rate: 1 {selectedFromAccount!.currency} = {Number(exchangeRate).toFixed(6)} {selectedToAccount!.currency}
                          </span>
                        ) : (
                          <span>Cross-currency — exchange rate will be applied at validation.</span>
                        )}
                      </div>
                    )}

                    <label>From</label>
                    <select value={transferFrom} onChange={(e) => { setTransferFrom(e.target.value); }}>
                      {allTransferrable.map((a) => (
                        <option key={a.id} value={a.id}>{a.label} (${fmt(a.balance)})</option>
                      ))}
                    </select>

                    <div className="wallet-transfer-arrow"><IconArrowRight size={16} /></div>

                    <label>To</label>
                    <select value={transferTo} onChange={(e) => { setTransferTo(e.target.value); }}>
                      {allTransferrable.map((a) => (
                        <option key={a.id} value={a.id} disabled={a.id === transferFrom}>{a.label} (${fmt(a.balance)})</option>
                      ))}
                    </select>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label>Amount</label>
                      {selectedFromAccount && typeof selectedFromAccount.balance === "number" && (
                        <button type="button"
                          style={{ background: "none", border: "none", color: "var(--accent-color, #2563eb)", fontSize: 12, cursor: "pointer", padding: 0 }}
                          onClick={() => setTransferAmount(String(selectedFromAccount.balance))}>
                          Max (${fmt(selectedFromAccount.balance)})
                        </button>
                      )}
                    </div>

                    <div className="wallet-transfer-amount">
                      <span>{selectedFromAccount?.currency === "USD" || !selectedFromAccount ? "$" : selectedFromAccount.currency + " "}</span>
                      <input type="number" min="0.01" step="0.01" placeholder="0.00" value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)} />
                    </div>

                    <button className="wallet-transfer-submit"
                      disabled={transferLoading || !transferFrom || !transferTo || !transferAmount || parseFloat(transferAmount) <= 0}
                      onClick={() => void handleValidate()}>
                      {transferLoading ? "Validating…" : "Review Transfer"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ TRANSACTIONS TAB ═══ */}
        {activeTab === "transactions" && (
          <div style={{ overflowY: "auto", flex: 1, padding: "0 12px" }}>
            {/* Wallet type selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, marginTop: 4 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary, #888)" }}>Wallet:</label>
              <select value={txWalletType} onChange={(e) => setTxWalletType(e.target.value)}
                style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border, #333)", background: "var(--bg-secondary, #1a1a2e)", color: "var(--text-primary, #fff)", fontSize: 12 }}>
                {wallets.length === 0 ? (
                  <option value="main">Main</option>
                ) : (
                  [...new Set(wallets.map((w) => w.walletType))].map((wt) => (
                    <option key={wt} value={wt}>{wt}</option>
                  ))
                )}
              </select>
              <button className="wallet-icon-btn" onClick={() => void refetchTx()} disabled={txLoading} title="Refresh">
                <IconRefresh size={14} className={txLoading ? "spin" : ""} />
              </button>
            </div>

            {txError && (
              <div className="wallet-transfer-error" style={{ marginBottom: 8 }}><IconAlertCircle size={14} /> {txError.message}</div>
            )}

            {txLoading && transactions.length === 0 && (
              <TransactionSkeleton />
            )}

            {!txLoading && transactions.length === 0 && !txError && (
              <div className="wallet-empty">No transactions found for this wallet.</div>
            )}

            {transactions.map((tx) => {
              const amountNum = Number(tx.amount);
              const isPositive = amountNum >= 0;
              const displayLabel = tx.description
                || (tx.category ? tx.category.charAt(0).toUpperCase() + tx.category.slice(1).replace(/_/g, " ") : "Transaction");
              return (
                <div key={tx.transaction_id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  padding: "10px 0", borderBottom: "1px solid var(--border, #222)", fontSize: 13,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                      {displayLabel}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary, #666)", marginTop: 2 }}>
                      {tx.category && <span>{tx.category.replace(/_/g, " ")} · </span>}
                      {timeAgo(tx.created_at)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 600, color: isPositive ? "var(--success-color, #22c55e)" : "var(--error-color, #ef4444)" }}>
                      {isPositive ? "+" : ""}{fmtCurrency(tx.amount, tx.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary, #666)" }}>
                      bal: {fmtCurrency(tx.balance_after, tx.currency)}
                    </div>
                  </div>
                </div>
              );
            })}

            {hasMore && !txLoading && (
              <button
                style={{ width: "100%", padding: "8px 0", marginTop: 8, background: "none", border: "1px solid var(--border, #333)", borderRadius: 4, color: "var(--text-secondary, #888)", cursor: "pointer", fontSize: 12 }}
                onClick={() => void loadMore()}>
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
