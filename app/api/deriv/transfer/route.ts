import { NextRequest, NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WALLET_API_BASE = "https://api.derivws.com/wallet/v1";

/**
 * POST /api/deriv/transfer
 *
 * Transfers funds between Deriv accounts using Deriv's official Wallet & Platform REST APIs:
 * 1. Transfers between wallets: POST /wallet/v1/transfers
 * 2. Transfers between wallet and trading platform accounts: POST /wallet/v1/transfers/platforms
 *
 * Requires OAuth token with 'payment' scope and 'Deriv-App-ID' header.
 *
 * Body: { from: string, to: string, amount: number, currency?: string }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated. Please log in with your Deriv account." }, { status: 401 });
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json({ error: "Missing authorization headers." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    from?: string;
    to?: string;
    amount?: number;
    currency?: string;
  } | null;

  const { from, to, amount, currency = "USD" } = body ?? {};

  if (!from || !to || !amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json(
      { error: "Invalid transfer parameters. Requires from, to (account IDs), and a positive amount." },
      { status: 400 },
    );
  }

  if (from === to) {
    return NextResponse.json({ error: "Cannot transfer funds to the same account." }, { status: 400 });
  }

  const isFromWallet = from.startsWith("CRW") || from.startsWith("VRW");
  const isToWallet = to.startsWith("CRW") || to.startsWith("VRW");

  try {
    let endpoint = `${WALLET_API_BASE}/transfers`;
    let payload: Record<string, unknown>;

    if (isFromWallet && isToWallet) {
      // Transfer between two wallets
      endpoint = `${WALLET_API_BASE}/transfers`;
      payload = {
        from_wallet_id: from,
        to_wallet_id: to,
        amount,
        currency,
        request_id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };
    } else if (isFromWallet && !isToWallet) {
      // Transfer from wallet to trading platform account
      endpoint = `${WALLET_API_BASE}/transfers/platforms`;
      payload = {
        wallet_id: from,
        to_account_id: to,
        direction: "wallet_to_platform",
        amount,
        currency,
        request_id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };
    } else if (!isFromWallet && isToWallet) {
      // Transfer from trading platform account back to wallet
      endpoint = `${WALLET_API_BASE}/transfers/platforms`;
      payload = {
        wallet_id: to,
        from_account_id: from,
        direction: "platform_to_wallet",
        amount,
        currency,
        request_id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };
    } else {
      // Platform to platform: route as platform transfer
      endpoint = `${WALLET_API_BASE}/transfers/platforms`;
      payload = {
        from_account_id: from,
        to_account_id: to,
        amount,
        currency,
        request_id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMsg =
        result?.errors?.[0]?.message ??
        result?.error?.message ??
        result?.message ??
        "Transfer failed. Please check that you have sufficient balance and the payment permission.";
      return NextResponse.json({ error: errorMsg }, { status: response.status });
    }

    return NextResponse.json({
      success: true,
      data: result?.data ?? result,
      transaction_id: result?.data?.transaction_id ?? result?.transaction_id,
    });
  } catch (err) {
    console.error("[Transfer] API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transfer request failed unexpectedly." },
      { status: 500 },
    );
  }
}
