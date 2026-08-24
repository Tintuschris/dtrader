import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/auth
 *
 * Generates a Deriv OAuth 2.0 authorization URL with PKCE,
 * stores the code_verifier and state in a short-lived cookie,
 * and returns the redirect URL for the client to navigate to.
 */
export async function GET() {
  const clientId = process.env.DERIV_APP_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "DERIV_APP_ID is not configured on the server." },
      { status: 503 },
    );
  }

  // Derive the redirect URI from the request origin.
  // In production, set DERIV_REDIRECT_URI explicitly.
  const redirectUri =
    process.env.DERIV_REDIRECT_URI ?? "http://localhost:3000/api/deriv/callback";

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Generate a random state parameter for CSRF protection
  const state = crypto.randomUUID();

  // Store code_verifier and state in a short-lived cookie for the callback
  const store = await cookies();
  store.set(
    "dtrader_oauth",
    JSON.stringify({ codeVerifier, state }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 minutes
    },
  );

  // Build the authorization URL
  const authUrl = new URL("https://auth.deriv.com/oauth2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "trade account_manage");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return NextResponse.json({ url: authUrl.toString() });
}

/* ---- PKCE helpers ---- */

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
