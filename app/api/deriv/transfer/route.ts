import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DERIV_WS_URL = "https://ws.derivws.com/websockets/v3";

/**
 * POST /api/deriv/transfer
 *
 * Transfers funds between Deriv accounts using the v3 WebSocket API.
 * Uses transfer_between_accounts endpoint.
 *
 * Body: { from: string, to: string, amount: number }
 * - from: source account loginid (e.g., "CR12345")
 * - to: destination account loginid (e.g., "VRTC12345")
 * - amount: amount to transfer (positive number)
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const appId = process.env.DERIV_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "DERIV_APP_ID not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const { from, to, amount } = body ?? {};

  if (!from || !to || !amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({
      error: "Invalid transfer parameters. Requires from, to (account loginids), and amount (positive number).",
    }, { status: 400 });
  }

  if (from === to) {
    return NextResponse.json({ error: "Cannot transfer to the same account." }, { status: 400 });
  }

  try {
    // Step 1: Get OTP token for the source account
    const authRes = await fetch(`${DERIV_WS_URL}?app_id=${appId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorize: from,
      }),
    });
    const authPayload = await authRes.json().catch(() => null);
    const token = authPayload?.authorize?.token;

    if (!token) {
      return NextResponse.json({
        error: "Could not authorize transfer. Please ensure you are logged in and have access to the source account.",
      }, { status: 401 });
    }

    // Step 2: Execute the transfer using the authorized token
    const transferRes = await fetch(`${DERIV_WS_URL}?app_id=${appId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorize: token,
        transfer_between_accounts: 1,
        account_from: from,
        account_to: to,
        amount: amount,
      }),
    });
    const transferPayload = await transferRes.json().catch(() => null);

    // Check for errors
    if (transferPayload?.error) {
      return NextResponse.json({
        error: transferPayload.error.message ?? transferPayload.error.message_ ?? "Transfer failed",
        error_code: transferPayload.error.code,
      }, { status: 400 });
    }

    // Transfer successful
    return NextResponse.json({
      success: true,
      balance: transferPayload?.transfer_between_accounts?.balance,
      transaction_id: transferPayload?.transfer_between_accounts?.transaction_id,
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return NextResponse.json({ error: "Transfer request failed" }, { status: 500 });
  }
}
