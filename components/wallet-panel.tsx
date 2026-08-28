"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountInfo } from "./use-deriv-ws";
import {
  IconWallet,
  IconArrowRight,
  IconRefresh,
  IconX,
  IconSwitch2,
  IconCheck,
  IconAlertCircle,
  IconHistory,
  IconReceipt,
  IconChevronDown,
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
  account_type?: string;
  account_subtype?: string;
  is_wallet?: boolean;
};

export type WalletBalance = {
  id: string;
  walletType: string;
  currency: string;
  balance: number | null;
};

type TransferPreview = {
  mode: "preview";
  is_valid: boolean;
  source_currency: string;
  destination_currency: string;
  amount: string;
  fee: string;
  net_amount: string;
  estimated_destination_amount: string;
  exchange_rate?: string;
  rate_token?: string;
  error?: string;
};

type TransferResult = {
  mode: "executed";
  success: boolean;
  request_id: string;
  status: string;
};

type Transaction = {
  transaction_id: string;
  amount: string;
  currency: string;
  balance_after: string;
  description: string;
  category: string;
  channel: string;
  created_at: string;
  request_id?: string;
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

function fmtCurrency(n: number | string | null | undefined, currency: string) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const val = Number(n);
  if (currency === "USD" || currency === "USDT") return `$${fmt(val)}`;
  return `${fmt(val)} ${currency}`;
}

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
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
  const [refreshing, setRefreshing] = useState(false);

  // Balances state
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [platformAccounts, setPlatformAccounts] = useState<AccountBalance[]>([]);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Transfer state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [transferPreview, setTransferPreview] = useState<TransferPreview | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Exchange rate state
  const [exchangeRate, setExchangeRate] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const rateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transactions state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txWalletType, setTxWalletType] = useState("main");
  const [txHasMore, setTxHasMore] = useState(false);

  /* ── Fetch balances ──────────────────────────────────────────── */

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
        if (walletRes.ok) setWallets(data.wallets ?? []);
        else errors.push(data.error ?? "Unable to load wallets");
      } else {
        errors.push("Unable to reach the wallet service");
      }

      if (balancesRes) {
        const data = (await balancesRes.json().catch(() => ({}))) as { accounts?: AccountBalance[]; error?: string };
        if (balancesRes.ok) setPlatformAccounts(data.accounts ?? []);
        else errors.push(data.error ?? "Unable to load Options trading accounts");
      } else {
        errors.push("Unable to reach the trading-account service");
      }

      if (errors.length > 0) setWalletError(errors.join(". "));
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Unable to load balances");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchBalances(); }, [fetchBalances]);

  /* ── Fetch transactions ──────────────────────────────────────── */

  const fetchTransactions = useCallback(async (walletType: string, append = false) => {
    setTxLoading(true);
    setTxError(null);
    try {
      const res = await fetch(`/api/deriv/transactions?walletType=${encodeURIComponent(walletType)}&limit=50`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { transactions?: Transaction[]; error?: string; links?: { next?: string } };
      if (!res.ok) {
        setTxError(data.error ?? "Unable to load transactions");
        return;
      }
      if (append) {
        setTransactions((prev) => [...prev, ...(data.transactions ?? [])]);
      } else {
        setTransactions(data.transactions ?? []);
      }
      setTxHasMore(!!data.links?.next);
    } catch {
      setTxError("Unable to load transactions");
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "transactions") void fetchTransactions(txWalletType);
  }, [activeTab, txWalletType, fetchTransactions]);

  /* ── Live exchange rate ──────────────────────────────────────── */

  useEffect(() => {
    if (rateTimerRef.current) clearTimeout(rateTimerRef.current);

    const fromAcct = allTransferrable.find((a) => a.id === transferFrom);
    const toAcct = allTransferrable.find((a) => a.id === transferTo);

    if (!fromAcct || !toAcct || fromAcct.currency === toAcct.currency) {
      setExchangeRate(null);
      return;
    }

    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      setExchangeRate(null);
      return;
    }

    rateTimerRef.current = setTimeout(() => {
      setRateLoading(true);
      fetch(`/api/deriv/exchange-rate?from=${fromAcct.currency}&to=${toAcct.currency}`)
        .then((r) => r.json())
        .then((data: { exchange_rate?: string }) => {
          setExchangeRate(data.exchange_rate ?? null);
        })
        .catch(() => setExchangeRate(null))
        .finally(() => setRateLoading(false));
    }, 500);

    return () => { if (rateTimerRef.current) clearTimeout(rateTimerRef.current); };
  }, [transferFrom, transferTo, transferAmount]);

  /* ── Derived state ───────────────────────────────────────────── */

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
      list.push({ id: a.id || a.loginid, label: `${a.type === "real" ? "Real" : "Demo"} (${a.account_type || "Options"}) · ${a.id}`, currency: a.currency, balance: a.balance ?? null });
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
  const isCrossCurrency = selectedFromAccount && selectedToAccount && selectedFromAccount.currency !== selectedToAccount.currency;

  const walletBalance = wallets.reduce((sum, w) => sum + (w.balance ?? 0), 0);
  const tradingBalance = tradingAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const visibleBalance = walletBalance + tradingBalance;

  /* ── Transfer: validate (preview) ────────────────────────────── */

  const handleValidate = useCallback(async () => {
    if (!transferFrom || !transferTo || !transferAmount) return;
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) { setTransferError("Enter a valid transfer amount"); return; }

    setTransferLoading(true);
    setTransferError(null);
    setTransferPreview(null);
    setShowConfirm(false);
    try {
      const res = await fetch("/api/deriv/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: transferFrom, to: transferTo, amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTransferError(data.error ?? "Transfer validation failed");
        return;
      }
      setTransferPreview(data as TransferPreview);
      setShowConfirm(true);
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : String(e));
    } finally {
      setTransferLoading(false);
    }
  }, [transferFrom, transferTo, transferAmount]);

  /* ── Transfer: confirm (execute) ─────────────────────────────── */

  const handleConfirm = useCallback(async () => {
    if (!transferFrom || !transferTo || !transferAmount) return;
    const amount = parseFloat(transferAmount);
    setTransferLoading(true);
    setTransferError(null);
    try {
      const res = await fetch("/api/deriv/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: transferFrom, to: transferTo, amount, confirm: true }),
      });
      const data = (await res.json()) as TransferResult | { error?: string };
      if (!res.ok) {
        setTransferError((data as { error?: string }).error ?? "Transfer failed");
        setShowConfirm(false);
        return;
      }
      setTransferSuccess(true);
      setShowConfirm(false);
      setTransferPreview(null);
      setTransferAmount("");
      await fetchBalances();
      setTimeout(() => setTransferSuccess(false), 4000);
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : String(e));
      setShowConfirm(false);
    } finally {
      setTransferLoading(false);
    }
  }, [transferFrom, transferTo, transferAmount, fetchBalances]);

  /* ── Reset transfer state ────────────────────────────────────── */

  const resetTransfer = useCallback(() => {
    setShowConfirm(false);
    setTransferPreview(null);
    setTransferError(null);
    setTransferSuccess(false);
    setTransferAmount("");
    setExchangeRate(null);
  }, []);

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
            <button className="wallet-icon-btn" onClick={() => void fetchBalances()} disabled={refreshing} title="Refresh balances">
              <IconRefresh size={16} className={refreshing ? "spin" : ""} />
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
                {tradingAccounts.length === 0 && refreshing ? (
                  <div className="wallet-loading">Loading platform accounts…</div>
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
                    <select value={transferFrom} onChange={(e) => { setTransferFrom(e.target.value); setExchangeRate(null); }}>
                      {allTransferrable.map((a) => (
                        <option key={a.id} value={a.id}>{a.label} (${fmt(a.balance)})</option>
                      ))}
                    </select>

                    <div className="wallet-transfer-arrow"><IconArrowRight size={16} /></div>

                    <label>To</label>
                    <select value={transferTo} onChange={(e) => { setTransferTo(e.target.value); setExchangeRate(null); }}>
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
              <button className="wallet-icon-btn" onClick={() => void fetchTransactions(txWalletType)} disabled={txLoading} title="Refresh">
                <IconRefresh size={14} className={txLoading ? "spin" : ""} />
              </button>
            </div>

            {txError && (
              <div className="wallet-transfer-error" style={{ marginBottom: 8 }}><IconAlertCircle size={14} /> {txError}</div>
            )}

            {txLoading && transactions.length === 0 && (
              <div className="wallet-loading">Loading transactions…</div>
            )}

            {!txLoading && transactions.length === 0 && !txError && (
              <div className="wallet-empty">No transactions found for this wallet.</div>
            )}

            {transactions.map((tx) => {
              const amountNum = Number(tx.amount);
              const isPositive = amountNum >= 0;
              return (
                <div key={tx.transaction_id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  padding: "10px 0", borderBottom: "1px solid var(--border, #222)", fontSize: 13,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                      {tx.description || tx.category}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary, #666)", marginTop: 2 }}>
                      {tx.category} · {timeAgo(tx.created_at)}
                      {tx.request_id && <span> · <code style={{ fontSize: 10 }}>{tx.request_id.slice(0, 16)}</code></span>}
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

            {txHasMore && !txLoading && (
              <button
                style={{ width: "100%", padding: "8px 0", marginTop: 8, background: "none", border: "1px solid var(--border, #333)", borderRadius: 4, color: "var(--text-secondary, #888)", cursor: "pointer", fontSize: 12 }}
                onClick={() => void fetchTransactions(txWalletType, true)}>
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
