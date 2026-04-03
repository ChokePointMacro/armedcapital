import { NextRequest, NextResponse } from 'next/server';

// Market instruments to track
const MARKET_INSTRUMENTS = [
  { symbol: 'BTC', name: 'Bitcoin', type: 'CRYPTO', isCrypto: true },
  { symbol: 'ETH', name: 'Ethereum', type: 'CRYPTO', isCrypto: true },
  { symbol: 'SPX', name: 'S&P 500', type: 'INDEX', isIndex: true },
  { symbol: 'NDX', name: 'Nasdaq 100', type: 'INDEX', isIndex: true },
  { symbol: 'MSTR', name: 'MicroStrategy', type: 'EQUITY' },
  { symbol: 'TSLA', name: 'Tesla', type: 'EQUITY' },
  { symbol: 'MSFT', name: 'Microsoft', type: 'EQUITY' },
  { symbol: 'META', name: 'Meta', type: 'EQUITY' },
  { symbol: 'AAPL', name: 'Apple', type: 'EQUITY' },
  { symbol: 'AMZN', name: 'Amazon', type: 'EQUITY' },
  { symbol: 'NVDA', name: 'Nvidia', type: 'EQUITY' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'EQUITY' },
];

// Yahoo Finance symbol mapping for fallback
const YAHOO_SYMBOLS: Record<string, string> = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SPX: '%5EGSPC', NDX: '%5EIXIC',
  MSTR: 'MSTR', TSLA: 'TSLA', MSFT: 'MSFT', META: 'META',
  AAPL: 'AAPL', AMZN: 'AMZN', NVDA: 'NVDA', AMD: 'AMD',
};

// Price history tracking
const priceHistory: Record<string, Array<{ price: number; ts: number }>> = {};
const HISTORY_THROTTLE = 1 * 60 * 1000; // 1 minute between entries

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getPublicToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await fetch('https://api.public.com/userapiauthservice/personal/access-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validityInMinutes: 60, secret: process.env.PUBLIC_SECRET_KEY }),
    });
    if (!res.ok) throw new Error(`Public.com token exchange failed ${res.status}`);
    const data = await res.json() as any;
    cachedToken = data.accessToken;
    tokenExpiry = Date.now() + 55 * 60 * 1000;
    return cachedToken!;
  } catch (error) {
    console.error('Error getting Public token:', error);
    return '';
  }
}

async function fetchYahooQuote(yahooSymbol: string): Promise<any> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=2d`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }
    );
    if (!res.ok) throw new Error(`Yahoo fetch failed ${res.status}`);
    const data = await res.json() as any;

    const chart = data.chart?.result?.[0];
    if (!chart) throw new Error('No chart data');

    const quotes = chart.quote || [];
    if (quotes.length === 0) throw new Error('No quotes');

    const latest = quotes[quotes.length - 1];
    const previous = quotes.length > 1 ? quotes[quotes.length - 2] : null;

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
      bid: latest.open || null,
      ask: latest.close || null,
    };
  } catch (error) {
    console.error(`Error fetching Yahoo quote for ${yahooSymbol}:`, error);
    return { price: null, change: null, changePercent: null, volume: null, bid: null, ask: null };
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getPublicToken();
    const accountId = process.env.PUBLIC_ACCOUNT_ID!;

    let quoteMap: Record<string, any> = {};
    let useYahooFallback = false;

    // Try Public.com first
    if (token && accountId) {
      try {
        const pRes = await fetch(
          `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instruments: MARKET_INSTRUMENTS.map(i => ({ symbol: i.symbol, type: i.type })),
            }),
          }
        );

        if (pRes.ok) {
          const pData = await pRes.json() as any;
          const list: any[] = pData.quotes || [];

          // Build quote map keyed by instrument symbol
          for (const q of list) {
            const sym = q.instrument?.symbol ?? q.symbol;
            if (sym) quoteMap[sym] = q;
          }
        } else {
          console.warn(`Public.com quotes failed ${pRes.status}, falling back to Yahoo`);
          useYahooFallback = true;
        }
      } catch (error) {
        console.warn('Public.com fetch failed, falling back to Yahoo:', error);
        useYahooFallback = true;
      }
    } else {
      useYahooFallback = true;
    }

    // Yahoo Finance fallback
    if (useYahooFallback) {
      const yahooQuotes = await Promise.all(
        MARKET_INSTRUMENTS.map(async (inst) => {
          const yahooSymbol = YAHOO_SYMBOLS[inst.symbol];
          if (!yahooSymbol) return null;
          const quote = await fetchYahooQuote(yahooSymbol);
          return { symbol: inst.symbol, ...quote };
        })
      );

      for (const q of yahooQuotes) {
        if (q) quoteMap[q.symbol] = q;
      }
    }

    const now = Date.now();
    const WINDOW = 25 * 60 * 60 * 1000; // 25 hours

    const result = MARKET_INSTRUMENTS.map(inst => {
      const q = quoteMap[inst.symbol] || {};
      const price = q.price != null ? parseFloat(String(q.price)) : q.last != null ? parseFloat(q.last) : null;

      // Update price history
      if (price != null) {
        const history = priceHistory[inst.symbol] || (priceHistory[inst.symbol] = []);
        const lastEntry = history[history.length - 1];

        if (!lastEntry || now - lastEntry.ts > HISTORY_THROTTLE) {
          history.push({ price, ts: now });
        }
        // Trim entries older than 25h
        priceHistory[inst.symbol] = priceHistory[inst.symbol].filter(e => now - e.ts < WINDOW);
      }

      // 24h change: compare with oldest entry ≥ 23h ago, else first available
      let change: number | null = q.change != null ? q.change : null;
      let changePercent: number | null = q.changePercent != null ? q.changePercent : null;

      // Fallback to historical calculation if not from Yahoo
      if (change === null && changePercent === null) {
        const hist = priceHistory[inst.symbol] || [];
        if (price != null && hist.length > 1) {
          const old = hist.find(e => now - e.ts >= 23 * 60 * 60 * 1000) ?? hist[0];
          if (old && old.price) {
            change = price - old.price;
            changePercent = (change / old.price) * 100;
          }
        }
      }

      const bid = q.bid != null ? parseFloat(String(q.bid)) : null;
      const ask = q.ask != null ? parseFloat(String(q.ask)) : null;
      const spread = bid != null && ask != null ? ask - bid : null;

      return {
        symbol: inst.symbol,
        name: inst.name,
        type: inst.type,
        isCrypto: (inst as any).isCrypto || false,
        isIndex: (inst as any).isIndex || false,
        price,
        change,
        changePercent,
        bid,
        ask,
        spread,
        volume: q.volume != null ? Number(q.volume) : null,
        lastTimestamp: q.lastTimestamp ?? null,
        outcome: q.outcome ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Markets] Error:', err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
