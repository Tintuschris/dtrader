import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { getOptionsAccounts, getOptionsSocketUrl, requestOptionsWs } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/debug-history
 *
 * Runs the full profit_table chain step by step and returns every detail.
 * Visit this in your browser while logged in to diagnose issues.
 */
export async function GET() {
  const steps: Array<{ step: string; status: "ok" | "error" | "skip"; detail: unknown; elapsed_ms: number }> = [];
  const t0 = Date.now();

  const snap = (step: string, status: "ok" | "error" | "skip", detail: unknown, t1: number) => {
    steps.push({ step, status, detail, elapsed_ms: Date.now() - t1 });
  };

  // 1. Session
  const t1 = Date.now();
  const session = await getSession();
  if (!session?.accessToken) {
    snap("session", "error", { msg: "No session — not logged in" }, t1);
    return NextResponse.json({ steps, total_ms: Date.now() - t0 }, { status: 401 });
  }
  snap("session", "ok", {
    tokenPrefix: session.accessToken.substring(0, 8),
    hasLoginId: !!session.loginId,
    loginId: session.loginId ?? "(none)",
    scopes: session.scopes,
  }, t1);

  // 2. PAT
  const t2 = Date.now();
  const pat = process.env.DERIV_PAT;
  if (!pat) {
    snap("PAT", "error", { msg: "DERIV_PAT not set in environment" }, t2);
    return NextResponse.json({ steps, total_ms: Date.now() - t0 });
  }
  snap("PAT", "ok", { prefix: pat.substring(0, 10), length: pat.length }, t2);

  // 3. getOptionsAccounts
  const t3 = Date.now();
  let accounts;
  try {
    accounts = await getOptionsAccounts(pat);
    snap("getOptionsAccounts", "ok", { count: accounts.length, accounts: accounts.map(a => ({ id: a.id, type: a.type, balance: a.balance })) }, t3);
  } catch (err) {
    snap("getOptionsAccounts", "error", { msg: err instanceof Error ? err.message : String(err) }, t3);
    return NextResponse.json({ steps, total_ms: Date.now() - t0 });
  }

  if (!accounts.length) {
    snap("account_select", "error", { msg: "No accounts returned from Deriv" }, t3);
    return NextResponse.json({ steps, total_ms: Date.now() - t0 });
  }

  const account = accounts[0]; // default to first account
  snap("account_select", "ok", { selected: account.id, type: account.type }, t3);

  // 4. getOptionsSocketUrl (OTP)
  const t4 = Date.now();
  let wsUrl: string;
  try {
    wsUrl = await getOptionsSocketUrl(account.id, pat);
    snap("getOptionsSocketUrl", "ok", { urlPrefix: wsUrl.substring(0, 70) }, t4);
  } catch (err) {
    snap("getOptionsSocketUrl", "error", { msg: err instanceof Error ? err.message : String(err) }, t4);
    return NextResponse.json({ steps, total_ms: Date.now() - t0 });
  }

  // 5. requestOptionsWs (profit_table)
  const t5 = Date.now();
  try {
    const result = await requestOptionsWs<{
      profit_table?: { transactions?: unknown[]; count?: number };
    }>(wsUrl, { profit_table: 1, description: 1, limit: 5, offset: 0, sort: "DESC" }, "profit_table");
    snap("requestOptionsWs(profit_table)", "ok", {
      count: result.profit_table?.count,
      txReturned: result.profit_table?.transactions?.length,
      firstTx: result.profit_table?.transactions?.[0],
    }, t5);
  } catch (err) {
    snap("requestOptionsWs(profit_table)", "error", { msg: err instanceof Error ? err.message : String(err) }, t5);
  }

  // 6. Also test balance on the same WS
  const t6 = Date.now();
  try {
    const result = await requestOptionsWs<{
      balance?: { balance?: string; currency?: string };
    }>(wsUrl, { balance: 1 }, "balance");
    snap("requestOptionsWs(balance)", "ok", { balance: result.balance }, t6);
  } catch (err) {
    snap("requestOptionsWs(balance)", "error", { msg: err instanceof Error ? err.message : String(err) }, t6);
  }

  return NextResponse.json({ steps, total_ms: Date.now() - t0 });
}
