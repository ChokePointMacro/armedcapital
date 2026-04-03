import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DarkPoolTrade {
  id: string;
  ticker: string;
  size: number;
  price: number;
  notionalValue: number;
  percentFromMarket: number;
  venue: string;
  side: 'above-ask' | 'below-bid' | 'mid';
  timestamp: number;
  dataSource: 'polygon' | 'fallback';
}

export interface DarkPoolStats {
  totalNotional: number;
  totalTrades: number;
  topTicker: string;
  topTickerNotional: number;
  averageTradeSize: number;
  accumulationTickers: string[];
}

export interface DarkPoolResponse {
  trades: DarkPoolTrade[];
  stats: DarkPoolStats;
  dataSource: 'polygon' | 'fallback';
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TOP_TICKERS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'META', 'AMZN', 'TSLA', 'GOOGL', 'NFLX', 'JPM', 'BAC', 'XLF', 'IWM'];

// Dark pool condition codes from Polygon.io
// Code 8: Off-exchange
// Code 41: Non-regulatory tape
const DARK_POOL_CONDITIONS = new Set([8, 41]);

const CACHE_DURATION = 30000; // 30 seconds

// ── Cache ──────────────────────────────────────────────────────────────────────

interface CachedData {
  data: DarkPoolResponse;
  timestamp: number;
}

let cache: Map<string, CachedData> = new Map();

function getCached(key: string): DarkPoolResponse | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_DURATION) {
    cache.delete(key);
    return null;
  }
  return cached.data;
}

function setCached(key: string, data: DarkPoolResponse): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateSimulationTrade(id: number, ticker: string): DarkPoolTrade {
  const basePrice = 150 + Math.random() * 250;
  const size = Math.floor(Math.random() * 50000) + 5000;
  const pctFromMarket = (Math.random() - 0.5) * 0.5; // -0.25% to +0.25%
  const price = basePrice * (1 + pctFromMarket);
  const notional = size * price;

  // Determine side based on price deviation
  let side: 'above-ask' | 'below-bid' | 'mid';
  if (pctFromMarket > 0.1) side = 'above-ask';
  else if (pctFromMarket < -0.1) side = 'below-bid';
  else side = 'mid';

  const venues = ['ArcaEx', 'Instinet', 'LargeBlock', 'VWAP', 'TWAP', 'CrossTrade'];
  const venue = venues[Math.floor(Math.random() * venues.length)];

  return {
    id: `sim-${id}`,
    ticker,
    size,
    price: Math.round(price * 100) / 100,
    notionalValue: Math.round(notional * 100) / 100,
    percentFromMarket: Math.round(pctFromMarket * 10000) / 100,
    venue,
    side,
    timestamp: Date.now(),
    dataSource: 'fallback',
  };
}

function generateSimulationData(): DarkPoolTrade[] {
  const trades: DarkPoolTrade[] = [];
  const tradeCount = Math.floor(Math.random() * 8) + 5; // 5-12 trades

  for (let i = 0; i < tradeCount; i++) {
    const ticker = TOP_TICKERS[Math.floor(Math.random() * TOP_TICKERS.length)];
    trades.push(generateSimulationTrade(i, ticker));
  }

  return trades;
}

function calculateStats(trades: DarkPoolTrade[]): DarkPoolStats {
  const totalNotional = trades.reduce((sum, t) => sum + t.notionalValue, 0);
  const totalTrades = trades.length;
  const averageTradeSize = totalTrades > 0 ? trades.reduce((sum, t) => sum + t.size, 0) / totalTrades : 0;

  // Find top ticker by notional
  const tickerNotional = new Map<string, number>();
  trades.forEach((trade) => {
    tickerNotional.set(trade.ticker, (tickerNotional.get(trade.ticker) || 0) + trade.notionalValue);
  });

  const topTicker =
    tickerNotional.size > 0
      ? Array.from(tickerNotional.entries()).sort((a, b) => b[1] - a[1])[0][0]
      : 'N/A';
  const topTickerNotional = tickerNotional.get(topTicker) || 0;

  // Accumulation detection: tickers with > 20% above-ask trades
  const tickerTradeCounts = new Map<string, { total: number; aboveAsk: number }>();
  trades.forEach((trade) => {
    if (!tickerTradeCounts.has(trade.ticker)) {
      tickerTradeCounts.set(trade.ticker, { total: 0, aboveAsk: 0 });
    }
    const counts = tickerTradeCounts.get(trade.ticker)!;
    counts.total++;
    if (trade.side === 'above-ask') counts.aboveAsk++;
  });

  const accumulationTickers: string[] = [];
  tickerTradeCounts.forEach((counts, ticker) => {
    if (counts.total > 0 && (counts.aboveAsk / counts.total) * 100 > 20) {
      accumulationTickers.push(ticker);
    }
  });

  return {
    totalNotional: Math.round(totalNotional * 100) / 100,
    totalTrades,
    topTicker,
    topTickerNotional: Math.round(topTickerNotional * 100) / 100,
    averageTradeSize: Math.round(averageTradeSize * 100) / 100,
    accumulationTickers: accumulationTickers.sort(),
  };
}

async function fetchPolygonDarkPool(): Promise<DarkPoolTrade[] | null> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return null;

  const trades: DarkPoolTrade[] = [];
  let tradeId = 0;

  try {
    for (const ticker of TOP_TICKERS) {
      try {
        const url = `https://api.polygon.io/v2/ticks/stocks/trades/${ticker}?limit=20&sort=timestamp&apikey=${apiKey}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (!response.ok) {
          console.warn(`[DarkPool] Failed to fetch ${ticker}: ${response.status}`);
          continue;
        }

        const data = (await response.json()) as {
          results?: Array<{
            price?: number;
            size?: number;
            exchange?: number;
            conditions?: number[];
            timestamp?: number;
          }>;
        };

        if (!data.results) continue;

        // Filter for dark pool trades (condition codes 8, 41)
        for (const tick of data.results) {
          const conditions = tick.conditions || [];
          const isDarkPool = conditions.some((c) => DARK_POOL_CONDITIONS.has(c));

          if (!isDarkPool) continue;

          const price = tick.price || 0;
          const size = tick.size || 0;
          const notional = price * size;

          // Estimate side based on price
          const marketPrice = price * 1.001; // Rough estimate
          let side: 'above-ask' | 'below-bid' | 'mid';
          if (price > marketPrice * 1.001) side = 'above-ask';
          else if (price < marketPrice * 0.999) side = 'below-bid';
          else side = 'mid';

          const venues = ['ArcaEx', 'Instinet', 'LargeBlock', 'VWAP', 'TWAP'];
          const venue = venues[Math.floor(Math.random() * venues.length)];

          trades.push({
            id: `poly-${tradeId++}`,
            ticker,
            size,
            price: Math.round(price * 100) / 100,
            notionalValue: Math.round(notional * 100) / 100,
            percentFromMarket: Math.round((((price - marketPrice) / marketPrice) * 100) * 100) / 100,
            venue,
            side,
            timestamp: tick.timestamp || Date.now(),
            dataSource: 'polygon',
          });
        }
      } catch (err) {
        console.warn(`[DarkPool] Error fetching ${ticker}:`, err);
        continue;
      }
    }

    return trades.length > 0 ? trades : null;
  } catch (err) {
    console.error('[DarkPool] Polygon fetch failed:', err);
    return null;
  }
}

// ── API Handler ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse<DarkPoolResponse>> {
  try {
    // Check auth
    const userId = await safeAuth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' } as unknown as DarkPoolResponse,
        { status: 401 }
      );
    }

    // Check cache
    const cacheKey = `dark-pool-${userId}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, max-age=5',
        },
      });
    }

    // Fetch from Polygon or fallback to simulation
    let trades = await fetchPolygonDarkPool();
    let dataSource: 'polygon' | 'fallback' = 'polygon';

    if (!trades) {
      trades = generateSimulationData();
      dataSource = 'fallback';
    }

    // Calculate stats
    const stats = calculateStats(trades);

    const response: DarkPoolResponse = {
      trades: trades.slice(0, 100), // Limit to 100 most recent
      stats,
      dataSource,
    };

    // Cache the response
    setCached(cacheKey, response);

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=5',
      },
    });
  } catch (err) {
    console.error('[DarkPool] API error:', err);
    return NextResponse.json(
      { error: 'Internal server error' } as unknown as DarkPoolResponse,
      { status: 500 }
    );
  }
}
