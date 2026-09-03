/**
 * Integration tests for POST/GET /api/diag — the batched, rate-limited
 * endpoint that receives WebSocket drop diagnostics.
 *
 * Uses a temp JSONL file (WS_DROP_LOG_FILE) so tests never touch real data.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WsCloseLogEntry } from "../lib/ws-lifecycle";
import { resetWsDropStoreCache } from "../lib/ws-drop-store";

// Mock next/server before importing the route
jest.mock("next/server", () => ({
  NextRequest: class {
    url: string;
    headers: { get: (k: string) => string | null };
    bodyText: string;
    constructor(url: string, bodyText = "") {
      this.url = url;
      this.bodyText = bodyText;
      this.headers = { get: () => null };
    }
    text(): Promise<string> {
      return Promise.resolve(this.bodyText);
    }
  },
  NextResponse: {
    json(body: unknown, init?: { status?: number }) {
      return { body, status: init?.status ?? 200 };
    },
  },
}));

import { POST, GET } from "../app/api/diag/route";
import { resetDiagRateLimiter } from "../lib/ws-rate-limit";

let tmpDir: string;

function makeEntry(over: Partial<WsCloseLogEntry> = {}): WsCloseLogEntry {
  return {
    id: "id-" + (over.at ?? 1),
    at: 1_000_000,
    code: 1006,
    reason: "no close frame received or sent",
    durationMs: 45_000,
    attempt: 0,
    inFlight: { proposals: 0, buys: 0, portfolio: false, profitTable: false },
    hadActiveContract: false,
    reconcileFlagged: false,
    ...over,
  };
}

function postReq(entries: unknown): any {
  const body = JSON.stringify({ entries });
  return {
    url: "http://localhost:3000/api/diag",
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

function getReq(limit?: string): any {
  const url = limit
    ? `http://localhost:3000/api/diag?limit=${limit}`
    : "http://localhost:3000/api/diag";
  return { url, headers: { get: () => null }, text: () => Promise.resolve("") };
}

beforeEach(() => {
  resetDiagRateLimiter();
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "diag-"));
  process.env.WS_DROP_LOG_FILE = path.join(tmpDir, "ws-drops.jsonl");
  resetWsDropStoreCache();
});

afterEach(() => {
  delete process.env.WS_DROP_LOG_FILE;
  resetWsDropStoreCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/diag", () => {
  it("stores a valid batch and reports stored/duplicates", async () => {
    const res: any = await POST(postReq([makeEntry({ at: 1 }), makeEntry({ at: 2 })]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, stored: 2, duplicates: 0 });

    const lines = readFileSync(process.env.WS_DROP_LOG_FILE!, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("is idempotent: re-sent ids are counted as duplicates, not stored again", async () => {
    await POST(postReq([makeEntry({ id: "dup-1", at: 1 })]));
    const res: any = await POST(postReq([makeEntry({ id: "dup-1", at: 1 })]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, stored: 0, duplicates: 1 });

    const lines = readFileSync(process.env.WS_DROP_LOG_FILE!, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("rejects an invalid body", async () => {
    const bad = { url: "http://localhost:3000/api/diag", headers: { get: () => null }, text: () => Promise.resolve("not json") };
    const res: any = await POST(bad as any);
    expect(res.status).toBe(400);
  });

  it("rejects a payload without an entries array", async () => {
    const res: any = await POST({ url: "x", headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify({ foo: 1 })) } as any);
    expect(res.status).toBe(400);
  });

  it("filters invalid entries and rejects if none survive", async () => {
    const res: any = await POST(postReq([{ bad: true }, "nope", 42]));
    expect(res.status).toBe(400);
  });

  it("caps batches at 200 entries", async () => {
    const many = Array.from({ length: 250 }, (_, i) => makeEntry({ id: `id-${i}`, at: i }));
    const res: any = await POST(postReq(many));
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(200);
  });

  it("returns 429 once the per-minute rate limit is exceeded", async () => {
    let last: any;
    for (let i = 0; i <= 30; i++) {
      last = await POST(postReq([makeEntry({ id: `rl-${i}`, at: i })]));
    }
    expect(last.status).toBe(429);
  });
});

describe("GET /api/diag", () => {
  it("returns stored entries newest-first", async () => {
    await POST(postReq([makeEntry({ at: 1 }), makeEntry({ at: 2 }), makeEntry({ at: 3 })]));
    const res: any = await GET(getReq());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.entries.map((e: WsCloseLogEntry) => e.at)).toEqual([3, 2, 1]);
  });

  it("honours the limit query param (capped at 500)", async () => {
    await POST(postReq(Array.from({ length: 10 }, (_, i) => makeEntry({ id: `g-${i}`, at: i }))));
    const res: any = await GET(getReq("3"));
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries[0].at).toBe(9);
  });
});
