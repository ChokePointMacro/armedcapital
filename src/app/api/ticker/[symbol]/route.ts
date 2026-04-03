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
  'SPX': '%5EGSPC',
  'NDX': '%5EIXIC',
  'DXY': 'DX-Y.CBT',
  'VIX': '%5EVIX',
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

async function fetchYahooData(symbol: string): Promise<any> {
  try {
    const yahooSym = YAHOO_SYMBOLS[symbol] || symbol;
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=1y`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    const chart = data.chart?.result?.[0];
    if (!chart) return null;

    const quotes = chart.quote || [];
    if (quotes.length === 0) return null;

    const latest = quotes[quotes.length - 1];
    const previous = quotes[quotes.length - 2] || null;

    const highs = quotes.map((q: any) => q.high).filter((h: any) => h);
    const lows = quotes.map((q: any) => q.low).filter((l: any) => l);

    const price = latest.close;
    let change = null;
    let changePercent = null;

    if (previous && previous.close && price) {
      change = price - previous.close;
      changePercent = (change / previous.close) * 100;
    }

    return {
      price,
      change,
      changePercent,
      volume: latest.volume || null,
      marketCap: null,
      high52w: highs.length > 0 ? Math.max(...highs) : null,
      low52w: lows.length > 0 ? Math.min(...lows) : null,
    };
  } catch (error) {
    console.error(`Error fetching Yahoo data for ${symbol}:`, error);
    return null;
  }
}

async function fetchPolygonNews(symbol: string): Promise<any[]> {
  try {
    const key = process.env.POLYGON_API_KEY;
    if (!key) return [];

    const res = await fetch(
      `https://api.polygon.io/v2/reference/news?ticker=${symbol}&limit=10&apiKey=${key}`
    );

    if (!res.ok) return [];

    const data = await res.json() as any;
    if (!data.results) return [];

    return data.results.map((item: any) => ({
      title: item.title || '',
      url: item.article_url || item.url || '',
      published: item.published_utc || item.published || '',
      source: item.author || 'Polygon',
    }));
  } catch (error) {
    console.error(`Error fetching Polygon news for ${symbol}:`, error);
    return [];
  }
}

async function fetchPolygonOptions(symbol: string): Promise<any> {
  try {
    const key = process.env.POLYGON_API_KEY;
    if (!key) return null;

    // Fetch options snapshot
    const res = await fetch(
      `https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${key}`
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    if (!data.results || data.results.length === 0) return null;

    const options = data.results;
    let callVolume = 0;
    let putVolume = 0;
    let totalOI = 0;

    for (const opt of options) {
      if (opt.option_details?.contract_type === 'call') {
        callVolume += opt.open_interest || 0;
      } else if (opt.option_details?.contract_type === 'put') {
        putVolume += opt.open_interest || 0;
      }
      totalOI += opt.open_interest || 0;
    }

    const putCallRatio = callVolume > 0 ? putVolume / callVolume : 0;

    return {
      callVolume,
      putVolume,
      putCallRatio: parseFloat(putCallRatio.toFixed(2)),
      totalOI,
      ivRank: null, // Would require IV data from another source
    };
  } catch (error) {
    console.error(`Error fetching Polygon options for ${symbol}:`, error);
    return null;
  }
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

    // Fetch price data from Yahoo Finance
    const yahooData = await fetchYahooData(symbol);

    // Fetch news
    const news = await fetchPolygonNews(symbol);

    // Try to fetch options data if Polygon API available
    const optionsData = await fetchPolygonOptions(symbol);

    const response: TickerResponse = {
      symbol,
      name: TICKER_NAMES[symbol] || symbol,
      price: yahooData?.price || null,
      change: yahooData?.change || null,
      changePercent: yahooData?.changePercent || null,
      marketCap: yahooData?.marketCap || null,
      volume: yahooData?.volume || null,
      high52w: yahooData?.high52w || null,
      low52w: yahooData?.low52w || null,
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
