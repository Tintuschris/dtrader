/**
 * File-backed JSONL store for WebSocket drop diagnostics.
 *
 * Entries are appended one JSON object per line to `data/ws-drops.jsonl`
 * (overridable via WS_DROP_LOG_FILE for tests). Duplicates are rejected by
 * entry id, so re-sent batches (page reloads, retries) are idempotent.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { WsCloseLogEntry } from "./ws-lifecycle";

function storePath(): string {
  return process.env.WS_DROP_LOG_FILE ?? path.join(process.cwd(), "data", "ws-drops.jsonl");
}

let cachedIds: Set<string> | null = null;
let cachedEntries: WsCloseLogEntry[] | null = null;

async function load(): Promise<{ ids: Set<string>; entries: WsCloseLogEntry[] }> {
  if (cachedIds && cachedEntries) return { ids: cachedIds, entries: cachedEntries };
  const file = storePath();
  const ids = new Set<string>();
  const entries: WsCloseLogEntry[] = [];
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const e = JSON.parse(trimmed) as WsCloseLogEntry;
        entries.push(e);
        if (e.id) ids.add(e.id);
      } catch {
        /* skip corrupt line — keep the rest of the log usable */
      }
    }
  } catch {
    /* file does not exist yet — start empty */
  }
  cachedIds = ids;
  cachedEntries = entries;
  return { ids, entries };
}

/** Append entries, skipping ids already stored. Never rejects on dedupe logic. */
export async function appendWsDrops(
  entries: WsCloseLogEntry[],
): Promise<{ stored: number; duplicates: number }> {
  const { ids } = await load();
  const fresh = entries.filter((e) => !(e.id && ids.has(e.id)));
  let stored = 0;
  if (fresh.length > 0) {
    const file = storePath();
    const lines = fresh.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, lines, "utf8");
    for (const e of fresh) {
      if (e.id) ids.add(e.id);
    }
    cachedEntries = null; // invalidate so the next read re-reads the file
    stored = fresh.length;
  }
  return { stored, duplicates: entries.length - stored };
}

/** Read the most recent `limit` entries, newest first. */
export async function readWsDrops(limit = 100): Promise<WsCloseLogEntry[]> {
  const { entries } = await load();
  return entries.slice(-limit).reverse();
}

/** Test hook — drop the in-memory cache so a changed WS_DROP_LOG_FILE is honoured. */
export function resetWsDropStoreCache(): void {
  cachedIds = null;
  cachedEntries = null;
}
