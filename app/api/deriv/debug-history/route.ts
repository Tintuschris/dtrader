import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest, getOptionsAccounts, getOptionsSocketUrl, requestOptionsWs } from "../../../../lib/deriv-options-ws";

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

  // 2. Token
  const t2 = Date.now();
  const pat = process.env.DERIV_PAT;
  const token = pat || session.accessToken;
  if (!token) {
    snap("token", "error", { msg: "No token available" }, t2);
    return NextResponse.json({ steps, total_ms: Date.now() - t0 });
  }
  snap("token", "ok", { hasPAT: !!pat, tokenPrefix: token.substring(0, 10) }, t2);

  // 3. Core API v3 — profit_table
  const t3 = Date.now();
  try {
    const { result, accountId, accountType } = await derivV3AuthRequest<{
      profit_table?: { transactions?: unknown[]; count?: number };
    }>(
      token,
      { profit_table: 1, description: 1, limit: 5, offset: 0, sort: "DESC" },
      "profit_table",
      session.loginId,
    );
    snap("derivV3AuthRequest(profit_table)", "ok", {
      accountId,
      accountType,
      count: result.profit_table?.count,
      txReturned: result.profit_table?.transactions?.length,
      firstTx: result.profit_table?.transactions?.[0],
    }, t3);
  } catch (err) {
    snap("derivV3AuthRequest(profit_table)", "error", { msg: err instanceof Error ? err.message : String(err) }, t3);
  }

  // 4. Core API v3 — portfolio
  const t4 = Date.now();
  try {
    const { result, accountId, accountType } = await derivV3AuthRequest<{
      portfolio?: { contracts?: unknown[] };
    }>(
      token,
      { portfolio: 1 },
      "portfolio",
      session.loginId,
    );
    snap("derivV3AuthRequest(portfolio)", "ok", {
      accountId,
      accountType,
      contractCount: result.portfolio?.contracts?.length,
      firstContract: result.portfolio?.contracts?.[0],
    }, t4);
  } catch (err) {
    snap("derivV3AuthRequest(portfolio)", "error", { msg: err instanceof Error ? err.message : String(err) }, t4);
  }

  // 5. Options API — accounts (sanity check)
  if (pat) {
    const t5 = Date.now();
    try {
      const accounts = await getOptionsAccounts(pat);
      snap("getOptionsAccounts", "ok", { count: accounts.length, accounts: accounts.map(a => ({ id: a.id, type: a.type, balance: a.balance })) }, t5);
    } catch (err) {
      snap("getOptionsAccounts", "error", { msg: err instanceof Error ? err.message : String(err) }, t5);
    }
  } else {
    snap("getOptionsAccounts", "skip", { msg: "No PAT set" }, t0);
  }

  // 6. Options API — balance on WS (sanity check)
  if (pat) {
    const t6 = Date.now();
    try {
      const accounts = await getOptionsAccounts(pat);
      if (accounts.length > 0) {
        const wsUrl = await getOptionsSocketUrl(accounts[0].id, pat);
        const result = await requestOptionsWs<{
          balance?: { balance?: string; currency?: string };
        }>(wsUrl, { balance: 1 }, "balance");
        snap("requestOptionsWs(balance)", "ok", { balance: result.balance }, t6);
      } else {
        snap("requestOptionsWs(balance)", "skip", { msg: "No accounts" }, t6);
      }
    } catch (err) {
      snap("requestOptionsWs(balance)", "error", { msg: err instanceof Error ? err.message : String(err) }, t6);
    }
  } else {
    snap("requestOptionsWs(balance)", "skip", { msg: "No PAT set" }, t0);
  }

  return NextResponse.json({ steps, total_ms: Date.now() - t0 });
}
