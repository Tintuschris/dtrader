import { NextResponse } from "next/server";
import { getAuthHeaders, getSession } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Wallet = {
  id: string;
  walletType: string;
  currency: string;
  balance: number | null;
};

function normaliseWallet(source: Record<string, unknown>): Wallet[] {
  const walletId = String(source.wallet_id ?? source.id ?? "");
  const balances = source.balances as Record<string, { balance?: string | number }> | undefined;
  if (!walletId || !balances) return [];
  return Object.entries(balances).map(([currency, value]) => ({
    id: `${walletId}:${currency}`,
    walletType: String(source.type ?? source.wallet_type ?? "Wallet"),
    currency,
    balance: Number.isFinite(Number(value?.balance)) ? Number(value.balance) : null,
  }));
}

export async function GET() {
  const session = await getSession();
  const headers = await getAuthHeaders();
  if (!session || !headers) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const response = await fetch("https://api.derivws.com/wallet/v1/wallets?conversion_currency=USD", {
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message ?? "Unable to load wallet balances. Please sign in again with the payment permission.";
    return NextResponse.json({ wallets: [], error: message }, { status: response.status });
  }

  const source = payload?.data?.wallets ?? payload?.data ?? payload?.wallets ?? [];
  const wallets = Array.isArray(source)
    ? source.flatMap((wallet) => normaliseWallet(wallet as Record<string, unknown>))
    : [];
  console.info("[deriv:wallets] received", { count: wallets.length });
  return NextResponse.json({ wallets });
}
