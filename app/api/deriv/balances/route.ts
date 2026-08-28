import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest, getOptionsAccounts } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists Options accounts from Deriv REST. This response already includes each
 * account balance, so opening an OTP WebSocket per account only adds latency
 * and can exhaust connection limits.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ accounts: [], error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Primary: fetch balance via Core API v3 WebSocket (supports OAuth tokens directly)
    try {
      const { result, accountId, accountType } = await derivV3AuthRequest<{
        balance?: { balance?: string; currency?: string };
      }>(
        session.accessToken,
        { balance: 1 },
        "balance",
        session.loginId ?? undefined,
      );
      const bal = Number(result.balance?.balance ?? 0);
      const currency = result.balance?.currency ?? "USD";
      const accounts = [{
        id: accountId || session.loginId || "unknown",
        loginid: accountId || session.loginId || "unknown",
        type: accountType,
        currency,
        balance: Number.isFinite(bal) ? bal : null,
        account_type: "Core",
        account_subtype: "Active",
        is_wallet: false,
      }];
      console.info("[deriv:balances] Core API balance OK", { accountId, balance: bal, currency });
      return NextResponse.json({ accounts });
    } catch (coreErr) {
      console.warn("[deriv:balances] Core API balance failed, trying Options REST fallback:", coreErr instanceof Error ? coreErr.message : coreErr);
    }

    // Fallback: Options REST API (may fail if token format is incompatible)
    const optionsAccounts = await getOptionsAccounts(session.accessToken);
    const accounts = optionsAccounts.map((account) => ({
      id: account.id,
      loginid: account.id,
      type: account.type,
      currency: account.currency,
      balance: account.balance,
      account_type: "Options",
      account_subtype: account.status ?? "Active",
      is_wallet: false,
    }));
    console.info("[deriv:balances] Options REST fallback received", { count: accounts.length });
    return NextResponse.json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load trading accounts";
    console.error("[deriv:balances] failed", { error: message });
    return NextResponse.json({ accounts: [], error: message }, { status: 500 });
  }
}
