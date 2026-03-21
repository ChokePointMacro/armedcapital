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

export async function GET(request: NextRequest) {
  try {
    const token = await getPublicToken();
    const accountId = process.env.PUBLIC_ACCOUNT_ID!;

    if (!token || !accountId) {
      return NextResponse.json(
        { error: 'Public.com credentials not configured' },
        { status: 503 }
      );
    }

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

    if (!pRes.ok) {
      const err = await pRes.text();
      throw new Error(`Public.com quotes failed ${pRes.status}: ${err.slice(0, 200)}`);
    }

    const pData = await pRes.json() as any;
    const list: any[] = pData.quotes || [];

    // Build quote map keyed by instrument symbol
    const quoteMap: Record<string, any> = {};
    for (const q of list) {
      const sym = q.instrument?.symbol ?? q.symbol;
      if (sym) quoteMap[sym] = q;
    }

    const now = Date.now();
    const WINDOW = 25 * 60 * 60 * 1000; // 25 hours

    const result = MARKET_INSTRUMENTS.map(inst => {
      const q = quoteMap[inst.symbol] || {};
      const price = q.last != null ? parseFloat(q.last) : null;

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
      let change: number | null = null;
      let changePercent: number | null = null;
      const hist = priceHistory[inst.symbol] || [];
      if (price != null && hist.length > 1) {
        const old = hist.find(e => now - e.ts >= 23 * 60 * 60 * 1000) ?? hist[0];
        if (old && old.price) {
          change = price - old.price;
          changePercent = (change / old.price) * 100;
        }
      }

      const bid = q.bid != null ? parseFloat(q.bid) : null;
      const ask = q.ask != null ? parseFloat(q.ask) : null;
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
