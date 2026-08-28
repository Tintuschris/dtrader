import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { getExchangeRate } from "../../../../lib/deriv-wallet-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/exchange-rate?from=USD&to=EUR
 *
 * Returns the current exchange rate between two currencies
 * from the Deriv Wallet REST API.
 * Requires an OAuth session with the `payment` scope.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated. Please log in with your Deriv account." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "Both 'from' and 'to' currency parameters are required." },
      { status: 400 },
    );
  }

  try {
    const rate = await getExchangeRate(from.toUpperCase(), to.toUpperCase());
    return NextResponse.json({
      exchange_rate: rate.exchange_rate,
      rate_token: rate.rate_token,
      source_currency: rate.source_currency,
      destination_currency: rate.destination_currency,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deriv:exchange-rate] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
