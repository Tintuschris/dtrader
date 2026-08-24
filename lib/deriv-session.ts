import { cookies } from "next/headers";

const SESSION_COOKIE = "dtrader_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type SessionData = {
  accessToken: string;
  tokenType: string;
  scopes: string[];
  loginId?: string;
};

/**
 * Save the OAuth session to an httpOnly cookie.
 * Uses a simple base64-encoded JSON payload for now.
 * For production, use an encrypted cookie or JWT.
 */
export async function saveSession(data: SessionData): Promise<void> {
  const store = await cookies();
  const payload = JSON.stringify(data);
  const encoded = Buffer.from(payload).toString("base64");
  store.set(SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Read the OAuth session from the cookie.
 * Returns null if not authenticated.
 */
export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const data = JSON.parse(decoded) as SessionData;
    if (!data.accessToken) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Clear the session cookie (logout).
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Get the authorization headers for Deriv API calls.
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const session = await getSession();
  const appId = process.env.DERIV_APP_ID;
  if (!session || !appId) return null;
  return {
    "Deriv-App-ID": appId,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

/**
 * Get the Deriv App ID.
 */
export function getAppId(): string | undefined {
  return process.env.DERIV_APP_ID;
}
