import { NextRequest, NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/bot-session
 *
 * Bridge endpoint for the Python bot.
 * Returns an authenticated WebSocket URL (OTP) for trading,
 * piggybacking on the web app OAuth session.
 *
 * Query params:
 *   accountId  - optional, specific account to use
 *   type       - "demo" or "real" (default: auto-select demo)
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated. Log in via the web app first." },
      { status: 401 },
    );
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json(
      { error: "Cannot build auth headers." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  let accountId = searchParams.get("accountId") || undefined;
  const accountType = searchParams.get("type") || "demo";

  // If no accountId provided, fetch account list and auto-select
  if (!accountId) {
    try {
      const listRes = await fetch(
        "https://api.derivws.com/trading/v1/options/accounts",
        { headers, cache: "no-store" },
      );
      const listData = await listRes.json().catch(() => null);
      const accounts = listData?.data?.accounts || listData?.accounts || [];
      if (accounts.length > 0) {
        // Prefer demo for safety
        const preferred = accounts.find((a: any) => {
          const id = a.accountId || a.id || a.loginid || "";
          const isVirtual = a.isVirtual || id.startsWith("VR") || id.toLowerCase().includes("demo");
          return accountType === "demo" ? isVirtual : !isVirtual;
        }) || accounts[0];
        accountId = preferred.accountId || preferred.id || preferred.loginid;
      }
    } catch (e) {
      return NextResponse.json(
        { error: "Failed to fetch accounts: " + String(e) },
        { status: 502 },
      );
    }
  }

  if (!accountId) {
    return NextResponse.json(
      { error: "No account found. Make sure you are logged in." },
      { status: 404 },
    );
  }

  // Get OTP WebSocket URL
  try {
    const otpUrl = "https://api.derivws.com/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp";
    const otpRes = await fetch(otpUrl, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const otpPayload = await otpRes.json().catch(() => null);
    if (!otpRes.ok || typeof otpPayload?.data?.url !== "string") {
      return NextResponse.json(
        { error: "Unable to create WebSocket session.", details: otpPayload },
        { status: 502 },
      );
    }
    return NextResponse.json({
      url: otpPayload.data.url,
      accountId,
      type: accountType,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "OTP request failed: " + String(e) },
      { status: 502 },
    );
  }
}
