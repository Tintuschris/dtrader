import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { getOptionsAccounts } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists Options accounts from Deriv REST.
 * Uses PAT directly since the Options REST API requires it.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ accounts: [], error: "Not authenticated" }, { status: 401 });
  }

  // The Options API REST endpoint requires a PAT, not an OAuth token.
  const pat = process.env.DERIV_PAT;
  if (!pat) {
    return NextResponse.json({ accounts: [], error: "DERIV_PAT not configured on the server." }, { status: 500 });
  }

  try {
    // Use PAT directly — the session's OAuth token doesn't work with Options REST
    const optionsAccounts = await getOptionsAccounts(pat);
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
    console.info("[deriv:balances] received", { count: accounts.length });
    return NextResponse.json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load trading accounts";
    console.error("[deriv:balances] failed", { error: message });
    return NextResponse.json({ accounts: [], error: message }, { status: 500 });
  }
}
