/**
 * Pure helpers for persisting the in-app notification feed to localStorage.
 *
 * Kept free of React and DOM so it can be unit-tested with injected
 * storage (mirrors lib/ws-lifecycle.ts). All reads/writes are defensive:
 * a missing, corrupt, or quota-throwing storage must never break the app.
 */

export const NOTIFICATION_STORAGE_KEY = "dtrader_notifications";
export const NOTIFICATION_CAP = 100;

export const NOTIFICATION_TYPES = [
  "trade",
  "balance",
  "alert",
  "risk",
  "system",
] as const;

export const NOTIFICATION_SEVERITIES = [
  "info",
  "success",
  "warning",
  "error",
] as const;

export type StoredNotification = {
  id: string;
  type: (typeof NOTIFICATION_TYPES)[number];
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  profit?: number;
  severity?: (typeof NOTIFICATION_SEVERITIES)[number];
};

export type StorageLike = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function isStoredNotification(v: unknown): v is StoredNotification {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.message === "string" &&
    typeof o.timestamp === "number" &&
    typeof o.read === "boolean" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(o.type as string) &&
    (o.severity === undefined ||
      (NOTIFICATION_SEVERITIES as readonly string[]).includes(o.severity as string)) &&
    (o.profit === undefined || typeof o.profit === "number")
  );
}

/**
 * Parse a raw localStorage payload into valid notifications, newest-first
 * (the feed is stored newest-first), capped at NOTIFICATION_CAP. Corrupt
 * JSON or a non-array payload yields an empty list.
 */
export function parseNotifications(raw: string | null | undefined): StoredNotification[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredNotification).slice(0, NOTIFICATION_CAP);
  } catch {
    return [];
  }
}

export function loadNotifications(storage: StorageLike): StoredNotification[] {
  if (!storage) return [];
  try {
    return parseNotifications(storage.getItem(NOTIFICATION_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveNotifications(
  storage: StorageLike,
  items: StoredNotification[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(items.slice(0, NOTIFICATION_CAP)));
    return true;
  } catch {
    return false;
  }
}

/** Numeric part of a `n-<int>` notification id; 0 for anything else. */
export function numericId(id: string): number {
  const m = /^n-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}


