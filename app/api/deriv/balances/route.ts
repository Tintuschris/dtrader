import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountBalance = {
  id: string;
  type: "demo" | "real";
  currency: string;
  balance: number | null;
};

/**
 * GET /api/deriv/balances
 *
 * Returns balances for all Deriv accounts.
 * Uses the Deriv REST API to fetch each account's balance
 * by obtaining an OTP for each account and querying via HTTP.
 */

let balanceCache: { accounts: AccountBalance[]; timestamp: number } | null =
  null;
const CACHE_TTL_MS = 30_000;

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  if (balanceCache && Date.now() - balanceCache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ accounts: balanceCache.accounts, cached: true });
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const accountsRes = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      { headers, cache: "no-store" },
    );
    const accountsPayload = await accountsRes.json().catch(() => null);
    const source =
      accountsPayload?.data?.accounts ??
      accountsPayload?.data ??
      accountsPayload?.accounts ??
      [];

    if (!Array.isArray(source) || source.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    const appId = process.env.DERIV_APP_ID;

    const accounts: AccountBalance[] = await Promise.all(
      source.map(
        (a: Record<string, unknown>): Promise<AccountBalance> => {
          const id = String(a.account_id ?? a.accountId ?? a.id ?? "");
          if (!id) {
            return Promise.resolve({
              id: "",
              type: "demo",
              currency: "USD",
              balance: null,
            });
          }
          const rawType = String(
            a.account_type ?? a.accountType ?? a.type ?? "demo",
          ).toLowerCase();
          const type: "demo" | "real" = rawType.includes("real")
            ? "real"
            : "demo";
          const currency = String(a.currency ?? "USD");

          return fetchAccountBalance(id, appId)
            .then((balance) => ({ id, type, currency, balance }))
            .catch(() => ({ id, type, currency, balance: null }));
        },
      ),
    );

    balanceCache = { accounts, timestamp: Date.now() };
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("Failed to fetch balances:", err);
    return NextResponse.json(
      { error: "Failed to fetch account balances" },
      { status: 500 },
    );
  }
}

/**
 * Fetch balance for a single account by:
 * 1. Getting an OTP token for the account
 * 2. Using the Deriv HTTP API to query balance
 */
async function fetchAccountBalance(
  accountId: string,
  appId: string | undefined,
): Promise<number | null> {
  try {
    // Step 1: Get OTP for this account
    const otpRes = await fetch(
      "https://api.derivws.com/trading/v1/options/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, account_id: accountId }),
      },
    );
    const otpData = await otpRes.json().catch(() => null);
    const token = otpData?.data?.authenticate?.token;
    if (!token) return null;

    // Step 2: Use the token to get balance via the Deriv WS endpoint via HTTP POST
    // Deriv supports POST to their WS endpoint which returns JSON
    const balanceRes = await fetch(
      `https://api.derivws.com/trading/v1/options/ws?app_id=${appId ?? "null"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorize: token }),
      },
    );
    const authData = await balanceRes.json().catch(() => null);
    const balance = authData?.data?.balance;
    if (typeof balance === "number") return balance;
    if (typeof balance === "string") return Number(balance) || null;
    return null;
  } catch {
    return null;
  }
}
