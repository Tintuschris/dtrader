"use client";

import { useTrading } from "./trading-context";

/**
 * Persistent trading-socket status strip shown across the whole workspace
 * (mounted in the root layout shell, so it survives tab changes). The chart
 * runs on a separate public WebSocket that can look perfectly live while the
 * authenticated trading socket is down — this banner makes that state
 * impossible to miss.
 *
 * Inline styles are used deliberately so this component has zero dependency
 * on globals.css (which carries unrelated uncommitted edits).
 */

type BannerStyle = { bg: string; border: string; dot: string; label: string; text: string };

const STATE_STYLES: Record<string, BannerStyle> = {
  connected: { bg: "#0d1f16", border: "#22c55e", dot: "#22c55e", label: "Live", text: "#4ade80" },
  reconnecting: { bg: "#2a1f0b", border: "#f59e0b", dot: "#f59e0b", label: "Reconnecting", text: "#fbbf24" },
  disconnected: { bg: "#291516", border: "#ef4444", dot: "#ef4444", label: "Offline", text: "#f87171" },
  connecting: { bg: "#141a24", border: "#64748b", dot: "#94a3b8", label: "Connecting", text: "#94a3b8" },
  authenticating: { bg: "#141a24", border: "#64748b", dot: "#94a3b8", label: "Authenticating", text: "#94a3b8" },
  error: { bg: "#2a1214", border: "#ef4444", dot: "#ef4444", label: "Error", text: "#f87171" },
};

const MAX_RECONNECT_ATTEMPTS = 10; // must match MAX_RECONNECT_ATTEMPTS in use-deriv-ws.ts

export default function TradingStatusBanner() {
  const { connectionStatus, reconnectAttempt, activeAccount, activeAccountId, lastError } = useTrading();
  // Before any account is activated (first paint) the hook's initial state is
  // "disconnected" — show that as a neutral "connecting" rather than a scary
  // offline alarm.
  const effectiveStatus =
    connectionStatus === "disconnected" && !activeAccountId ? "connecting" : connectionStatus;
  const s = STATE_STYLES[effectiveStatus] ?? STATE_STYLES.disconnected;

  let message: string;
  switch (effectiveStatus) {
    case "connected":
      message = `Trading connection live${activeAccount ? ` · ${activeAccount.type === "real" ? "Real" : "Demo"} account` : ""}`;
      break;
    case "reconnecting":
      message = `Trading connection interrupted — reconnecting (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})…`;
      break;
    case "disconnected":
      message = "Trading connection offline — trades cannot be placed";
      break;
    case "connecting":
      message = "Connecting to Deriv…";
      break;
    case "authenticating":
      message = "Authenticating with Deriv…";
      break;
    default:
      message = lastError ?? "Trading connection failed";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 14px",
        background: s.bg,
        borderBottom: `1px solid ${s.border}`,
        fontSize: 12,
        lineHeight: 1.4,
        color: s.text,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: s.dot,
          flexShrink: 0,
        }}
      />
      <strong
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 11,
          color: s.dot,
          flexShrink: 0,
        }}
      >
        {s.label}
      </strong>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {message}
      </span>
    </div>
  );
}
