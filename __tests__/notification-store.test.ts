/**
 * Tests for the notification persistence helpers (lib/notification-store.ts).
 *
 * Covers the "does the bell panel survive a page refresh" behavior plus the
 * failure modes that must never crash the app: corrupt payloads, missing
 * storage, and quota/private-mode write failures.
 */

import {
  NOTIFICATION_STORAGE_KEY,
  NOTIFICATION_CAP,
  NOTIFICATION_SETTINGS_KEY,
  PRICE_ALERT_STORAGE_KEY,
  PRICE_ALERT_CAP,
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotifications,
  saveNotifications,
  parseNotifications,
  isStoredNotification,
  numericId,
  loadNotificationSettings,
  saveNotificationSettings,
  parseNotificationSettings,
  loadPriceAlerts,
  savePriceAlerts,
  parsePriceAlerts,
  isPriceAlert,
  type StoredNotification,
  type PriceAlert,
} from "../lib/notification-store";

function fakeStorage(seed?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    dump: () => Object.fromEntries(store),
  };
}

const notif = (over: Partial<StoredNotification> = {}): StoredNotification => ({
  id: "n-1",
  type: "trade",
  title: "Trade Won!",
  message: "You won $0.23 on your trade!",
  timestamp: 1_000,
  read: false,
  ...over,
});

describe("saveNotifications / loadNotifications — refresh survival", () => {
  it("round-trips the feed through storage unchanged", () => {
    const storage = fakeStorage();
    const items = [
      notif({ id: "n-2", timestamp: 2000, severity: "success", profit: 0.23, read: true }),
      notif({ id: "n-1", timestamp: 1000, type: "risk", severity: "warning" }),
    ];
    expect(saveNotifications(storage, items)).toBe(true);
    const loaded = loadNotifications(storage);
    expect(loaded).toEqual(items);
    // storage uses the shared key
    expect(storage.dump()).toHaveProperty(NOTIFICATION_STORAGE_KEY);
  });

  it("keeps unread flags so the badge count survives a refresh", () => {
    const storage = fakeStorage();
    const items = [
      notif({ id: "n-2", read: false }),
      notif({ id: "n-1", read: true }),
    ];
    saveNotifications(storage, items);
    const loaded = loadNotifications(storage);
    expect(loaded.filter((n) => !n.read).map((n) => n.id)).toEqual(["n-2"]);
  });

  it("tolerates missing or corrupt stored payloads (starts empty)", () => {
    expect(loadNotifications(fakeStorage())).toEqual([]);
    expect(loadNotifications(fakeStorage({ [NOTIFICATION_STORAGE_KEY]: "not json {{" }))).toEqual([]);
    expect(loadNotifications(fakeStorage({ [NOTIFICATION_STORAGE_KEY]: '{"a":1}' }))).toEqual([]);
    expect(loadNotifications(fakeStorage({ [NOTIFICATION_STORAGE_KEY]: "[1,2,3]" }))).toEqual([]);
  });
});

describe("parseNotifications — validation", () => {
  it("drops malformed entries but keeps valid ones in order", () => {
    const raw = JSON.stringify([
      notif({ id: "n-3", timestamp: 3000 }),
      { id: "n-bad-no-title" },                    // missing fields
      { ...notif({ id: "n-4", timestamp: 4000 }), timestamp: "soon" }, // wrong type
      { ...notif({ id: "n-5" }), type: "bogus" },  // unknown type
      { ...notif({ id: "n-6" }), severity: "loud" }, // unknown severity
      { ...notif({ id: "n-7" }), profit: "free" }, // profit must be a number
      notif({ id: "n-8", timestamp: 8000 }),
    ]);
    const loaded = parseNotifications(raw);
    expect(loaded.map((n) => n.id)).toEqual(["n-3", "n-8"]);
  });

  it("caps the list at NOTIFICATION_CAP, keeping the newest (head)", () => {
    const many = Array.from({ length: NOTIFICATION_CAP + 25 }, (_, i) =>
      notif({ id: `n-${i + 1}`, timestamp: i + 1 }),
    );
    const loaded = parseNotifications(JSON.stringify(many));
    expect(loaded.length).toBe(NOTIFICATION_CAP);
    expect(loaded[0].id).toBe("n-1"); // newest-first feed keeps its head
  });

  it("caps writes at NOTIFICATION_CAP too", () => {
    const storage = fakeStorage();
    const many = Array.from({ length: NOTIFICATION_CAP + 10 }, (_, i) =>
      notif({ id: `n-${i + 1}` }),
    );
    saveNotifications(storage, many);
    const saved = JSON.parse(storage.dump()[NOTIFICATION_STORAGE_KEY]) as StoredNotification[];
    expect(saved.length).toBe(NOTIFICATION_CAP);
  });
});

describe("storage failure modes", () => {
  it("returns [] / false and never throws when storage is unavailable", () => {
    expect(loadNotifications(null)).toEqual([]);
    expect(loadNotifications(undefined)).toEqual([]);
    expect(saveNotifications(null, [notif()])).toBe(false);
  });

  it("never throws when storage writes fail (private mode / quota)", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(loadNotifications(throwing)).toEqual([]);
    expect(saveNotifications(throwing, [notif()])).toBe(false);
  });
});

describe("isStoredNotification / numericId", () => {
  it("accepts a well-formed notification and rejects junk", () => {
    expect(isStoredNotification(notif())).toBe(true);
    expect(isStoredNotification(null)).toBe(false);
    expect(isStoredNotification("n-1")).toBe(false);
    expect(isStoredNotification({ ...notif(), read: "yes" })).toBe(false);
  });

  it("parses the numeric part of n-<int> ids", () => {
    expect(numericId("n-42")).toBe(42);
    expect(numericId("n-0")).toBe(0);
    expect(numericId("n-7")).toBe(7);
    expect(numericId("junk")).toBe(0);
    expect(numericId("n--3")).toBe(0);
  });
});

describe("notification settings — parse/load/save", () => {
  it("applies defaults when nothing is stored", () => {
    expect(loadNotificationSettings(fakeStorage())).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it("round-trips a customized setting set", () => {
    const storage = fakeStorage();
    const custom = { ...DEFAULT_NOTIFICATION_SETTINGS, tradeResults: false, soundEnabled: false };
    expect(saveNotificationSettings(storage, custom)).toBe(true);
    expect(loadNotificationSettings(storage)).toEqual(custom);
    expect(storage.dump()).toHaveProperty(NOTIFICATION_SETTINGS_KEY);
  });

  it("merges partial / corrupt payloads over the defaults, ignoring junk values", () => {
    const partial = JSON.stringify({ soundEnabled: false, priceAlerts: "nope", bogus: true });
    const loaded = parseNotificationSettings(partial);
    expect(loaded.soundEnabled).toBe(false);
    expect(loaded.priceAlerts).toBe(true);   // non-boolean ignored -> default
    expect(loaded.tradeResults).toBe(true);
    expect(parseNotificationSettings("not json {{")).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseNotificationSettings('{"a":1}')).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it("never throws when storage is unavailable or write fails", () => {
    expect(loadNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(saveNotificationSettings(null, DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
    const throwing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(loadNotificationSettings(throwing)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(saveNotificationSettings(throwing, DEFAULT_NOTIFICATION_SETTINGS)).toBe(false);
  });
});

describe("price alerts — persistence and validation", () => {
  const alert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
    id: "pa-1",
    symbol: "R_25",
    direction: "above",
    price: 100.5,
    createdAt: 1_000,
    ...over,
  });

  it("round-trips alerts through storage", () => {
    const storage = fakeStorage();
    const alerts = [
      alert({ id: "pa-2", direction: "below", price: 99 }),
      alert({ id: "pa-1", direction: "above", price: 101 }),
    ];
    expect(savePriceAlerts(storage, alerts)).toBe(true);
    expect(loadPriceAlerts(storage)).toEqual(alerts);
    expect(storage.dump()).toHaveProperty(PRICE_ALERT_STORAGE_KEY);
  });

  it("rejects malformed alerts (bad direction, non-positive price, junk)", () => {
    const raw = JSON.stringify([
      alert({ id: "pa-ok" }),
      { ...alert({ id: "pa-bad-dir" }), direction: "sideways" },
      { ...alert({ id: "pa-zero" }), price: 0 },
      { ...alert({ id: "pa-neg" }), price: -5 },
      { ...alert({ id: "pa-str" }), price: "100" },
      "not-an-alert",
    ]);
    expect(parsePriceAlerts(raw).map((a) => a.id)).toEqual(["pa-ok"]);
    expect(isPriceAlert(alert())).toBe(true);
    expect(isPriceAlert(null)).toBe(false);
  });

  it("caps alerts at PRICE_ALERT_CAP on load and save", () => {
    const storage = fakeStorage();
    const many = Array.from({ length: PRICE_ALERT_CAP + 5 }, (_, i) => alert({ id: `pa-${i}` }));
    savePriceAlerts(storage, many);
    const saved = JSON.parse(storage.dump()[PRICE_ALERT_STORAGE_KEY]) as PriceAlert[];
    expect(saved.length).toBe(PRICE_ALERT_CAP);
    expect(loadPriceAlerts(storage).length).toBe(PRICE_ALERT_CAP);
  });

  it("handles missing storage and corrupt payloads", () => {
    expect(loadPriceAlerts(fakeStorage())).toEqual([]);
    expect(loadPriceAlerts(fakeStorage({ [PRICE_ALERT_STORAGE_KEY]: "garbage" }))).toEqual([]);
    expect(loadPriceAlerts(null)).toEqual([]);
    expect(savePriceAlerts(null, [alert()])).toBe(false);
  });
});
