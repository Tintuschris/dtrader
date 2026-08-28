import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { getOptionsAccounts } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists Options accounts from Deriv REST.
 * getOptionsAccounts automatically falls back to PAT if the OAuth token is rejected.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ accounts: [], error: "Not authenticated" }, { status: 401 });
  }

  try {
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
    console.info("[deriv:balances] received", { count: accounts.length });
    return NextResponse.json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load trading accounts";
    console.error("[deriv:balances] failed", { error: message });
    return NextResponse.json({ accounts: [], error: message }, { status: 500 });
  }
}
