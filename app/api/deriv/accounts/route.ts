import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DerivAccount = {
  id: string;
  type: "demo" | "real";
  currency: string;
  balance?: number;
};

function normaliseAccount(account: Record<string, unknown>): DerivAccount | null {
  const id = String(account.account_id ?? account.accountId ?? account.id ?? "");
  if (!id) return null;
  const rawType = String(account.account_type ?? account.accountType ?? account.type ?? "demo").toLowerCase();
  return {
    id,
    type: rawType.includes("real") ? "real" : "demo",
    currency: String(account.currency ?? "USD"),
    balance: typeof account.balance === "number" ? account.balance : undefined,
  };
}

/**
 * GET /api/deriv/accounts
 *
 * Returns the user's Deriv accounts. Requires OAuth login via Deriv.
 */
export async function GET() {
  // Try OAuth session first
  const session = await getSession();
  let headers: Record<string, string> | null = null;
  let usingOAuth = false;

  if (session?.accessToken) {
    headers = await getAuthHeaders();
    usingOAuth = true;
  }

  if (!headers) {
    return NextResponse.json(
      { error: "Not authenticated. Please log in with your Deriv account." },
      { status: 401 },
    );
  }

  const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = "Unable to load accounts. Your session may have expired.";
    return NextResponse.json({ error: errorMsg }, { status: response.status });
  }

  const source = payload?.data?.accounts ?? payload?.data ?? payload?.accounts ?? [];
  const accounts = Array.isArray(source)
    ? source.map((account) => normaliseAccount(account as Record<string, unknown>)).filter(Boolean)
    : [];

  return NextResponse.json({ accounts, authenticated: usingOAuth });
}
