"use client";

import { useCallback, useEffect, useState } from "react";
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
  balance: number | null;
};

type WalletPanelProps = {
  activeAccountId: string;
  onSelectAccount: (account: AccountBalance) => void;
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
  onSelectAccount,
  onClose,
}: WalletPanelProps) {
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);

  const fetchBalances = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/deriv/balances", { cache: "no-store" });
      const data = (await res.json()) as {
        accounts?: AccountBalance[];
        error?: string;
      };
      if (data.accounts) {
        setAccounts(data.accounts);
        // Set defaults for transfer
        if (data.accounts.length >= 2 && !transferFrom) {
          setTransferFrom(data.accounts[0].id);
          setTransferTo(data.accounts[1].id);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [transferFrom]);

  useEffect(() => {
    void fetchBalances();
  }, [fetchBalances]);

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
        await fetchBalances(true);
        setTimeout(() => setTransferSuccess(false), 3000);
      }
    } catch (e) {
      setTransferError(String(e));
    } finally {
      setTransferLoading(false);
    }
  }, [transferFrom, transferTo, transferAmount, fetchBalances]);

  const totalBalance = accounts.reduce(
    (sum, a) => sum + (a.balance ?? 0),
    0,
  );

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
              onClick={() => void fetchBalances(true)}
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

        {/* Total */}
        <div className="wallet-total">
          <span>Total Balance</span>
          <strong>${fmt(totalBalance)}</strong>
        </div>

        {/* Account list */}
        <div className="wallet-accounts">
          {loading ? (
            <div className="wallet-loading">Loading balances…</div>
          ) : accounts.length === 0 ? (
            <div className="wallet-empty">No accounts found. Log in first.</div>
          ) : (
            accounts.map((account) => (
              <div
                key={account.id}
                className={`wallet-account ${account.id === activeAccountId ? "active" : ""}`}
                onClick={() => onSelectAccount(account)}
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
                  </div>
                </div>
                <div className="wallet-account-right">
                  <span className="wallet-account-balance">
                    ${fmt(account.balance)}
                  </span>
                  {account.id === activeAccountId && (
                    <span className="wallet-active-dot" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Transfer button */}
        {accounts.length >= 2 && (
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
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type === "real" ? "Real" : "Demo"} · {a.currency} · $
                    {fmt(a.balance)}
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
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type === "real" ? "Real" : "Demo"} · {a.currency} · $
                    {fmt(a.balance)}
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
