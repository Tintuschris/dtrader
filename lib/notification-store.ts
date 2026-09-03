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


/* ------------------------------------------------------------------ */
/*  Notification settings (category + sound toggles)                   */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_SETTINGS_KEY = "dtrader_notification_settings";

export type NotificationSettings = {
  tradeResults: boolean;
  balanceChanges: boolean;
  priceAlerts: boolean;
  riskWarnings: boolean;
  soundEnabled: boolean;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  tradeResults: true,
  balanceChanges: true,
  priceAlerts: true,
  riskWarnings: true,
  soundEnabled: true,
};

const SETTING_KEYS: (keyof NotificationSettings)[] = [
  "tradeResults",
  "balanceChanges",
  "priceAlerts",
  "riskWarnings",
  "soundEnabled",
];

/**
 * Merge a stored payload over the defaults, keeping only boolean values for
 * known keys. Corrupt JSON simply yields the defaults.
 */
export function parseNotificationSettings(raw: string | null | undefined): NotificationSettings {
  const out: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return out;
    for (const key of SETTING_KEYS) {
      if (typeof parsed[key] === "boolean") out[key] = parsed[key] as boolean;
    }
  } catch {
    // corrupt payload -> defaults
  }
  return out;
}

export function loadNotificationSettings(storage: StorageLike): NotificationSettings {
  if (!storage) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  try {
    return parseNotificationSettings(storage.getItem(NOTIFICATION_SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

export function saveNotificationSettings(
  storage: StorageLike,
  settings: NotificationSettings,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Price alerts (one-shot, per market, crossed on live/simulated tick)*/
/* ------------------------------------------------------------------ */

export const PRICE_ALERT_STORAGE_KEY = "dtrader_price_alerts";
export const PRICE_ALERT_CAP = 20;

export type PriceAlert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  price: number;
  createdAt: number;
};

export function isPriceAlert(v: unknown): v is PriceAlert {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.symbol === "string" &&
    (o.direction === "above" || o.direction === "below") &&
    typeof o.price === "number" &&
    Number.isFinite(o.price) &&
    o.price > 0 &&
    typeof o.createdAt === "number"
  );
}

export function parsePriceAlerts(raw: string | null | undefined): PriceAlert[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPriceAlert).slice(0, PRICE_ALERT_CAP);
  } catch {
    return [];
  }
}

export function loadPriceAlerts(storage: StorageLike): PriceAlert[] {
  if (!storage) return [];
  try {
    return parsePriceAlerts(storage.getItem(PRICE_ALERT_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function savePriceAlerts(storage: StorageLike, alerts: PriceAlert[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PRICE_ALERT_STORAGE_KEY, JSON.stringify(alerts.slice(0, PRICE_ALERT_CAP)));
    return true;
  } catch {
    return false;
  }
}
