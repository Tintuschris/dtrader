import { NextResponse } from "next/server";
import { getActiveSymbols } from "../../../../lib/deriv-ws-client";

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
 * Map market/submarket codes to display names.
 * The Options API doesn't include display names for market/submarket.
 */
function getMarketDisplayName(market: string): string {
  const map: Record<string, string> = {
    synthetic_index: "Derived",
    forex: "Forex",
    indices: "Indices",
    cryptocurrency: "Cryptocurrency",
    commodities: "Commodities",
  };
  return map[market] ?? market;
}

function getSubmarketDisplayName(market: string, submarket: string): string {
  const map: Record<string, string> = {
    volatility_indices: "Volatility Indices",
    random_index: "Synthetics",
    crash_boom: "Crash/Boom",
    range_break: "Range Break",
    major_pairs: "Major Pairs",
    forex_basket: "Forex Baskets",
    gold: "Gold",
    silver: "Silver",
    oil: "Oil",
    bitcoin: "Bitcoin",
    ethereum: "Ethereum",
    cryptocurrency_major: "Cryptocurrency Major",
  };
  return map[submarket] ?? submarket;
}

/**
 * GET /api/deriv/markets
 *
 * Fetches ALL active trading symbols from Deriv using the Options API public WebSocket.
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

  try {
    // Use Options API public WebSocket to get active symbols
    const symbols = await getActiveSymbols();

    // Extract and categorize symbols
    // Options API uses: underlying_symbol, underlying_symbol_name, market, submarket
    const symbolMap = new Map<string, Market>();
    for (const s of symbols) {
      const sym = s.underlying_symbol;
      if (!sym || symbolMap.has(sym)) continue;

      const isOpen = s.exchange_is_open;
      if (isOpen !== 1) continue;

      const market = s.market ?? "";
      const submarket = s.submarket ?? "";

      symbolMap.set(sym, {
        symbol: sym,
        display_name: s.underlying_symbol_name ?? sym,
        market,
        market_display_name: getMarketDisplayName(market),
        submarket,
        submarket_display_name: getSubmarketDisplayName(market, submarket),
        exchange_is_open: 1,
      });
    }

    const markets = Array.from(symbolMap.values())
      .sort((a, b) => {
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
    { symbol: "1HZ100V", display_name: "Volatility 100 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ75V", display_name: "Volatility 75 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ50V", display_name: "Volatility 50 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ25V", display_name: "Volatility 25 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ10V", display_name: "Volatility 10 (1s) Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ100", display_name: "Volatility 100 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ75", display_name: "Volatility 75 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ50", display_name: "Volatility 50 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ25", display_name: "Volatility 25 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "1HZ10", display_name: "Volatility 10 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "random_index", submarket_display_name: "Synthetics", exchange_is_open: 1 },
    { symbol: "BOOM500", display_name: "Boom 500 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "BOOM1000", display_name: "Boom 1000 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "CRASH500", display_name: "Crash 500 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "CRASH1000", display_name: "Crash 1000 Index", market: "synthetic_index", market_display_name: "Derived", submarket: "crash_boom", submarket_display_name: "Crash/Boom", exchange_is_open: 1 },
    { symbol: "RDBULL", display_name: "Bull Market Index", market: "synthetic_index", market_display_name: "Derived", submarket: "range_break", submarket_display_name: "Range Break", exchange_is_open: 1 },
    { symbol: "RDBEAR", display_name: "Bear Market Index", market: "synthetic_index", market_display_name: "Derived", submarket: "range_break", submarket_display_name: "Range Break", exchange_is_open: 1 },
    { symbol: "frxEURUSD", display_name: "EUR/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxGBPUSD", display_name: "GBP/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDJPY", display_name: "USD/JPY", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxAUDUSD", display_name: "AUD/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDCAD", display_name: "USD/CAD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxUSDCHF", display_name: "USD/CHF", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
    { symbol: "frxNZDUSD", display_name: "NZD/USD", market: "forex", market_display_name: "Forex", submarket: "major_pairs", submarket_display_name: "Major Pairs", exchange_is_open: 1 },
  ];
}
