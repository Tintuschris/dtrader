/**
 * Shared formatting utilities used across the app.
 * Centralizes wallet balance, currency, and time formatting.
 */

export function fmt(n: number | string | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtCurrency(
  n: number | string | null | undefined,
  currency: string,
): string {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const val = Number(n);
  if (currency === "USD" || currency === "USDT") return `$${fmt(val)}`;
  return `${fmt(val)} ${currency}`;
}

export function timeAgo(dateStr: string): string {
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

/** Format a contract type code to a human-readable label. */
export function formatContractType(type: string): string {
  const map: Record<string, string> = {
    DIGITOVER: "Over",
    DIGITUNDER: "Under",
    DIGITMATCH: "Match",
    DIGITDIFF: "Differs",
    DIGITEVEN: "Even",
    DIGITODD: "Odd",
  };
  return map[type] ?? type;
}
