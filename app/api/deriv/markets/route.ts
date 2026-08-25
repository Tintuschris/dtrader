import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Market = {
  symbol: string;
  display_name: string;
  market: string;
  market_display_name: string;
  submarket: string;
  submarket_display_name: string;
  exchange_is_open: number;
};

/* ------------------------------------------------------------------ */
/*  In-memory cache (shared across requests in the same server)       */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedMarkets: Market[] | null = null;
let cacheTimestamp = 0;

function getCachedMarkets(): Market[] | null {
  if (cachedMarkets && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedMarkets;
  }
  return null;
}

function setCachedMarkets(markets: Market[]): void {
  cachedMarkets = markets;
  cacheTimestamp = Date.now();
}

/**
 * GET /api/deriv/markets
 *
 * Fetches ALL active trading symbols from Deriv using the active_symbols endpoint.
 * Results are cached in memory for 1 hour.
 */
export async function GET(request: Request) {
  // Allow cache bypass with ?refresh=1
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  // Return cached data if available
  if (!forceRefresh) {
    const cached = getCachedMarkets();
    if (cached) {
      return NextResponse.json(
        { markets: cached, cached: true, count: cached.length },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
          },
        },
      );
    }
  }

  // Try OAuth session first
  const session = await getSession();
  let headers: Record<string, string> | null = null;

  if (session?.accessToken) {
    headers = await getAuthHeaders();
  }

  if (!headers) {
    return NextResponse.json(
      { markets: getDefaultMarkets(), cached: false, count: getDefaultMarkets().length },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
        },
      },
    );
  }

  try {
    // Use active_symbols endpoint to get ALL available markets
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/active-symbols",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          active_symbols: "brief",
          product_type: "basic",
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error("active_symbols returned", response.status);
      const markets = getDefaultMarkets();
      setCachedMarkets(markets);
      return NextResponse.json(
        { markets, cached: false, count: markets.length },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
          },
        },
      );
    }

    const payload = await response.json().catch(() => null);
    const symbols = payload?.active_symbols ?? [];

    // Extract and categorize symbols
    const symbolMap = new Map<string, Market>();
    for (const s of symbols) {
      const sym = s.symbol;
      if (!sym || symbolMap.has(sym)) continue;

      // Include symbols suitable for digit trading
      const name = s.display_name ?? s.longcode ?? sym;
      const market = s.market ?? "";
      const marketName = s.market_display_name ?? market;
      const submarket = s.submarket ?? "";
      const submarketName = s.submarket_display_name ?? submarket;

      // Only include synthetic indices and forex for digit trading
      const isOpen = s.exchange_is_open ?? 1;
      if (isOpen !== 1) continue;

      symbolMap.set(sym, {
        symbol: sym,
        display_name: name,
        market,
        market_display_name: marketName,
        submarket,
        submarket_display_name: submarketName,
        exchange_is_open: 1,
      });
    }

    const markets = Array.from(symbolMap.values())
      .sort((a, b) => {
        // Sort by market display name, then by symbol name
        const marketCmp = a.market_display_name.localeCompare(b.market_display_name);
        if (marketCmp !== 0) return marketCmp;
        return a.display_name.localeCompare(b.display_name);
      });

    const result = markets.length > 0 ? markets : getDefaultMarkets();
    setCachedMarkets(result);

    return NextResponse.json(
      { markets: result, cached: false, count: result.length },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("Failed to fetch markets:", err);
    const markets = getDefaultMarkets();
    setCachedMarkets(markets);
    return NextResponse.json(
      { markets, cached: false, count: markets.length },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
        },
      },
    );
  }
}

function getDefaultMarkets(): Market[] {
  return [
    // Volatility Indices
    { symbol: "1HZ100V", display_name: "Volatility 100 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ75V", display_name: "Volatility 75 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ50V", display_name: "Volatility 50 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ25V", display_name: "Volatility 25 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ10V", display_name: "Volatility 10 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ100", display_name: "Volatility 100 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ75", display_name: "Volatility 75 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ50", display_name: "Volatility 50 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ25", display_name: "Volatility 25 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    { symbol: "1HZ10", display_name: "Volatility 10 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "volatility_indices", submarket_display_name: "Volatility Indices", exchange_is_open: 1 },
    // Crash/Boom
    { symbol: "BOOM500", display_name: "Boom 500 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "BOOM1000", display_name: "Boom 1000 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "CRASH500", display_name: "Crash 500 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "CRASH1000", display_name: "Crash 1000 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    // Range Break
    { symbol: "RDBULL", display_name: "Bull Market Index", market: "synthetic_index", market_display_name: "Derived", submarket: "range_break", submarket_display_name: "Range Break", exchange_is_open: 1 },
    { symbol: "RDBEAR", display_name: "Bear Market Index", market: "synthetic_index", market_display_name: "Derived", submarket: "range_break", submarket_display_name: "Range Break", exchange_is_open: 1 },
    // Forex Majors
    { symbol: "frxEURUSD", display_name: "EUR/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxGBPUSD", display_name: "GBP/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDJPY", display_name: "USD/JPY", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxAUDUSD", display_name: "AUD/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDCAD", display_name: "USD/CAD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDCHF", display_name: "USD/CHF", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxNZDUSD", display_name: "NZD/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDsgd", display_name: "USD/SGD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
  ];
}
