import { NextRequest, NextResponse } from 'next/server';

const YAHOO_MAP: Record<string, string> = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
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

const RANGE_MAP: Record<string, { interval: string; range: string }> = {
  '1d': { interval: '5m', range: '1d' },
  '1w': { interval: '1h', range: '5d' },
  '1m': { interval: '1d', range: '1mo' },
  '3m': { interval: '1d', range: '3mo' },
  '6m': { interval: '1wk', range: '6mo' },
  '1y': { interval: '1wk', range: '1y' },
};

function yahooParams(rangeKey: string): { interval: string; range: string } {
  return RANGE_MAP[rangeKey] || RANGE_MAP['1m'];
}

function parseYahooCandles(chartResult: any): { candles: any[]; pivotLevels: any } {
  const timestamps: number[] = chartResult.timestamp || [];
  const q = chartResult.indicators?.quote?.[0] || {};
  const candles = timestamps
    .map((t: number, i: number) => ({
      t: t * 1000,
      o: q.open?.[i],
      h: q.high?.[i],
      l: q.low?.[i],
      c: q.close?.[i],
      v: q.volume?.[i],
    }))
    .filter((c: any) => c.o != null && c.h != null && c.l != null && c.c != null);

  let pivotLevels: any = null;
  if (candles.length > 0) {
    const periodH = Math.max(...candles.map((c: any) => c.h));
    const periodL = Math.min(...candles.map((c: any) => c.l));
    const periodC = (candles[candles.length - 1] as any).c;
    const p = (periodH + periodL + periodC) / 3;
    pivotLevels = {
      p,
      r1: 2 * p - periodL,
      r2: p + (periodH - periodL),
      r3: periodH + 2 * (p - periodL),
      s1: 2 * p - periodH,
      s2: p - (periodH - periodL),
      s3: periodL - 2 * (periodH - p),
    };
  }
  return { candles, pivotLevels };
}

async function fetchYahooCandles(
  yahooSym: string,
  interval: string,
  range: string
): Promise<{ candles: any[]; pivotLevels: any }> {
  const r = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${interval}&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
  );
  if (!r.ok) return { candles: [], pivotLevels: null };
  const j = await r.json() as any;
  const result = j.chart?.result?.[0];
  if (!result) return { candles: [], pivotLevels: null };
  return parseYahooCandles(result);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get('range') || '1m').toLowerCase();
    const { interval, range: yahooRange } = yahooParams(range);

    // Single-symbol mode: ?symbol=BTC
    const singleSymbol = (searchParams.get('symbol') || '').toUpperCase();
    if (singleSymbol) {
      const yahooSym = YAHOO_MAP[singleSymbol] || singleSymbol;
      try {
        const { candles, pivotLevels } = await fetchYahooCandles(yahooSym, interval, yahooRange);
        return NextResponse.json({ symbol: singleSymbol, candles, pivotLevels });
      } catch {
        return NextResponse.json({ symbol: singleSymbol, candles: [], pivotLevels: null });
      }
    }

    // Multi-symbol mode: ?symbols=BTC,ETH or no param (fetch all)
    const symbolsParam = searchParams.get('symbols');
    const symbols = symbolsParam
      ? symbolsParam.split(',').map(s => s.trim().toUpperCase())
      : Object.keys(YAHOO_MAP);

    const results = await Promise.all(
      symbols.map(async sym => {
        try {
          const yahooSym = YAHOO_MAP[sym] || sym;
          const { candles, pivotLevels } = await fetchYahooCandles(yahooSym, interval, yahooRange);
          return { symbol: sym, candles, pivotLevels };
        } catch {
          return { symbol: sym, candles: [], pivotLevels: null };
        }
      })
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error('[Markets/History] Error:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
