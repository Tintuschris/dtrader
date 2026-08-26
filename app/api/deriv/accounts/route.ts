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
 * Returns the user's Deriv accounts using the Options API REST endpoint.
 * The Options API has a GET /accounts REST endpoint that lists all accounts.
 */
export async function GET() {
  const session = await getSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated. Please log in with your Deriv account." },
      { status: 401 },
    );
  }

  const appId = process.env.DERIV_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "DERIV_APP_ID not configured" },
      { status: 500 },
    );
  }

  try {
    // Use Options API REST endpoint to get accounts list
    const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      method: "GET",
      headers: {
        "Deriv-App-ID": appId,
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Unable to load accounts. Your session may have expired." },
        { status: response.status },
      );
    }

    const payload = await response.json() as { data?: { accounts?: Array<Record<string, unknown>> } };
    const source = payload?.data?.accounts ?? [];
    const accounts = Array.isArray(source)
      ? source.map((account) => normaliseAccount(account)).filter(Boolean)
      : [];

    return NextResponse.json({ accounts, authenticated: true });
  } catch (err) {
    console.error("Failed to fetch accounts:", err);
    return NextResponse.json(
      { error: "Unable to load accounts. Your session may have expired." },
      { status: 500 },
    );
  }
}
