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
 * Returns the user's Deriv accounts. Uses OAuth session if available,
 * falls back to server-side PAT if configured.
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

  // Fall back to server-side PAT
  if (!headers) {
    const appId = process.env.DERIV_APP_ID;
    const token = process.env.DERIV_PAT;
    if (!appId || !token) {
      return NextResponse.json(
        { error: "Not authenticated. Please log in or configure server credentials." },
        { status: 401 },
      );
    }
    headers = {
      "Deriv-App-ID": appId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = usingOAuth
      ? "Unable to load accounts. Your session may have expired."
      : "Unable to load Deriv accounts.";
    return NextResponse.json({ error: errorMsg }, { status: response.status });
  }

  const source = payload?.data?.accounts ?? payload?.data ?? payload?.accounts ?? [];
  const accounts = Array.isArray(source)
    ? source.map((account) => normaliseAccount(account as Record<string, unknown>)).filter(Boolean)
    : [];

  return NextResponse.json({ accounts, authenticated: usingOAuth });
}
