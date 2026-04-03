import { NextRequest, NextResponse } from 'next/server';

// In-memory cache with TTL
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: any; ts: number }>();

// Common ticker name mappings
const TICKER_NAMES: Record<string, string> = {
  // Crypto
  'BTC': 'Bitcoin',
  'ETH': 'Ethereum',
  'SOL': 'Solana',
  'XRP': 'Ripple',
  'ADA': 'Cardano',
  // Indexes
  'SPX': 'S&P 500',
  'NDX': 'Nasdaq 100',
  'DXY': 'US Dollar Index',
  'VIX': 'Volatility Index',
  // Tech
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'GOOGL': 'Alphabet',
  'AMZN': 'Amazon',
  'NVDA': 'Nvidia',
  'META': 'Meta',
  'TSLA': 'Tesla',
  'AMD': 'Advanced Micro Devices',
  'MSTR': 'MicroStrategy',
};

// Yahoo Finance symbols
const YAHOO_SYMBOLS: Record<string, string> = {
  'BTC': 'BTC-USD',
  'ETH': 'ETH-USD',
  'SOL': 'SOL-USD',
  'XRP': 'XRP-USD',
  'ADA': 'ADA-USD',
  'SPX': '%5EGSPC',
  'NDX': '%5EIXIC',
  'DXY': 'DX-Y.CBT',
  'VIX': '%5EVIX',
};

// Crypto symbols don't have options
const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'ADA']);
const INDEX_SYMBOLS = new Set(['SPX', 'NDX', 'DXY', 'VIX']);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

interface TickerResponse {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  high52w: number | null;
  low52w: number | null;
  options: {
    callVolume: number;
    putVolume: number;
    putCallRatio: number;
    totalOI: number;
    ivRank: number | null;
  } | null;
  news: Array<{
    title: string;
    url: string;
    published: string;
    source: string;
  }>;
  source: 'polygon' | 'yahoo' | 'unavailable';
}

// ── Yahoo Finance: price, volume, 52W ─────────────────────────────────────
async function fetchYahooData(symbol: string): Promise<any> {
  try {
    const yahooSym = YAHOO_SYMBOLS[symbol] || symbol;
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=1y`,
      { headers: HEADERS }
    );

    if (!res.ok) {
      console.error(`[Yahoo] ${symbol} returned ${res.status}`);
      return null;
    }

    const data = await res.json() as any;
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quote = result.indicators?.quote?.[0];
    if (!quote) return null;

    // Current price from meta (most reliable)
    const price = meta.regularMarketPrice ?? null;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;

    let change: number | null = null;
    let changePercent: number | null = null;
    if (price !== null && previousClose !== null && previousClose !== 0) {
      change = price - previousClose;
      changePercent = (change / previousClose) * 100;
    }

    // 52W high/low from the year of daily data
    const highs = (quote.high || []).filter((h: any) => h != null && !isNaN(h));
    const lows = (quote.low || []).filter((l: any) => l != null && !isNaN(l));

    // Volume from most recent trading day
    const volumes = quote.volume || [];
    const latestVolume = volumes[volumes.length - 1] ?? null;

    return {
      price,
      change: change !== null ? parseFloat(change.toFixed(4)) : null,
      changePercent: changePercent !== null ? parseFloat(changePercent.toFixed(4)) : null,
      volume: latestVolume,
      marketCap: meta.marketCap ?? null,
      high52w: highs.length > 0 ? Math.max(...highs) : null,
      low52w: lows.length > 0 ? Math.min(...lows) : null,
    };
  } catch (error) {
    console.error(`[Yahoo] Error fetching ${symbol}:`, error);
    return null;
  }
}

// ── Yahoo Finance: options chain ──────────────────────────────────────────
async function fetchYahooOptions(symbol: string): Promise<any> {
  if (CRYPTO_SYMBOLS.has(symbol) || INDEX_SYMBOLS.has(symbol)) return null;

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/options/${symbol}`,
      { headers: HEADERS }
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    const chain = data.optionChain?.result?.[0];
    if (!chain || !chain.options || chain.options.length === 0) return null;

    const opts = chain.options[0];
    const calls = opts.calls || [];
    const puts = opts.puts || [];

    let callVolume = 0;
    let putVolume = 0;
    let totalOI = 0;
    let ivSum = 0;
    let ivCount = 0;

    for (const c of calls) {
      callVolume += c.volume || 0;
      totalOI += c.openInterest || 0;
      if (c.impliedVolatility) {
        ivSum += c.impliedVolatility;
        ivCount++;
      }
    }

    for (const p of puts) {
      putVolume += p.volume || 0;
      totalOI += p.openInterest || 0;
      if (p.impliedVolatility) {
        ivSum += p.impliedVolatility;
        ivCount++;
      }
    }

    const putCallRatio = callVolume > 0 ? putVolume / callVolume : 0;
    const avgIV = ivCount > 0 ? (ivSum / ivCount) * 100 : null; // convert to percentage

    // Approximate IV Rank (0-100) — uses avg IV vs typical range
    // Without historical IV data, estimate based on current IV level
    let ivRank: number | null = null;
    if (avgIV !== null) {
      // Simple heuristic: map typical IV ranges to rank
      // Low IV ~15-20% → rank ~20, Medium ~30-40% → rank ~50, High ~60%+ → rank ~80+
      ivRank = Math.min(100, Math.max(0, Math.round((avgIV - 10) * 1.5)));
    }

    return {
      callVolume,
      putVolume,
      putCallRatio: parseFloat(putCallRatio.toFixed(2)),
      totalOI,
      ivRank,
    };
  } catch (error) {
    console.error(`[Yahoo Options] Error fetching ${symbol}:`, error);
    return null;
  }
}

// ── Polygon.io: options (preferred if key available) ──────────────────────
async function fetchPolygonOptions(symbol: string): Promise<any> {
  try {
    const key = process.env.POLYGON_API_KEY;
    if (!key) return null;

    const res = await fetch(
      `https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${key}`
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    if (!data.results || data.results.length === 0) return null;

    let callVolume = 0;
    let putVolume = 0;
    let totalOI = 0;

    for (const opt of data.results) {
      const type = opt.option_details?.contract_type;
      const oi = opt.open_interest || 0;
      if (type === 'call') callVolume += oi;
      else if (type === 'put') putVolume += oi;
      totalOI += oi;
    }

    const putCallRatio = callVolume > 0 ? putVolume / callVolume : 0;

    return {
      callVolume,
      putVolume,
      putCallRatio: parseFloat(putCallRatio.toFixed(2)),
      totalOI,
      ivRank: null,
    };
  } catch (error) {
    console.error(`[Polygon Options] Error fetching ${symbol}:`, error);
    return null;
  }
}

// ── News: Polygon first, fallback to Yahoo ────────────────────────────────
async function fetchNews(symbol: string): Promise<any[]> {
  // Try Polygon first
  const polygonKey = process.env.POLYGON_API_KEY;
  if (polygonKey) {
    try {
      const res = await fetch(
        `https://api.polygon.io/v2/reference/news?ticker=${symbol}&limit=10&apiKey=${polygonKey}`
      );
      if (res.ok) {
        const data = await res.json() as any;
        if (data.results?.length > 0) {
          return data.results.map((item: any) => ({
            title: item.title || '',
            url: item.article_url || item.url || '',
            published: item.published_utc || '',
            source: item.author || item.publisher?.name || 'Polygon',
          }));
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: Yahoo Finance news via search
  try {
    const yahooSym = YAHOO_SYMBOLS[symbol] || symbol;
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${yahooSym}&newsCount=10&quotesCount=0`,
      { headers: HEADERS }
    );
    if (res.ok) {
      const data = await res.json() as any;
      if (data.news?.length > 0) {
        return data.news.map((item: any) => ({
          title: item.title || '',
          url: item.link || '',
          published: item.providerPublishTime
            ? new Date(item.providerPublishTime * 1000).toISOString()
            : '',
          source: item.publisher || 'Yahoo Finance',
        }));
      }
    }
  } catch { /* no news available */ }

  return [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol as string).toUpperCase();

    // Check cache
    const cached = cache.get(symbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    // Fetch all data in parallel
    const [yahooData, optionsData, news] = await Promise.all([
      fetchYahooData(symbol),
      // Prefer Polygon options if key exists, otherwise use Yahoo options
      process.env.POLYGON_API_KEY
        ? fetchPolygonOptions(symbol)
        : fetchYahooOptions(symbol),
      fetchNews(symbol),
    ]);

    const response: TickerResponse = {
      symbol,
      name: TICKER_NAMES[symbol] || symbol,
      price: yahooData?.price ?? null,
      change: yahooData?.change ?? null,
      changePercent: yahooData?.changePercent ?? null,
      marketCap: yahooData?.marketCap ?? null,
      volume: yahooData?.volume ?? null,
      high52w: yahooData?.high52w ?? null,
      low52w: yahooData?.low52w ?? null,
      options: optionsData,
      news,
      source: yahooData ? 'yahoo' : 'unavailable',
    };

    // Cache the response
    cache.set(symbol, { data: response, ts: Date.now() });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Ticker API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ticker data' },
      { status: 500 }
    );
  }
}
