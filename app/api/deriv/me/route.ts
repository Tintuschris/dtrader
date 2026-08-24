import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/me
 *
 * Returns the current authenticated user's session status.
 * If authenticated, also fetches the account list from Deriv.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json({ authenticated: false });
  }

  // Fetch the user's accounts from Deriv
  try {
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      {
        headers,
        cache: "no-store",
      },
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      // Token might be expired — still report as authenticated
      // but without accounts
      return NextResponse.json({
        authenticated: true,
        error: "Unable to load accounts",
      });
    }

    const source =
      payload?.data?.accounts ?? payload?.data ?? payload?.accounts ?? [];
    const accounts = Array.isArray(source)
      ? source
          .map((a: Record<string, unknown>) => {
            const id = String(
              a.account_id ?? a.accountId ?? a.id ?? "",
            );
            if (!id) return null;
            const rawType = String(
              a.account_type ?? a.accountType ?? a.type ?? "demo",
            ).toLowerCase();
            return {
              id,
              type: rawType.includes("real") ? "real" : "demo",
              currency: String(a.currency ?? "USD"),
              balance:
                typeof a.balance === "number" ? a.balance : undefined,
            };
          })
          .filter(Boolean)
      : [];

    return NextResponse.json({
      authenticated: true,
      scopes: session.scopes,
      accounts,
    });
  } catch (err) {
    console.error("Failed to fetch accounts:", err);
    return NextResponse.json({
      authenticated: true,
      error: "Network error fetching accounts",
    });
  }
}
