/**
 * IndexedDB helper for persisting TF.js model weights and topology.
 * Falls back to localStorage if IndexedDB is unavailable.
 */

const DB_NAME = "dtrader_digit_model";
const DB_VERSION = 1;
const STORE_NAME = "model_data";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    // Fallback to localStorage
    try {
      const raw = localStorage.getItem(`idb_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

export async function idbSet<T = unknown>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    // Fallback to localStorage
    try {
      localStorage.setItem(`idb_${key}`, JSON.stringify(value));
    } catch { /* */ }
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    try { localStorage.removeItem(`idb_${key}`); } catch { /* */ }
  }
}

export async function idbClear(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("idb_"));
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* */ }
  }
}

/** Export all model data as a JSON-serializable blob for sharing */
export async function exportModelBlob(): Promise<{ topology: unknown; weightData: unknown; metrics: unknown; onlineMetrics: unknown } | null> {
  try {
    const [topology, weightData, metrics, onlineMetrics] = await Promise.all([
      idbGet("topology"),
      idbGet("weights"),
      idbGet("metrics"),
      idbGet("onlineMetrics"),
    ]);
    if (!topology || !weightData) return null;
    return { topology, weightData, metrics, onlineMetrics };
  } catch {
    return null;
  }
}

/** Import a model blob from a file */
export async function importModelBlob(blob: { topology: unknown; weightData: unknown; metrics?: unknown; onlineMetrics?: unknown }): Promise<boolean> {
  try {
    await Promise.all([
      idbSet("topology", blob.topology),
      idbSet("weights", blob.weightData),
      blob.metrics ? idbSet("metrics", blob.metrics) : Promise.resolve(),
      blob.onlineMetrics ? idbSet("onlineMetrics", blob.onlineMetrics) : Promise.resolve(),
    ]);
    return true;
  } catch {
    return false;
  }
}
