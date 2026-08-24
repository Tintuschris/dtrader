import { NextResponse } from "next/server";
import { clearSession } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deriv/logout
 *
 * Clears the user's session cookie and returns success.
 */
export async function POST() {
  await clearSession();
  return NextResponse.json({ success: true });
}
