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

function normaliseWallet(source: Record<string, unknown>): Wallet | null {
  const id = String(source.wallet_id ?? source.id ?? source.wallet_type ?? "");
  if (!id) return null;
  const balances = source.balances as Record<string, unknown> | undefined;
  const amount = source.balance ?? balances?.total ?? balances?.available ?? balances?.balance;
  return {
    id,
    walletType: String(source.wallet_type ?? source.type ?? "Wallet"),
    currency: String(source.currency ?? balances?.currency ?? "USD"),
    balance: typeof amount === "number" ? amount : Number.isFinite(Number(amount)) ? Number(amount) : null,
  };
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
    ? source.map((wallet) => normaliseWallet(wallet as Record<string, unknown>)).filter(Boolean)
    : [];
  return NextResponse.json({ wallets });
}
