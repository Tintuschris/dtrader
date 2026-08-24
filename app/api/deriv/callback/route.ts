import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { saveSession } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/callback?code=...&state=...
 *
 * Handles the OAuth 2.0 callback from Deriv:
 * 1. Validates the state parameter (CSRF protection)
 * 2. Exchanges the authorization code for an access token
 * 3. Saves the token in an httpOnly session cookie
 * 4. Redirects the user back to the trading terminal
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // If Deriv returned an error, redirect with error message
  if (error) {
    const errorDesc = searchParams.get("error_description") ?? "Authorization failed";
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(errorDesc)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/?auth_error=Missing+authorization+code", request.url),
    );
  }

  // Read the stored OAuth state and code_verifier
  const store = await cookies();
  const oauthCookie = store.get("dtrader_oauth")?.value;
  if (!oauthCookie) {
    return NextResponse.redirect(
      new URL("/?auth_error=Session+expired.+Please+try+again.", request.url),
    );
  }

  let stored: { codeVerifier: string; state: string };
  try {
    stored = JSON.parse(oauthCookie);
  } catch {
    return NextResponse.redirect(
      new URL("/?auth_error=Invalid+session+data", request.url),
    );
  }

  // Validate state (CSRF protection)
  if (stored.state !== state) {
    return NextResponse.redirect(
      new URL("/?auth_error=State+mismatch.+CSRF+attack+blocked.", request.url),
    );
  }

  // Clear the temporary OAuth cookie
  store.delete("dtrader_oauth");

  // Exchange the authorization code for tokens
  // Deriv OAuth uses PKCE — no client_secret needed
  const clientId = process.env.DERIV_APP_ID;
  const redirectUri =
    process.env.DERIV_REDIRECT_URI ?? "http://localhost:3000/api/deriv/callback";

  if (!clientId) {
    return NextResponse.redirect(
      new URL("/?auth_error=Server+configuration+error", request.url),
    );
  }

  try {
    const tokenBody: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: stored.codeVerifier,
    }

    const tokenResponse = await fetch(
      "https://auth.deriv.com/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(tokenBody).toString(),
      },
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text().catch(() => "Unknown error");
      console.error("Token exchange failed:", tokenResponse.status, errText);
      return NextResponse.redirect(
        new URL(
          `/auth_error=Token+exchange+failed+(${tokenResponse.status})`,
          request.url,
        ),
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
    };

    if (!tokenData.access_token) {
      return NextResponse.redirect(
        new URL("/?auth_error=No+access+token+received", request.url),
      );
    }

    // Save the session
    await saveSession({
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type ?? "Bearer",
      scopes: tokenData.scope?.split(" ") ?? [],
    });

    // Redirect back to the trading terminal
    return NextResponse.redirect(new URL("/?auth=success", request.url));
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/?auth_error=Authentication+failed.+Please+try+again.", request.url),
    );
  }
}
