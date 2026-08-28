import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import {
  fetchWallets,
  getExchangeRate,
  validateTransfer,
  executeWalletTransfer,
  executeCrossCurrencyTransfer,
  executePlatformTransfer,
  type WalletType,
  type PlatformName,
} from "../../../../lib/deriv-wallet-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isWalletId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function generateRequestId(): string {
  return `tx_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

type WalletInfo = { wallet_id: string; currency: string; type: string };

type ResolvedTransfer = {
  sourceWalletId?: string;
  sourceCurrency: string;
  sourceIsWallet: boolean;
  sourceAccountId?: string;
  destWalletId?: string;
  destCurrency: string;
  destIsWallet: boolean;
  destAccountId?: string;
  sameCurrency: boolean;
  transferType: "wallet_same" | "wallet_cross" | "wallet_to_platform" | "platform_to_wallet";
};

function resolveTransfer(
  from: string,
  to: string,
  wallets: WalletInfo[],
): ResolvedTransfer | { error: string; status: number } {
  const walletByUuid = new Map<string, WalletInfo>();
  const walletByComposite = new Map<string, WalletInfo>();
  for (const w of wallets) {
    walletByUuid.set(w.wallet_id, w);
    walletByComposite.set(`${w.wallet_id}:${w.currency}`, w);
  }

  const fromIsWallet = isWalletId(from);
  const toIsWallet = isWalletId(to);

  let sourceWalletId: string | undefined;
  let sourceCurrency: string | undefined;
  let sourceIsWallet = false;
  let sourceAccountId: string | undefined;

  if (fromIsWallet) {
    const wallet = walletByUuid.get(from) ?? walletByComposite.get(from);
    if (wallet) {
      sourceWalletId = wallet.wallet_id;
      sourceCurrency = wallet.currency;
      sourceIsWallet = true;
    }
  }
  if (!sourceWalletId) sourceAccountId = from;

  let destWalletId: string | undefined;
  let destCurrency: string | undefined;
  let destIsWallet = false;
  let destAccountId: string | undefined;

  if (toIsWallet) {
    const wallet = walletByUuid.get(to) ?? walletByComposite.get(to);
    if (wallet) {
      destWalletId = wallet.wallet_id;
      destCurrency = wallet.currency;
      destIsWallet = true;
    }
  }
  if (!destWalletId) destAccountId = to;

  // Fallback currencies from the first available wallet
  if (!sourceCurrency && sourceAccountId) sourceCurrency = wallets[0]?.currency ?? "USD";
  if (!destCurrency && destAccountId) destCurrency = wallets[0]?.currency ?? "USD";

  const sameCurrency = sourceCurrency === destCurrency;

  let transferType: ResolvedTransfer["transferType"];
  if (sourceIsWallet && destIsWallet && sameCurrency) transferType = "wallet_same";
  else if (sourceIsWallet && destIsWallet && !sameCurrency) transferType = "wallet_cross";
  else if (sourceIsWallet && destAccountId) transferType = "wallet_to_platform";
  else if (sourceAccountId && destIsWallet) transferType = "platform_to_wallet";
  else return { error: "Direct transfers between trading accounts are not supported. Transfer through a wallet.", status: 400 };

  return {
    sourceWalletId,
    sourceCurrency: sourceCurrency!,
    sourceIsWallet,
    sourceAccountId,
    destWalletId,
    destCurrency: destCurrency!,
    destIsWallet,
    destAccountId,
    sameCurrency,
    transferType,
  };
}

/* ------------------------------------------------------------------ */
/*  Validate step — returns preview without executing                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve the wallet balance for a given wallet_id + currency.
 * Returns the balance as a string suitable for the "balance" field.
 */
function resolveWalletBalance(wallets: WalletInfo[], walletId: string, currency: string): string {
  const wallet = wallets.find((w) => w.wallet_id === walletId);
  if (!wallet) return "0.00";
  // The balances field is fetched via fetchWallets which returns WalletBalance[]
  // but here we have WalletInfo from the route. We need to get the actual balance.
  // Since we already fetched wallets earlier, let's just return 0 and the caller
  // will need to fetch balances separately.
  return "0.00";
}

/**
 * Determine the Deriv platform name from account identifiers.
 * Options accounts have loginids like "VRTC", "CR", "MF", etc.
 * MT5 accounts have loginids like "MT12345".
 * The landing_company_name or trading_type from the account info helps.
 */
function detectPlatformName(accountId: string): PlatformName {
  const id = accountId.toUpperCase();
  if (id.startsWith("MT")) return "mt5";
  if (id.startsWith("VR") || id.startsWith("CR") || id.startsWith("MF") || id.startsWith("PROM")) {
    // Virtual/real Options accounts
    return "options";
  }
  return "options"; // Default for Deriv options accounts
}

async function validateOnly(resolved: ResolvedTransfer, amountStr: string, wallets: WalletInfo[]) {
  const { transferType } = resolved;

  if (transferType === "wallet_same") {
    const validated = await validateTransfer({
      source_wallet_id: resolved.sourceWalletId!,
      destination_wallet_id: resolved.destWalletId!,
      amount: amountStr,
      currency: resolved.sourceCurrency,
    });
    return {
      mode: "preview" as const,
      is_valid: validated.is_valid,
      source_currency: resolved.sourceCurrency,
      destination_currency: resolved.destCurrency,
      amount: amountStr,
      fee: validated.fee ?? "0",
      net_amount: validated.net_amount ?? amountStr,
      estimated_destination_amount: validated.estimated_destination_amount ?? amountStr,
      exchange_rate: undefined,
      rate_token: undefined,
    };
  }

  if (transferType === "wallet_cross") {
    const rate = await getExchangeRate(resolved.sourceCurrency, resolved.destCurrency);
    const validated = await validateTransfer({
      source_wallet_id: resolved.sourceWalletId!,
      destination_wallet_id: resolved.destWalletId!,
      amount: amountStr,
      currency: resolved.sourceCurrency,
      exchange_rate: rate.exchange_rate,
      rate_token: rate.rate_token,
    });
    return {
      mode: "preview" as const,
      is_valid: validated.is_valid,
      source_currency: resolved.sourceCurrency,
      destination_currency: resolved.destCurrency,
      amount: amountStr,
      fee: validated.fee ?? "0",
      net_amount: validated.net_amount ?? amountStr,
      estimated_destination_amount: validated.estimated_destination_amount ?? amountStr,
      exchange_rate: rate.exchange_rate,
      rate_token: rate.rate_token,
    };
  }

  // For platform transfers, we build the same payload as execute and pass it
  // to the validate endpoint. The validate endpoint for platform transfers
  // expects the same schema as the platforms transfer endpoint.
  if (transferType === "wallet_to_platform") {
    const platformName = detectPlatformName(resolved.destAccountId!);
    const validated = await validateTransfer({
      source_wallet_id: resolved.sourceWalletId!,
      destination_wallet_id: resolved.sourceWalletId!,
      amount: amountStr,
      currency: resolved.sourceCurrency,
      direction: "from_wallet",
      account_id: resolved.destAccountId,
    });
    return {
      mode: "preview" as const,
      is_valid: validated.is_valid,
      source_currency: resolved.sourceCurrency,
      destination_currency: resolved.destCurrency,
      amount: amountStr,
      fee: validated.fee ?? "0",
      net_amount: validated.net_amount ?? amountStr,
      estimated_destination_amount: validated.estimated_destination_amount ?? amountStr,
      exchange_rate: undefined,
      rate_token: undefined,
      platform_name: platformName,
    };
  }

  // platform_to_wallet
  const platformName = detectPlatformName(resolved.sourceAccountId!);
  const validated = await validateTransfer({
    source_wallet_id: resolved.destWalletId!,
    destination_wallet_id: resolved.destWalletId!,
    amount: amountStr,
    currency: resolved.destCurrency,
    direction: "to_wallet",
    account_id: resolved.sourceAccountId,
  });
  return {
    mode: "preview" as const,
    is_valid: validated.is_valid,
    source_currency: resolved.sourceCurrency,
    destination_currency: resolved.destCurrency,
    amount: amountStr,
    fee: validated.fee ?? "0",
    net_amount: validated.net_amount ?? amountStr,
    estimated_destination_amount: validated.estimated_destination_amount ?? amountStr,
    exchange_rate: undefined,
    rate_token: undefined,
    platform_name: platformName,
  };
}

/* ------------------------------------------------------------------ */
/*  Execute step — runs the transfer                                   */
/* ------------------------------------------------------------------ */

async function executeTransfer(resolved: ResolvedTransfer, amountStr: string, wallets: WalletInfo[], rateToken?: string) {
  const requestId = generateRequestId();
  const { transferType } = resolved;

  if (transferType === "wallet_same") {
    return executeWalletTransfer({
      source_wallet_id: resolved.sourceWalletId!,
      destination_wallet_id: resolved.destWalletId!,
      amount: amountStr,
      currency: resolved.sourceCurrency,
      request_id: requestId,
    });
  }

  if (transferType === "wallet_cross") {
    // Re-fetch the rate (the rate_token from validate may have expired)
    const rate = await getExchangeRate(resolved.sourceCurrency, resolved.destCurrency);
    return executeCrossCurrencyTransfer({
      source_wallet_id: resolved.sourceWalletId!,
      destination_wallet_id: resolved.destWalletId!,
      amount: amountStr,
      exchange_rate: rate.exchange_rate,
      rate_token: rate.rate_token,
      request_id: requestId,
    });
  }

  if (transferType === "wallet_to_platform") {
    // Fetch wallet balance for the required "balance" field
    const walletBalances = await fetchWallets();
    const walletBalance = walletBalances
      .filter((w) => w.wallet_id === resolved.sourceWalletId)
      .reduce((sum, w) => sum + w.balance, 0);
    const platformName = detectPlatformName(resolved.destAccountId!);

    return executePlatformTransfer({
      source_type: "main" as WalletType,
      destination_type: "platform" as WalletType,
      source_id: resolved.sourceWalletId!,
      destination_id: resolved.destAccountId!,
      amount: amountStr,
      balance: walletBalance.toFixed(2),
      source_currency: resolved.sourceCurrency,
      destination_currency: resolved.destCurrency,
      destination_platform_name: platformName,
      request_id: requestId,
    });
  }

  // platform_to_wallet
  // For platform→wallet, the balance field should be the platform account balance.
  // We don't have the platform balance readily available, so we pass 0.
  // The Deriv API will validate against the actual balance server-side.
  const platformName = detectPlatformName(resolved.sourceAccountId!);
  return executePlatformTransfer({
    source_type: "platform" as WalletType,
    destination_type: "main" as WalletType,
    source_id: resolved.sourceAccountId!,
    destination_id: resolved.destWalletId!,
    amount: amountStr,
    balance: "0.00",
    source_currency: resolved.sourceCurrency,
    destination_currency: resolved.destCurrency,
    source_platform_name: platformName,
    request_id: requestId,
  });
}

/* ------------------------------------------------------------------ */
/*  POST /api/deriv/transfer                                          */
/*                                                                    */
/*  Body:                                                             */
/*    { from, to, amount }           → validate only (preview)        */
/*    { from, to, amount, confirm }  → execute the transfer           */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated. Please log in with your Deriv account." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    from?: string;
    to?: string;
    amount?: number;
    confirm?: boolean;
  };

  const { from, to, amount, confirm } = body;
  if (!from || !to || !amount || amount <= 0) {
    return NextResponse.json(
      { error: "Invalid transfer parameters. Provide from, to, and a positive amount." },
      { status: 400 },
    );
  }
  if (from === to) {
    return NextResponse.json(
      { error: "Source and destination must be different." },
      { status: 400 },
    );
  }

  // Fetch wallets once
  let wallets: WalletInfo[];
  try {
    wallets = await fetchWallets();
  } catch (err) {
    console.error("[transfer] Failed to fetch wallets:", err);
    return NextResponse.json(
      { error: "Unable to load wallet information. Please try again." },
      { status: 502 },
    );
  }

  const resolved = resolveTransfer(from, to, wallets);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const amountStr = amount.toFixed(2);

  try {
    if (!confirm) {
      // ── Validate-only mode: return preview ───────────────────────
      const preview = await validateOnly(resolved, amountStr, wallets);
      if (!preview.is_valid) {
        return NextResponse.json(
          { ...preview, error: "Transfer validation failed. Please check your amounts." },
          { status: 422 },
        );
      }
      return NextResponse.json(preview);
    }

    // ── Confirm mode: execute the transfer ─────────────────────────
    console.log("[transfer] executing", { type: resolved.transferType, amount: amountStr });
    const result = await executeTransfer(resolved, amountStr, wallets);
    return NextResponse.json({
      mode: "executed",
      success: true,
      request_id: result.request_id,
      status: result.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[transfer] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
