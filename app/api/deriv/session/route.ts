import { NextRequest, NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deriv/session
 *
 * Creates an authenticated WebSocket URL (OTP) for the given account.
 * Creates an authenticated WebSocket URL (OTP) for the given account.
 * Requires OAuth login via Deriv.
 */
export async function POST(request: NextRequest) {
  const { accountId } = (await request.json().catch(() => ({}))) as { accountId?: string };
  if (!accountId) {
    return NextResponse.json({ error: "Account ID is required." }, { status: 400 });
  }

  // Try OAuth session first
  const session = await getSession();
  let headers: Record<string, string> | null = null;

  if (session?.accessToken) {
    headers = await getAuthHeaders();
  }

  if (!headers) {
    return NextResponse.json(
      { error: "Not authenticated. Please log in with your Deriv account." },
      { status: 401 },
    );
  }

  // Use the OAuth access token to authenticate with Deriv v3 WebSocket API
  // The token can be used directly with the v3 WebSocket authorize command
  const token = session?.accessToken;
  if (!token) {
    return NextResponse.json(
      { error: "No access token available." },
      { status: 401 },
    );
  }

  // Return the v3 WebSocket URL and token for client-side auth
  const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID ?? process.env.DERIV_APP_ID;
  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

  return NextResponse.json({ url: wsUrl, token });
}
