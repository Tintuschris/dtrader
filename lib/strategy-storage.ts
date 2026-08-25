/**
 * Strategy persistence service for DTrader Blockly editor.
 *
 * Saves strategy metadata + Blockly workspace XML to localStorage.
 * Each strategy has: id, name, xml, createdAt, updatedAt, thumbnail (optional).
 */

const STORAGE_KEY = "dtrader_strategies";
const MAX_STRATEGIES = 50;

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type SavedStrategy = {
  id: string;
  name: string;
  xml: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return `strat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getAllRaw(): Record<string, SavedStrategy> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAllRaw(data: Record<string, SavedStrategy>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/** Get all saved strategies, sorted by most recently updated. */
export function getStrategies(): SavedStrategy[] {
  const data = getAllRaw();
  return Object.values(data).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Get a single strategy by ID. */
export function getStrategy(id: string): SavedStrategy | null {
  const data = getAllRaw();
  return data[id] ?? null;
}

/** Save a new strategy. Returns the created strategy. */
export function saveStrategy(
  name: string,
  xml: string,
  description?: string,
): SavedStrategy {
  const data = getAllRaw();
  const count = Object.keys(data).length;

  // Enforce max limit — remove oldest if full
  if (count >= MAX_STRATEGIES) {
    const sorted = Object.values(data).sort((a, b) => a.updatedAt - b.updatedAt);
    const toRemove = sorted.slice(0, count - MAX_STRATEGIES + 1);
    toRemove.forEach((s) => delete data[s.id]);
  }

  const now = Date.now();
  const strategy: SavedStrategy = {
    id: generateId(),
    name: name.trim() || `Strategy ${count + 1}`,
    xml,
    description: description?.trim(),
    createdAt: now,
    updatedAt: now,
  };

  data[strategy.id] = strategy;
  saveAllRaw(data);
  return strategy;
}

/** Update an existing strategy's name, XML, or description. */
export function updateStrategy(
  id: string,
  updates: Partial<Pick<SavedStrategy, "name" | "xml" | "description">>,
): SavedStrategy | null {
  const data = getAllRaw();
  const existing = data[id];
  if (!existing) return null;

  const updated = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };
  // Clear undefined fields
  if (updates.name !== undefined) updated.name = updates.name;
  if (updates.xml !== undefined) updated.xml = updates.xml;
  if (updates.description !== undefined) updated.description = updates.description;

  data[id] = updated;
  saveAllRaw(data);
  return updated;
}

/** Delete a strategy by ID. */
export function deleteStrategy(id: string): boolean {
  const data = getAllRaw();
  if (!data[id]) return false;
  delete data[id];
  saveAllRaw(data);
  return true;
}

/** Get the count of saved strategies. */
export function getStrategyCount(): number {
  return Object.keys(getAllRaw()).length;
}

/** Export a strategy as a downloadable .xml file. */
export function exportStrategyXml(strategy: SavedStrategy): void {
  const blob = new Blob([strategy.xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${strategy.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Import a strategy from a .xml file. Returns the parsed XML string. */
export function importStrategyXml(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      // Basic validation — must contain XML blocks
      if (!content.includes("<xml") && !content.includes("<block")) {
        reject(new Error("Invalid strategy file — expected Blockly XML"));
        return;
      }
      resolve(content);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Clear all strategies. */
export function clearAllStrategies(): void {
  saveAllRaw({});
}

/** Duplicate a strategy with a new name. */
export function duplicateStrategy(id: string, newName?: string): SavedStrategy | null {
  const original = getStrategy(id);
  if (!original) return null;
  return saveStrategy(
    newName ?? `${original.name} (copy)`,
    original.xml,
    original.description,
  );
}
