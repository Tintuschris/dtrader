import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deriv/transfer
 *
 * Transfers funds between Deriv accounts using the REST API.
 * Body: { from: string, to: string, amount: number }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const { from, to, amount } = body ?? {};

  if (!from || !to || !amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json(
      {
        error:
          "Invalid transfer parameters. Requires from, to (account IDs), and amount (positive number).",
      },
      { status: 400 },
    );
  }

  if (from === to) {
    return NextResponse.json(
      { error: "Cannot transfer to the same account." },
      { status: 400 },
    );
  }

  const appId = process.env.DERIV_APP_ID;

  try {
    // Get OTP token for the source account
    const otpRes = await fetch(
      "https://api.derivws.com/trading/v1/options/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, account_id: from }),
      },
    );
    const otpData = await otpRes.json().catch(() => null);
    const token = otpData?.data?.authenticate?.token;

    if (!token) {
      return NextResponse.json(
        {
          error:
            "Could not authorize transfer. Please ensure you are logged in.",
        },
        { status: 401 },
      );
    }

    // Get account info for currency
    const accountCurrency =
      otpData?.data?.authenticate?.currency ?? "USD";

    // Use Deriv's transfer API via HTTP POST to WS endpoint
    const transferRes = await fetch(
      `https://api.derivws.com/trading/v1/options/ws?app_id=${appId ?? "null"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorize: token,
          transfer_between_accounts: 1,
          account_from: from,
          account_to: to,
          amount: amount,
          currency: accountCurrency,
        }),
      },
    );
    const transferData = await transferRes.json().catch(() => null);

    if (transferData?.error) {
      return NextResponse.json(
        {
          error:
            transferData.error.message ??
            transferData.error.message_ ??
            "Transfer failed",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      balance: transferData?.data?.balance,
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return NextResponse.json(
      { error: "Transfer request failed" },
      { status: 500 },
    );
  }
}
