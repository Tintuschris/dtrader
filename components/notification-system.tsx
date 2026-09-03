"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconBell,
  IconX,
  IconCheck,
  IconAlertTriangle,
  IconInfoCircle,
  IconTrendingUp,
  IconTrendingDown,
  IconCurrencyDollar,
  IconTarget,
  IconClock,
} from "@tabler/icons-react";
import {
  loadNotifications,
  saveNotifications,
  numericId,
  NOTIFICATION_CAP,
} from "../lib/notification-store";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NotificationType = "trade" | "balance" | "alert" | "risk" | "system";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  profit?: number;
  severity?: "info" | "success" | "warning" | "error";
  action?: {
    type: "scanner-trade";
    symbol: string;
    rule: "under8" | "over1";
    /** Timestamp of the scanner tick that caused this alert. */
    firedAt?: number;
  };
};

export type { NotificationSettings } from "../lib/notification-store";

/* ------------------------------------------------------------------ */
/*  Internal state (singleton)                                         */
/* ------------------------------------------------------------------ */

let globalNotifications: Notification[] = [];
let globalListeners: Set<() => void> = new Set();
let nextId = 1;
let hydrated = false;
let toastFloorId = 0; // persisted items at/below this id must never replay as toasts

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null; // SSR / tests
  try {
    return window.localStorage;
  } catch {
    return null; // storage disabled (private mode / permissions)
  }
}

/**
 * Load the persisted feed once, after mount. Runs lazily (never at module
 * import) so SSR renders the same empty state as the first client paint,
 * and the bell panel is only filled on a post-hydration re-render.
 */
function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  const stored = loadNotifications(getStorage());
  if (stored.length === 0) return;
  let maxId = 0;
  for (const n of stored) maxId = Math.max(maxId, numericId(n.id));
  toastFloorId = maxId;      // history fills the bell, not the toast stack
  nextId = maxId + 1;        // fresh ids continue after persisted ones
  globalNotifications = stored as Notification[];
  notify();
}

function persist() {
  saveNotifications(getStorage(), globalNotifications);
}

function notify() {
  for (const l of globalListeners) l();
}

export function pushNotification(n: Omit<Notification, "id" | "timestamp" | "read">) {
  hydrateFromStorage();
  const full: Notification = {
    ...n,
    id: `n-${nextId++}`,
    timestamp: Date.now(),
    read: false,
  };
  globalNotifications = [full, ...globalNotifications].slice(0, NOTIFICATION_CAP);
  persist();
  notify();
  return full;
}

export function markAllRead() {
  hydrateFromStorage();
  globalNotifications = globalNotifications.map((n) => ({ ...n, read: true }));
  persist();
  notify();
}

export function clearNotifications() {
  hydrateFromStorage();
  globalNotifications = [];
  persist();
  notify();
}

function useNotifications() {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const handler = () => forceUpdate((c) => c + 1);
    globalListeners.add(handler);
    hydrateFromStorage(); // notify() inside triggers forceUpdate above
    return () => { globalListeners.delete(handler); };
  }, []);
  return globalNotifications;
}

/* ------------------------------------------------------------------ */
/*  Toast component                                                    */
/* ------------------------------------------------------------------ */

function Toast({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    // Trade results are transient feedback; keep the toast brief so it does
    // not cover the trade controls during rapid one-tick trading. Other
    // notifications retain the normal reading time.
    const visibleDuration = notification.type === "trade" ? 650 : 4500;
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, visibleDuration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onDismiss]);

  const icons: Record<NotificationType, React.ReactNode> = {
    trade: notification.profit != null && notification.profit >= 0
      ? <IconTrendingUp size={16} />
      : <IconTrendingDown size={16} />,
    balance: <IconCurrencyDollar size={16} />,
    alert: <IconAlertTriangle size={16} />,
    risk: <IconAlertTriangle size={16} />,
    system: <IconInfoCircle size={16} />,
  };

  const severity = notification.severity ?? (notification.profit != null && notification.profit >= 0 ? "success" : "info");

  return (
    <div
      className={`toast ${severity} ${visible ? "toast-visible" : ""} ${notification.action ? "toast-actionable" : ""}`}
      onClick={() => {
        if (notification.action && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("dtrader:scanner-trade", { detail: notification.action }));
        }
        setVisible(false);
        setTimeout(onDismiss, 300);
      }}
    >
      <div className={`toast-icon ${severity}`}>
        {icons[notification.type]}
      </div>
      <div className="toast-body">
        <div className="toast-title">{notification.title}</div>
        <div className="toast-message">{notification.message}</div>
      </div>
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); setVisible(false); setTimeout(onDismiss, 300); }}>
        <IconX size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toast container (renders active toasts)                            */
/* ------------------------------------------------------------------ */

export function ToastContainer() {
  const [toasts, setToasts] = useState<Notification[]>([]);

  useEffect(() => {
    let lastCount = 0;
    const handler = () => {
      // Persisted history (ids <= toastFloorId) fills the bell panel but must
      // not replay as toasts after a page refresh — only genuinely new pushes
      // (ids > floor) show up in the toast stack.
      const fresh = globalNotifications.filter((n) => numericId(n.id) > toastFloorId);
      if (fresh.length > lastCount) {
        const newOnes = fresh.slice(0, fresh.length - lastCount);
        // Keep the workspace clear during bursts (for example, when several
        // scanner markets qualify together). The full history remains in the
        // notification center; only the newest four stay visible as toasts.
        setToasts((prev) => [...prev, ...newOnes].slice(-4));
      }
      lastCount = fresh.length;
    };
    globalListeners.add(handler);
    hydrateFromStorage(); // hydrate AFTER subscribing: floor filter keeps history out of toasts
    return () => { globalListeners.delete(handler); };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} notification={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notification Center (dropdown panel)                               */
/* ------------------------------------------------------------------ */

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const notifications = useNotifications();
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <div className="nc-overlay" onClick={onClose} />
      <div className="nc-panel">
        <div className="nc-header">
          <div className="nc-title">
            <IconBell size={16} />
            <span>Notifications</span>
            {unreadCount > 0 && <span className="nc-badge">{unreadCount}</span>}
          </div>
          <div className="nc-actions">
            <button className="nc-action-btn" onClick={() => markAllRead()}>
              <IconCheck size={14} /> Mark all read
            </button>
            <button className="nc-action-btn" onClick={onClose}>
              <IconX size={14} />
            </button>
          </div>
        </div>
        <div className="nc-list">
          {notifications.length === 0 ? (
            <div className="nc-empty">
              <IconBell size={32} />
              <p>No notifications yet</p>
              <span>Trade results and alerts will appear here</span>
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`nc-item ${n.read ? "" : "unread"}`}>
                <div className={`nc-item-icon ${n.severity ?? "info"}`}>
                  {n.type === "trade" && (n.profit != null && n.profit >= 0 ? <IconTrendingUp size={14} /> : <IconTrendingDown size={14} />)}
                  {n.type === "balance" && <IconCurrencyDollar size={14} />}
                  {n.type === "alert" && <IconTarget size={14} />}
                  {n.type === "risk" && <IconAlertTriangle size={14} />}
                  {n.type === "system" && <IconInfoCircle size={14} />}
                </div>
                <div className="nc-item-body">
                  <div className="nc-item-header">
                    <span className="nc-item-title">{n.title}</span>
                    <span className="nc-item-time">
                      <IconClock size={10} />
                      {formatTime(n.timestamp)}
                    </span>
                  </div>
                  <p className="nc-item-message">{n.message}</p>
                  {n.profit != null && (
                    <span className={`nc-item-profit ${n.profit >= 0 ? "positive" : "negative"}`}>
                      {n.profit >= 0 ? "+" : ""}${Math.abs(n.profit).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
