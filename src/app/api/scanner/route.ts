import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import Anthropic from '@anthropic-ai/sdk';

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry { data: any; ts: number }
const cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function cached<T>(key: string, ttl = CACHE_TTL): T | null {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < ttl) return entry.data as T;
  return null;
}

function setCache(key: string, data: any) {
  cache[key] = { data, ts: Date.now() };
}

// ── Data fetchers ────────────────────────────────────────────────────────────

// Extra instruments not covered by Public.com — fetched via Yahoo v8 chart API
const EXTRA_INSTRUMENTS = [
  { symbol: 'GC=F', name: 'Gold', type: 'COMMODITY', yahooSymbol: 'GC%3DF' },
  { symbol: 'CL=F', name: 'Crude Oil', type: 'COMMODITY', yahooSymbol: 'CL%3DF' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index', type: 'MACRO', yahooSymbol: 'DX-Y.NYB' },
  { symbol: '^TNX', name: '10Y Treasury Yield', type: 'MACRO', yahooSymbol: '%5ETNX' },
  { symbol: '^VIX', name: 'VIX', type: 'MACRO', yahooSymbol: '%5EVIX' },
];

// Fetch live quotes from our own /api/markets (Public.com data)
async function fetchMarketQuotes(): Promise<any[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/markets`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Fetch extra macro/commodity data via Yahoo v8 chart (which still works, unlike v7 quote)
async function fetchYahooChartQuote(yahooSymbol: string): Promise<any | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    const timestamps = result.timestamp || [];
    const closes = quotes?.close || [];

    // Get latest close and previous close for change calc
    const validCloses = closes.filter((c: any) => c != null);
    const price = meta.regularMarketPrice || validCloses[validCloses.length - 1];
    const prevClose = meta.chartPreviousClose || validCloses[validCloses.length - 2] || price;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Calculate 5d high/low from candle data
    const highs = (quotes?.high || []).filter((h: any) => h != null);
    const lows = (quotes?.low || []).filter((l: any) => l != null);

    return {
      price,
      change: +change.toFixed(2),
      changePct: +changePct.toFixed(2),
      dayHigh: highs.length ? Math.max(...highs.slice(-1)) : null,
      dayLow: lows.length ? Math.min(...lows.slice(-1)) : null,
      fiveDayHigh: highs.length ? Math.max(...highs) : null,
      fiveDayLow: lows.length ? Math.min(...lows) : null,
    };
  } catch {
    return null;
  }
}

async function fetchExtraInstruments(): Promise<any[]> {
  const results = await Promise.all(
    EXTRA_INSTRUMENTS.map(async (inst) => {
      const data = await fetchYahooChartQuote(inst.yahooSymbol);
      if (!data) return null;
      return {
        symbol: inst.symbol,
        name: inst.name,
        type: inst.type,
        ...data,
      };
    })
  );
  return results.filter(Boolean);
}

async function fetchTerminalData(): Promise<any> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/terminal`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchOptionsFlow(): Promise<any[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/markets/options`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ── AI Scanner ───────────────────────────────────────────────────────────────

interface Opportunity {
  rank: number;
  symbol: string;
  name: string;
  type: string;
  signal: string;            // 'BREAKOUT' | 'REVERSAL' | 'MOMENTUM' | 'DISLOCATION' | 'UNUSUAL_FLOW' | 'MACRO_CATALYST'
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  conviction: number;        // 1-100
  entry: string;
  stopLoss: string;
  target: string;
  riskReward: string;
  thesis: string;
  catalyst: string;
  timeframe: string;
  riskScore: number;         // 1-10
  scoringBreakdown: {
    volatility: number;
    momentum: number;
    trend: number;
    breadth: number;
    macro: number;
  };
}

interface ScanResult {
  opportunities: Opportunity[];
  marketContext: string;
  scanMode: string;
  scannedAt: string;
  nextScanAt: string;
  instrumentsScanned: number;
}

async function runAIScan(
  marketQuotes: any[],
  extraQuotes: any[],
  terminal: any | null,
  options: any[],
): Promise<ScanResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build market snapshot from Public.com data
  const marketSnapshot = [
    ...marketQuotes.map((q: any) => ({
      symbol: q.symbol,
      name: q.name,
      type: q.type || (q.isCrypto ? 'CRYPTO' : q.isIndex ? 'INDEX' : 'EQUITY'),
      price: q.price,
      change: q.change,
      changePct: q.changePercent,
      volume: q.volume,
      bid: q.bid,
      ask: q.ask,
      spread: q.spread,
    })),
    ...extraQuotes.map((q: any) => ({
      symbol: q.symbol,
      name: q.name,
      type: q.type,
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      dayHigh: q.dayHigh,
      dayLow: q.dayLow,
      fiveDayHigh: q.fiveDayHigh,
      fiveDayLow: q.fiveDayLow,
    })),
  ];

  const totalInstruments = marketSnapshot.length;

  // Options summary
  const optionsSummary = options.map(o => {
    const topCalls = o.contracts?.filter((c: any) => c.side === 'CALL').slice(0, 3) || [];
    const topPuts = o.contracts?.filter((c: any) => c.side === 'PUT').slice(0, 3) || [];
    const totalCallVol = o.contracts?.filter((c: any) => c.side === 'CALL').reduce((sum: number, c: any) => sum + (c.volume || 0), 0) || 0;
    const totalPutVol = o.contracts?.filter((c: any) => c.side === 'PUT').reduce((sum: number, c: any) => sum + (c.volume || 0), 0) || 0;
    return {
      symbol: o.symbol,
      expiry: o.expiry,
      callVolume: totalCallVol,
      putVolume: totalPutVol,
      putCallRatio: totalCallVol > 0 ? (totalPutVol / totalCallVol).toFixed(2) : 'N/A',
      topCalls: topCalls.map((c: any) => `${c.strike} strike: vol ${c.volume}, OI ${c.openInterest}`),
      topPuts: topPuts.map((c: any) => `${c.strike} strike: vol ${c.volume}, OI ${c.openInterest}`),
    };
  });

  const terminalBlock = terminal ? `
TERMINAL SCORING (Custom Weights):
- Overall Score: ${terminal.decision?.score}/100 — ${terminal.decision?.label}
- Volatility (19%): score ${terminal.volatility?.score}, VIX ${terminal.volatility?.vixLevel}
- Momentum (15%): score ${terminal.momentum?.score}, ${terminal.momentum?.sectorsPositive}/${terminal.momentum?.sectorsTotal} sectors positive
- Trend (16%): score ${terminal.trend?.score}, regime "${terminal.trend?.regime}", SPX vs 200d: ${terminal.trend?.spxVs200d?.value}%
- Breadth (14%): score ${terminal.breadth?.score}, ${terminal.breadth?.pctAbove50d}% above 50d MA
- Macro (8%): score ${terminal.macro?.score}, 10Y yield ${terminal.macro?.tenYearYield}%, DXY ${terminal.macro?.dxy}
- Execution: Breakouts ${terminal.executionWindow?.breakoutsWorking?.answer}, Leaders Holding ${terminal.executionWindow?.leadersHolding?.answer}
- Sector Leader: ${terminal.momentum?.leader?.name} (${terminal.momentum?.leader?.change}%), Laggard: ${terminal.momentum?.laggard?.name} (${terminal.momentum?.laggard?.change}%)
` : 'TERMINAL DATA: Unavailable';

  const now = new Date();
  const prompt = `You are an elite multi-asset trading strategist scanning for the highest-conviction opportunities.

TODAY: ${now.toISOString().split('T')[0]} ${now.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET

${terminalBlock}

LIVE MARKET DATA (${marketSnapshot.length} instruments):
${JSON.stringify(marketSnapshot, null, 1)}

OPTIONS FLOW:
${JSON.stringify(optionsSummary, null, 1)}

SCORING WEIGHT SYSTEM (apply to every opportunity):
- Volatility (19%): Is implied/realized vol elevated or compressed? VIX regime? Is the setup benefiting from or endangered by current vol?
- Momentum (15%): Is the asset in a momentum regime? Sector rotation support? Volume confirming the move?
- Trend (16%): Where is price relative to 50d/200d MA? Above = bullish. Below = bearish. What regime?
- Breadth (14%): Is the broader market confirming (rising tide) or diverging (narrow leadership)?
- Macro (8%): Rates, DXY, geopolitical — tailwind or headwind?

SCAN FOR OPPORTUNITIES across ALL asset classes (equities, crypto, commodities, macro):
1. Momentum breakouts — price breaking key levels with volume
2. Mean-reversion setups — oversold/overbought extremes near support/resistance
3. Macro dislocations — assets mispriced relative to macro backdrop
4. Unusual options flow — heavy call/put skew, large OI at specific strikes
5. Relative value — one asset lagging peers for no fundamental reason
6. Catalyst trades — known upcoming events creating asymmetric risk/reward

Return EXACTLY this JSON (no markdown, no code blocks):
{
  "opportunities": [
    {
      "rank": 1,
      "symbol": "NVDA",
      "name": "NVIDIA",
      "type": "EQUITY",
      "signal": "BREAKOUT",
      "direction": "LONG",
      "conviction": 85,
      "entry": "$950-960 zone",
      "stopLoss": "$920 (below 20d MA)",
      "target": "$1020 (prior high)",
      "riskReward": "1:2.5",
      "thesis": "Breaking out of 3-week consolidation with volume expansion...",
      "catalyst": "Data center capex cycle accelerating, earnings in 2 weeks",
      "timeframe": "1-2 weeks",
      "riskScore": 4,
      "scoringBreakdown": {
        "volatility": 75,
        "momentum": 88,
        "trend": 82,
        "breadth": 70,
        "macro": 65
      }
    }
  ],
  "marketContext": "2-3 sentence summary of current market conditions and what the scoring system tells us about environment quality"
}

RULES:
- Return 5-10 opportunities, ranked by conviction score (highest first)
- Include at least 1 crypto, 1 commodity/macro, and 1 equity idea
- Include at least 1 SHORT or NEUTRAL if conditions warrant
- Every entry/stop/target must be specific numbers, not vague
- riskScore: 1 = very low risk, 10 = very high risk
- conviction: weight it using the scoring breakdown (vol 19%, mom 15%, trend 16%, breadth 14%, macro 8% = 72% quantitative, 28% qualitative judgment)
- If the terminal score is below 40, bias toward defensive/short ideas
- If VIX > 25, increase riskScore for all longs
- Be honest about uncertainty — don't force trades in bad environments`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
    system: 'You are a professional trading strategist. Return ONLY valid JSON with no additional text or markdown.',
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  if (!text) throw new Error('Empty response from Claude');

  // Parse JSON (handle potential markdown wrapping)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  const nextScan = new Date(now.getTime() + 60 * 60 * 1000);

  return {
    opportunities: parsed.opportunities || [],
    marketContext: parsed.marketContext || '',
    scanMode: 'full-spectrum',
    scannedAt: now.toISOString(),
    nextScanAt: nextScan.toISOString(),
    instrumentsScanned: totalInstruments,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await safeAuth();

    // Check cache
    const hit = cached<ScanResult>('scanner');
    if (hit) return NextResponse.json(hit);

    console.log('[Scanner] Starting full-spectrum scan...');

    // Fetch all data in parallel
    const [marketQuotes, extraQuotes, terminal, options] = await Promise.all([
      fetchMarketQuotes(),
      fetchExtraInstruments(),
      fetchTerminalData(),
      fetchOptionsFlow(),
    ]);

    console.log(`[Scanner] Data: ${marketQuotes.length} market quotes, ${extraQuotes.length} extra, terminal=${!!terminal}, ${options.length} option chains`);

    // Run AI scan
    const result = await runAIScan(marketQuotes, extraQuotes, terminal, options);

    console.log(`[Scanner] Found ${result.opportunities.length} opportunities`);

    // Cache result
    setCache('scanner', result);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Scanner] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Scanner failed', opportunities: [], marketContext: '', scannedAt: new Date().toISOString() },
      { status: 500 }
    );
  }
}
