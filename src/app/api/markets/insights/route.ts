import { NextRequest, NextResponse } from 'next/server';

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

const YAHOO_MAP: Record<string, string> = {
  BTC: 'BTC-USD',
  SPX: '^GSPC',
  NDX: '^NDX',
  MSTR: 'MSTR',
  TSLA: 'TSLA',
  MSFT: 'MSFT',
  META: 'META',
  AAPL: 'AAPL',
  AMZN: 'AMZN',
  NVDA: 'NVDA',
  AMD: 'AMD',
};

let insightsCache: { text: string; ts: number } | null = null;
const INSIGHTS_TTL = 10 * 60 * 1000; // 10 minutes

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
    if (insightsCache && Date.now() - insightsCache.ts < INSIGHTS_TTL) {
      return NextResponse.json({
        text: insightsCache.text,
        cached: true,
        generatedAt: new Date(insightsCache.ts).toISOString(),
      });
    }

    // Gather live prices
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
    const pData = pRes.ok ? (await pRes.json() as any) : { quotes: [] };
    const quoteMap: Record<string, any> = {};
    for (const q of pData.quotes || []) {
      const sym = q.instrument?.symbol ?? q.symbol;
      if (sym) quoteMap[sym] = q;
    }

    // Gather 30-day history + pivots
    const historyData = await Promise.all(
      Object.entries(YAHOO_MAP).map(async ([sym, yahooSym]) => {
        try {
          const r = await fetch(
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1mo`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (!r.ok) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
          const j = await r.json() as any;
          const result = j.chart?.result?.[0];
          if (!result) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
          const ts: number[] = result.timestamp || [];
          const q2 = result.indicators?.quote?.[0] || {};
          const candles = ts
            .map((t, i) => ({
              o: q2.open?.[i],
              h: q2.high?.[i],
              l: q2.low?.[i],
              c: q2.close?.[i],
            }))
            .filter((c: any) => c.o != null);
          if (!candles.length) {
            return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
          }
          const last = candles[candles.length - 1] as any;
          const first = candles[0] as any;
          const hi30 = Math.max(...candles.map((c: any) => c.h));
          const lo30 = Math.min(...candles.map((c: any) => c.l));
          const p = (last.h + last.l + last.c) / 3;
          return {
            sym,
            open30: first.o,
            close30: last.c,
            hi30,
            lo30,
            pivot: { p, r1: 2 * p - last.l, s1: 2 * p - last.h },
          };
        } catch {
          return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
        }
      })
    );

    // Build a compact data snapshot for the prompt
    const lines = MARKET_INSTRUMENTS.map(inst => {
      const q = quoteMap[inst.symbol] || {};
      const price = q.last != null ? parseFloat(q.last) : null;
      const h = historyData.find(d => d.sym === inst.symbol);
      const pct30 = h?.open30 && price ? ((price - h.open30) / h.open30 * 100).toFixed(1) : '?';
      const pivot = h?.pivot ? `P=${h.pivot.p.toFixed(0)} S1=${h.pivot.s1.toFixed(0)} R1=${h.pivot.r1.toFixed(0)}` : '';
      const priceStr = price != null ? (inst.isIndex ? price.toFixed(0) : `$${price.toFixed(2)}`) : 'N/A';
      const rangeStr = h?.hi30 ? `30d range $${h.lo30?.toFixed(0)}–$${h.hi30?.toFixed(0)}` : '';
      return `${inst.symbol} (${inst.name}): ${priceStr} | ${pct30}% vs 30d ago | ${rangeStr} | ${pivot}`;
    });

    const now = new Date().toUTCString();
    const prompt = `You are a sharp, concise macro/markets analyst. Today is ${now}.

Here is live market data:
${lines.join('\n')}

Write a tight, actionable market insights brief (aim for ~300 words). Structure it as:
1. **Overall Tone** — one sentence: risk-on, risk-off, or mixed? Why?
2. **Key Setups** — 3–5 bullet points, each covering a specific instrument or theme. Call out pivot levels, breakout/breakdown risks, relative strength/weakness, and what to watch.
3. **Watch List** — 2–3 specific price levels or catalysts that will define the next move.

Be direct. No filler. Use the actual numbers from the data. Format in markdown.`;

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (msg.content[0] as any).text as string;
    insightsCache = { text, ts: Date.now() };
    return NextResponse.json({
      text,
      cached: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Insights] Error:', err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
