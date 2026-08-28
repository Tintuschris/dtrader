import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This endpoint intentionally rejects transfer execution for now.
 *
 * Deriv requires a validate-before-submit flow, wallet UUIDs, an idempotency
 * key, and separate payloads for wallet transfers and MT5/cTrader transfers.
 * The former implementation sent incompatible fields and could not identify
 * the platform of an Options account, so it must never move customer funds.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Transfers are temporarily disabled while the required Deriv validation and confirmation flow is configured.",
    },
    { status: 503 },
  );
}
