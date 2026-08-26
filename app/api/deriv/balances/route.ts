import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountBalance = {
  id: string;
  loginid: string;
  type: "demo" | "real";
  currency: string;
  balance: number | null;
};

/**
 * GET /api/deriv/balances
 *
 * Fetches all Deriv account balances using the correct v3 WebSocket API.
 * Step 1: Get list of accounts via REST
 * Step 2: For each account, get an OTP and query balance
 */

let balanceCache: { accounts: AccountBalance[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000;

const DERIV_WS_URL = "https://api.derivws.com/websockets/v3";

export async function GET() {
  if (balanceCache && Date.now() - balanceCache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ accounts: balanceCache.accounts, cached: true });
  }

  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const appId = process.env.DERIV_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "DERIV_APP_ID not configured" }, { status: 500 });
  }

  try {
    // Step 1: Get all accounts using the authenticated session
    const headers = await getAuthHeaders();
    if (!headers) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Fetch accounts list via the accounts API
    const accountsRes = await fetch("https://api.derivws.com/websockets/v3?app_id=" + appId, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ accounts: 1 }),
    });
    const accountsPayload = await accountsRes.json().catch(() => null);

    // Try multiple response shapes
    const accountsList =
      accountsPayload?.accounts ??
      accountsPayload?.data?.accounts ??
      accountsPayload?.data ??
      [];

    if (!Array.isArray(accountsList) || accountsList.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    // Step 2: Get balance for each account
    const accounts: AccountBalance[] = await Promise.all(
      accountsList.map(async (a: Record<string, unknown>): Promise<AccountBalance> => {
        const loginid = String(a.loginid ?? a.account_id ?? "");
        const id = loginid;
        const rawType = String(a.account_type ?? a.type ?? "demo").toLowerCase();
        const type: "demo" | "real" = rawType.includes("real") ? "real" : "demo";
        const currency = String(a.currency ?? "USD");

        if (!id) {
          return { id: "", loginid: "", type: "demo", currency: "USD", balance: null };
        }

        try {
          const balance = await fetchAccountBalance(id, appId);
          return { id, loginid, type, currency, balance };
        } catch {
          return { id, loginid, type, currency, balance: null };
        }
      }),
    );

    balanceCache = { accounts, timestamp: Date.now() };
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("Failed to fetch balances:", err);
    return NextResponse.json({ error: "Failed to fetch account balances" }, { status: 500 });
  }
}

/**
 * Fetch balance for a single Deriv account using v3 WebSocket API.
 * Sends a JSON POST to the WS endpoint with authorize + balance requests.
 */
async function fetchAccountBalance(loginid: string, appId: string): Promise<number | null> {
  const wsUrl = `${DERIV_WS_URL}?app_id=${appId}`;

  // Step 1: Get an OTP for this specific account
  const otpRes = await fetch(wsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorize: loginid,
      req_id: `balance_${loginid}`,
    }),
  });
  const otpPayload = await otpRes.json().catch(() => null);
  const token = otpPayload?.authorize?.token;

  if (!token) {
    // If we can't get a token, try using the account ID directly
    // Some accounts may need a different approach
    console.warn(`Could not get token for account ${loginid}`);
    return null;
  }

  // Step 2: Use the token to query balance
  const balanceRes = await fetch(wsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorize: token,
      balance: 1,
      subscribe: 1,
    }),
  });
  const balancePayload = await balanceRes.json().catch(() => null);
  const balance = balancePayload?.balance?.balance;

  if (typeof balance === "number") return balance;
  if (typeof balance === "string") return Number(balance) || null;
  return null;
}
