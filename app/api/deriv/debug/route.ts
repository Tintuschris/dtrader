import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  
  if (!session) {
    return NextResponse.json({ 
      error: "No session found", 
      hint: "You need to log out and log back in" 
    });
  }

  // Test fetching accounts from Deriv
  let accountsResult: unknown = null;
  let accountsError: string | null = null;
  try {
    const appId = process.env.DERIV_APP_ID;
    const res = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: {
        Authorization: "Bearer " + session.accessToken,
        "Deriv-App-ID": appId ?? "",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    accountsResult = { status: res.status, body: text.substring(0, 2000) };
  } catch (err) {
    accountsError = err instanceof Error ? err.message : String(err);
  }

  // Test OTP endpoint if we have a loginId
  let otpResult: unknown = null;
  let otpError: string | null = null;
  if (session.loginId) {
    try {
      const appId = process.env.DERIV_APP_ID;
      const res = await fetch(
        "https://api.derivws.com/trading/v1/options/accounts/" + encodeURIComponent(session.loginId) + "/otp",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + session.accessToken,
            "Deriv-App-ID": appId ?? "",
          },
          cache: "no-store",
        }
      );
      const text = await res.text();
      otpResult = { status: res.status, body: text.substring(0, 1000) };
    } catch (err) {
      otpError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    session: {
      hasAccessToken: !!session.accessToken,
      tokenPrefix: session.accessToken?.substring(0, 10) + "...",
      loginId: session.loginId ?? "(missing)",
      scopes: session.scopes,
    },
    accountsTest: accountsResult,
    accountsError,
    otpTest: otpResult,
    otpError,
    envAppId: process.env.DERIV_APP_ID ? process.env.DERIV_APP_ID.substring(0, 6) + "..." : "(not set)",
  });
}
