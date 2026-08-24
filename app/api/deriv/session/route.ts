import { NextRequest, NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deriv/session
 *
 * Creates an authenticated WebSocket URL (OTP) for the given account.
 * Uses OAuth session if available, falls back to server-side PAT.
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

  const response = await fetch(
    `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok || typeof payload?.data?.url !== "string") {
    return NextResponse.json(
      { error: "Unable to create a secure Deriv session." },
      { status: response.status || 502 },
    );
  }
  return NextResponse.json({ url: payload.data.url });
}
