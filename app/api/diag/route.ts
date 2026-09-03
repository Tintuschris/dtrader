import { NextResponse } from "next/server";
import type { WsCloseLogEntry } from "../../../lib/ws-lifecycle";
import { appendWsDrops, readWsDrops } from "../../../lib/ws-drop-store";
import { getDiagRateLimiter } from "../../../lib/ws-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ENTRIES_PER_BATCH = 200;
const MAX_BODY_BYTES = 1_000_000;

const limiter = getDiagRateLimiter();

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Validate + normalize a raw object into a drop entry; null if unusable. */
function sanitize(raw: unknown): WsCloseLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
  if (typeof r.code !== "number") return null;
  const inFlightRaw = (r.inFlight ?? {}) as Record<string, unknown>;
  const inFlight = {
    proposals: typeof inFlightRaw.proposals === "number" ? inFlightRaw.proposals : 0,
    buys: typeof inFlightRaw.buys === "number" ? inFlightRaw.buys : 0,
    portfolio: !!inFlightRaw.portfolio,
    profitTable: !!inFlightRaw.profitTable,
  };
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    at: r.at,
    code: r.code,
    reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : "",
    durationMs: typeof r.durationMs === "number" ? r.durationMs : 0,
    attempt: typeof r.attempt === "number" ? r.attempt : 0,
    inFlight,
    hadActiveContract: !!r.hadActiveContract,
    reconcileFlagged: !!r.reconcileFlagged,
  };
}

export async function POST(req: Request) {
  if (!limiter.allow(clientKey(req))) {
    return NextResponse.json(
      { error: "Rate limited — too many diagnostic uploads", retryAfterSec: 60 },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawEntries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(rawEntries)) {
    return NextResponse.json({ error: "entries must be an array" }, { status: 400 });
  }

  const entries = rawEntries
    .slice(0, MAX_ENTRIES_PER_BATCH)
    .map(sanitize)
    .filter((e): e is WsCloseLogEntry => e !== null);
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid entries" }, { status: 400 });
  }

  try {
    const result = await appendWsDrops(entries);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[diag] failed to store drops:", err);
    return NextResponse.json({ error: "Could not store drops" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const limitRaw = new URL(req.url).searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);
  const entries = await readWsDrops(limit);
  return NextResponse.json({ entries, total: entries.length });
}
