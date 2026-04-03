import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
// Anthropic SDK is dynamically imported in runAIScan() to reduce cold-start bundle size
import {
  fetchAllEnrichedData, enrichedDataToPromptBlock,
  fetchFredData, type FredData,
  fetchFinnhubData, fetchFearGreedIndex, fetchCoinGeckoData,
} from '@/lib/enrichedData';

// Force dynamic rendering — this route fetches many external APIs at runtime
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow up to 120s for all enrichment fetches + AI call

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry { data: any; ts: number }
const cache: Record<string, CacheEntry> = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function cached<T>(key: string, ttl = CACHE_TTL): T | null {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < ttl) return entry.data as T;
  return null;
}

function setCache(key: string, data: any) {
  cache[key] = { data, ts: Date.now() };
}

// ── Helper ───────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

// ── Data Fetchers — Original Sources ─────────────────────────────────────────

// Extra instruments not covered by Public.com — fetched via Yahoo v8 chart API
const EXTRA_INSTRUMENTS = [
  { symbol: 'GC=F', name: 'Gold', type: 'COMMODITY', yahooSymbol: 'GC%3DF' },
  { symbol: 'CL=F', name: 'Crude Oil', type: 'COMMODITY', yahooSymbol: 'CL%3DF' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index', type: 'MACRO', yahooSymbol: 'DX-Y.NYB' },
  { symbol: '^TNX', name: '10Y Treasury Yield', type: 'MACRO', yahooSymbol: '%5ETNX' },
  { symbol: '^VIX', name: 'VIX', type: 'MACRO', yahooSymbol: '%5EVIX' },
];

async function fetchMarketQuotes(): Promise<any[]> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/markets`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

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
    const closes = quotes?.close || [];
    const validCloses = closes.filter((c: any) => c != null);
    const price = meta.regularMarketPrice || validCloses[validCloses.length - 1];
    const prevClose = meta.chartPreviousClose || validCloses[validCloses.length - 2] || price;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
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
      return { symbol: inst.symbol, name: inst.name, type: inst.type, ...data };
    })
  );
  return results.filter(Boolean);
}

async function fetchTerminalData(): Promise<any> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/terminal`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchOptionsFlow(): Promise<any[]> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/markets/options`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// FRED data now imported from @/lib/enrichedData (Redis-cached, shared across routes)

// ── NEW: Finnhub (Earnings Calendar + Insider Transactions) ──────────────────

interface EarningsEvent {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  hour: string; // 'bmo' | 'amc' | 'dmh'
}

interface InsiderTransaction {
  symbol: string;
  name: string;
  share: number;
  change: number;
  transactionType: string; // 'P-Purchase' | 'S-Sale' etc.
  transactionDate: string;
}

interface FinnhubData {
  earningsThisWeek: EarningsEvent[];
  insiderTransactions: InsiderTransaction[];
}

async function fetchFinnhubEarnings(): Promise<EarningsEvent[]> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return [];
    const now = new Date();
    const from = now.toISOString().split('T')[0];
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const to = nextWeek.toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const json = await res.json();
    // Return top 20 by revenue estimate (biggest names)
    return (json.earningsCalendar || [])
      .sort((a: any, b: any) => (b.revenueEstimate || 0) - (a.revenueEstimate || 0))
      .slice(0, 20)
      .map((e: any) => ({
        symbol: e.symbol,
        date: e.date,
        epsEstimate: e.epsEstimate,
        revenueEstimate: e.revenueEstimate,
        hour: e.hour || 'dmh',
      }));
  } catch {
    return [];
  }
}

async function fetchFinnhubInsiderTransactions(): Promise<InsiderTransaction[]> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return [];
    // Fetch recent insider transactions across the market
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];
    // Finnhub insider-sentiment endpoint gives aggregate insider sentiment
    const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=AAPL&token=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const json = await res.json();
    // Get notable large transactions from last 7 days
    return (json.data || [])
      .filter((t: any) => {
        const txDate = new Date(t.transactionDate);
        return txDate >= new Date(from) && Math.abs(t.change) > 10000;
      })
      .slice(0, 15)
      .map((t: any) => ({
        symbol: t.symbol,
        name: t.name,
        share: t.share,
        change: t.change,
        transactionType: t.transactionType,
        transactionDate: t.transactionDate,
      }));
  } catch {
    return [];
  }
}

async function fetchFinnhubData(): Promise<FinnhubData> {
  const [earnings, insider] = await Promise.all([
    fetchFinnhubEarnings(),
    fetchFinnhubInsiderTransactions(),
  ]);
  return { earningsThisWeek: earnings, insiderTransactions: insider };
}

// ── NEW: Fear & Greed Index ──────────────────────────────────────────────────

interface FearGreedData {
  value: number;
  label: string;         // 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed'
  previousClose: number;
  oneWeekAgo: number;
  oneMonthAgo: number;
  timestamp: string;
}

async function fetchFearGreedIndex(): Promise<FearGreedData | null> {
  try {
    const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      // Fallback: try alternative endpoint
      return await fetchFearGreedFallback();
    }
    const json = await res.json();
    const fg = json.fear_and_greed;
    if (!fg) return await fetchFearGreedFallback();
    return {
      value: Math.round(fg.score),
      label: fg.rating,
      previousClose: Math.round(fg.previous_close),
      oneWeekAgo: Math.round(fg.previous_1_week),
      oneMonthAgo: Math.round(fg.previous_1_month),
      timestamp: new Date().toISOString(),
    };
  } catch {
    return await fetchFearGreedFallback();
  }
}

async function fetchFearGreedFallback(): Promise<FearGreedData | null> {
  try {
    // Alternative CNN F&G endpoint
    const url = 'https://production.dataviz.cnn.io/index/fearandgreed/current';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      value: Math.round(json.score || json.value || 50),
      label: json.rating || classifyFearGreed(json.score || json.value || 50),
      previousClose: Math.round(json.previous_close || json.score || 50),
      oneWeekAgo: Math.round(json.previous_1_week || 50),
      oneMonthAgo: Math.round(json.previous_1_month || 50),
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function classifyFearGreed(value: number): string {
  if (value <= 25) return 'Extreme Fear';
  if (value <= 44) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 75) return 'Greed';
  return 'Extreme Greed';
}

// ── NEW: CoinGecko (Deep Crypto Data) ────────────────────────────────────────

interface CoinGeckoAsset {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change7d: number;
  change30d: number | null;
  marketCap: number;
  volume24h: number;
  volumeToMcap: number;
  ath: number;
  athChangePercent: number;
  circulatingSupply: number;
  totalSupply: number | null;
  sparkline7d: number[];
}

interface CoinGeckoData {
  topCoins: CoinGeckoAsset[];
  trending: { name: string; symbol: string; marketCapRank: number; priceBtc: number }[];
  globalMarketCap: number | null;
  btcDominance: number | null;
}

async function fetchCoinGeckoMarkets(): Promise<CoinGeckoAsset[]> {
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&sparkline=true&price_change_percentage=24h,7d,30d';
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.map((c: any) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      change24h: +(c.price_change_percentage_24h || 0).toFixed(2),
      change7d: +(c.price_change_percentage_7d_in_currency || 0).toFixed(2),
      change30d: c.price_change_percentage_30d_in_currency ? +(c.price_change_percentage_30d_in_currency).toFixed(2) : null,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      volumeToMcap: c.market_cap > 0 ? +(c.total_volume / c.market_cap).toFixed(4) : 0,
      ath: c.ath,
      athChangePercent: +(c.ath_change_percentage || 0).toFixed(1),
      circulatingSupply: c.circulating_supply,
      totalSupply: c.total_supply,
      sparkline7d: (c.sparkline_in_7d?.price || []).filter((_: any, i: number) => i % 24 === 0), // daily samples
    }));
  } catch {
    return [];
  }
}

async function fetchCoinGeckoTrending(): Promise<any[]> {
  try {
    const url = 'https://api.coingecko.com/api/v3/search/trending';
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.coins || []).slice(0, 10).map((c: any) => ({
      name: c.item.name,
      symbol: c.item.symbol.toUpperCase(),
      marketCapRank: c.item.market_cap_rank,
      priceBtc: c.item.price_btc,
    }));
  } catch {
    return [];
  }
}

async function fetchCoinGeckoGlobal(): Promise<{ marketCap: number | null; btcDominance: number | null }> {
  try {
    const url = 'https://api.coingecko.com/api/v3/global';
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return { marketCap: null, btcDominance: null };
    const json = await res.json();
    return {
      marketCap: json.data?.total_market_cap?.usd || null,
      btcDominance: json.data?.market_cap_percentage?.btc ? +json.data.market_cap_percentage.btc.toFixed(1) : null,
    };
  } catch {
    return { marketCap: null, btcDominance: null };
  }
}

async function fetchCoinGeckoData(): Promise<CoinGeckoData> {
  const [topCoins, trending, global] = await Promise.all([
    fetchCoinGeckoMarkets(),
    fetchCoinGeckoTrending(),
    fetchCoinGeckoGlobal(),
  ]);
  return {
    topCoins,
    trending,
    globalMarketCap: global.marketCap,
    btcDominance: global.btcDominance,
  };
}

// ── AI Scanner ───────────────────────────────────────────────────────────────

interface Opportunity {
  rank: number;
  symbol: string;
  name: string;
  type: string;
  signal: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  conviction: number;
  entry: string;
  stopLoss: string;
  target: string;
  riskReward: string;
  thesis: string;
  catalyst: string;
  timeframe: string;
  riskScore: number;
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
  dataSources: {
    publicCom: number;
    yahooChart: number;
    fred: boolean;
    finnhub: boolean;
    fearGreed: boolean;
    coinGecko: number;
  };
  fearGreed: FearGreedData | null;
  fredSummary: {
    spread2s10s: number | null;
    breakeven10y: number | null;
    fedFundsRate: number | null;
    yieldCurve: { label: string; value: number | null }[];
  } | null;
  earningsCount: number;
  cryptoGlobal: {
    btcDominance: number | null;
    totalMarketCap: number | null;
  } | null;
}

// ── Polygon Options Data Fetcher ─────────────────────────────────────────────

async function fetchPolygonOptionsSnapshot(ticker: string): Promise<string | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.polygon.io/v3/snapshot/options/${ticker}?apiKey=${key}&limit=10`);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    let callVol = 0, putVol = 0, callOI = 0, putOI = 0;
    for (const r of results) {
      const d = r.details || {};
      const dv = r.day || {};
      if (d.contract_type === 'call') {
        callVol += dv.volume || 0;
        callOI += dv.open_interest || 0;
      } else {
        putVol += dv.volume || 0;
        putOI += dv.open_interest || 0;
      }
    }
    return `${ticker}: Call Vol ${callVol}, Put Vol ${putVol}, Call OI ${callOI}, Put OI ${putOI}, P/C Ratio ${putVol > 0 ? (callVol/putVol).toFixed(2) : 'N/A'}`;
  } catch {
    return null;
  }
}

async function runAIScan(
  marketQuotes: any[],
  extraQuotes: any[],
  terminal: any | null,
  options: any[],
  fredData: FredData,
  finnhubData: FinnhubData,
  fearGreed: FearGreedData | null,
  coinGecko: CoinGeckoData,
): Promise<ScanResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
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

  const totalInstruments = marketSnapshot.length + coinGecko.topCoins.length;

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

  // Terminal block
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

  // FRED macro block
  const fredBlock = fredData.yieldCurve.some(y => y.value !== null) ? `
FEDERAL RESERVE DATA (FRED):
- Yield Curve: ${fredData.yieldCurve.map(y => `${y.label}: ${y.value != null ? y.value.toFixed(2) + '%' : 'N/A'}`).join(' | ')}
- 2s10s Spread: ${fredData.spread2s10s != null ? fredData.spread2s10s.toFixed(2) + '%' : 'N/A'} ${fredData.spread2s10s != null && fredData.spread2s10s < 0 ? '⚠️ INVERTED — recession signal' : ''}
- 5Y Breakeven Inflation: ${fredData.breakeven5y != null ? fredData.breakeven5y.toFixed(2) + '%' : 'N/A'}
- 10Y Breakeven Inflation: ${fredData.breakeven10y != null ? fredData.breakeven10y.toFixed(2) + '%' : 'N/A'}
- Fed Funds Rate: ${fredData.fedFundsRate != null ? fredData.fedFundsRate.toFixed(2) + '%' : 'N/A'}
- Initial Jobless Claims: ${fredData.initialClaims != null ? fredData.initialClaims.toLocaleString() : 'N/A'}
` : 'FRED DATA: Unavailable (no API key configured)';

  // Finnhub earnings block
  const earningsBlock = finnhubData.earningsThisWeek.length > 0 ? `
UPCOMING EARNINGS (next 7 days — ${finnhubData.earningsThisWeek.length} reports):
${finnhubData.earningsThisWeek.slice(0, 15).map(e =>
  `- ${e.symbol} on ${e.date} (${e.hour === 'bmo' ? 'pre-market' : e.hour === 'amc' ? 'after-close' : 'TBD'}) | EPS est: ${e.epsEstimate ?? 'N/A'} | Rev est: ${e.revenueEstimate ? '$' + (e.revenueEstimate / 1e9).toFixed(1) + 'B' : 'N/A'}`
).join('\n')}
IMPORTANT: Flag any scanner opportunities that have earnings within 7 days — this is a critical catalyst or risk event.
` : 'EARNINGS DATA: Unavailable';

  // Insider transactions block
  const insiderBlock = finnhubData.insiderTransactions.length > 0 ? `
INSIDER TRANSACTIONS (last 7 days, large >10k shares):
${finnhubData.insiderTransactions.slice(0, 10).map(t =>
  `- ${t.symbol}: ${t.name} ${t.transactionType} ${Math.abs(t.change).toLocaleString()} shares on ${t.transactionDate}`
).join('\n')}
` : '';

  // Fear & Greed block
  const fgBlock = fearGreed ? `
CNN FEAR & GREED INDEX:
- Current: ${fearGreed.value}/100 — "${fearGreed.label}"
- Previous Close: ${fearGreed.previousClose}
- 1 Week Ago: ${fearGreed.oneWeekAgo}
- 1 Month Ago: ${fearGreed.oneMonthAgo}
${fearGreed.value <= 25 ? '⚠️ EXTREME FEAR — historically a strong contrarian BUY signal for equities' : ''}
${fearGreed.value >= 75 ? '⚠️ EXTREME GREED — historically a warning sign, longs are crowded' : ''}
` : 'FEAR & GREED INDEX: Unavailable';

  // CoinGecko crypto block
  const cryptoBlock = coinGecko.topCoins.length > 0 ? `
CRYPTO MARKET DATA (CoinGecko — top 30 by market cap):
Global Crypto Market Cap: ${coinGecko.globalMarketCap ? '$' + (coinGecko.globalMarketCap / 1e12).toFixed(2) + 'T' : 'N/A'}
BTC Dominance: ${coinGecko.btcDominance ? coinGecko.btcDominance + '%' : 'N/A'}

Top Movers (24h):
${coinGecko.topCoins
  .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
  .slice(0, 15)
  .map(c => `- ${c.symbol}: $${c.price.toLocaleString()} | 24h: ${c.change24h > 0 ? '+' : ''}${c.change24h}% | 7d: ${c.change7d > 0 ? '+' : ''}${c.change7d}% | Vol/MCap: ${c.volumeToMcap} | ATH dist: ${c.athChangePercent}% | MCap: $${(c.marketCap / 1e9).toFixed(1)}B`)
  .join('\n')}

Trending Coins (social momentum):
${coinGecko.trending.map(t => `- ${t.symbol} (${t.name}) — rank #${t.marketCapRank || 'N/A'}`).join(', ')}
` : 'CRYPTO DATA: Limited (CoinGecko unavailable)';

  // Build real price anchor data
  const priceLines = [
    ...marketSnapshot.map(q => `${q.symbol}: $${typeof q.price === 'number' ? q.price.toFixed(2) : 'N/A'} (${q.changePct >= 0 ? '+' : ''}${q.changePct}%)`),
    ...extraQuotes.map(q => `${q.symbol}: $${typeof q.price === 'number' ? q.price.toFixed(2) : 'N/A'} (${q.changePct >= 0 ? '+' : ''}${q.changePct}%)`),
  ];

  // Fetch Polygon options data for top 5-10 equity tickers
  const topTickers = marketSnapshot
    .filter((q: any) => q.type === 'EQUITY')
    .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 8)
    .map((q: any) => q.symbol);

  const polygonOptionsData: string[] = [];
  if (topTickers.length > 0 && process.env.POLYGON_API_KEY) {
    const optionsResults = await Promise.all(
      topTickers.map(ticker => fetchPolygonOptionsSnapshot(ticker))
    );
    polygonOptionsData.push(
      ...optionsResults.filter((result): result is string => result !== null)
    );
  }

  const now = new Date();
  const prompt = `You are an elite multi-asset trading strategist scanning for the highest-conviction opportunities.
You now have access to SIGNIFICANTLY MORE DATA than before — use ALL of it to find nuanced opportunities.

TODAY: ${now.toISOString().split('T')[0]} ${now.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET

${terminalBlock}

${fredBlock}

${fgBlock}

CURRENT MARKET PRICES (use these as anchors - do NOT fabricate prices):
${priceLines.join('\n')}

LIVE MARKET DATA (${marketSnapshot.length} instruments):
${JSON.stringify(marketSnapshot, null, 1)}

${cryptoBlock}

${polygonOptionsData.length > 0 ? `POLYGON OPTIONS SNAPSHOT (top volume equities):\n${polygonOptionsData.join('\n')}\n` : ''}

OPTIONS FLOW:
${JSON.stringify(optionsSummary, null, 1)}

${earningsBlock}

${insiderBlock}

SCORING WEIGHT SYSTEM (apply to every opportunity):
- Volatility (19%): Is implied/realized vol elevated or compressed? VIX regime? Is the setup benefiting from or endangered by current vol?
- Momentum (15%): Is the asset in a momentum regime? Sector rotation support? Volume confirming the move?
- Trend (16%): Where is price relative to 50d/200d MA? Above = bullish. Below = bearish. What regime?
- Breadth (14%): Is the broader market confirming (rising tide) or diverging (narrow leadership)?
- Macro (8%): Rates, DXY, yield curve shape, breakeven inflation, fear/greed — tailwind or headwind?

NEW DATA INTEGRATION RULES:
1. YIELD CURVE: If 2s10s spread is inverted or flattening, bias toward defensive/short ideas and increase risk scores for cyclicals.
2. BREAKEVEN INFLATION: Rising breakevens = commodities tailwind, tech headwind. Falling = opposite.
3. FEAR & GREED: Extreme Fear (<25) = contrarian long opportunities exist. Extreme Greed (>75) = tighten stops, look for shorts.
4. EARNINGS CATALYST: If a stock has earnings within 7 days, ALWAYS mention it as a catalyst. Pre-earnings momentum plays can be high conviction. Post-earnings moves create breakout/reversal setups.
5. CRYPTO DEPTH: Use CoinGecko's 7d/30d changes, volume/mcap ratios, and ATH distance to find oversold bounces or breakout candidates. Trending coins with low mcap rank = potential momentum plays.
6. INSIDER ACTIVITY: Large insider purchases = bullish signal. Large sales near highs = caution.
7. JOBLESS CLAIMS: Rising claims = economic weakness = defensive bias. Falling = risk-on.

SCAN FOR OPPORTUNITIES across ALL asset classes (equities, crypto, commodities, macro):
1. Momentum breakouts — price breaking key levels with volume
2. Mean-reversion setups — oversold/overbought extremes near support/resistance
3. Macro dislocations — assets mispriced relative to yield curve, inflation expectations, or sentiment
4. Unusual options flow — heavy call/put skew, large OI at specific strikes
5. Relative value — one asset lagging peers for no fundamental reason
6. Catalyst trades — earnings, Fed meetings, insider buying creating asymmetric risk/reward
7. Crypto momentum — trending coins, volume spikes, ATH breakouts or deep corrections
8. Yield curve plays — rate-sensitive assets positioned for curve steepening/flattening

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
  "marketContext": "2-3 sentence summary of current market conditions including yield curve stance, sentiment regime, and what all data sources combined tell us about the environment"
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
- If Fear & Greed < 25, look harder for contrarian long setups
- If 2s10s spread is inverted, add a yield curve play
- ALWAYS mention upcoming earnings as catalysts when relevant
- Be honest about uncertainty — don't force trades in bad environments`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 10000,
    messages: [{ role: 'user', content: prompt }],
    system: 'You are a professional trading strategist. Return ONLY valid JSON with no additional text or markdown.',
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  if (!text) throw new Error('Empty response from Claude');

  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  const nextScan = new Date(now.getTime() + 60 * 60 * 1000);

  return {
    opportunities: parsed.opportunities || [],
    marketContext: parsed.marketContext || '',
    scanMode: 'full-spectrum-v2',
    scannedAt: now.toISOString(),
    nextScanAt: nextScan.toISOString(),
    instrumentsScanned: totalInstruments,
    dataSources: {
      publicCom: marketQuotes.length,
      yahooChart: extraQuotes.length,
      fred: fredData.yieldCurve.some(y => y.value !== null),
      finnhub: finnhubData.earningsThisWeek.length > 0,
      fearGreed: fearGreed !== null,
      coinGecko: coinGecko.topCoins.length,
    },
    fearGreed,
    fredSummary: fredData.yieldCurve.some(y => y.value !== null) ? {
      spread2s10s: fredData.spread2s10s,
      breakeven10y: fredData.breakeven10y,
      fedFundsRate: fredData.fedFundsRate,
      yieldCurve: fredData.yieldCurve.map(y => ({ label: y.label, value: y.value })),
    } : null,
    earningsCount: finnhubData.earningsThisWeek.length,
    cryptoGlobal: coinGecko.btcDominance || coinGecko.globalMarketCap ? {
      btcDominance: coinGecko.btcDominance,
      totalMarketCap: coinGecko.globalMarketCap,
    } : null,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await safeAuth();

    // Check cache
    const hit = cached<ScanResult>('scanner');
    if (hit) return NextResponse.json(hit);

    console.log('[Scanner] Starting full-spectrum v2 scan...');

    // Fetch ALL data in parallel — original + new sources
    const [marketQuotes, extraQuotes, terminal, options, fredData, finnhubData, fearGreed, coinGecko] = await Promise.all([
      fetchMarketQuotes(),
      fetchExtraInstruments(),
      fetchTerminalData(),
      fetchOptionsFlow(),
      fetchFredData(),
      fetchFinnhubData(),
      fetchFearGreedIndex(),
      fetchCoinGeckoData(),
    ]);

    console.log(`[Scanner] Data: ${marketQuotes.length} market, ${extraQuotes.length} yahoo, FRED=${fredData.yieldCurve.some(y => y.value !== null)}, Finnhub=${finnhubData.earningsThisWeek.length} earnings, F&G=${fearGreed?.value ?? 'N/A'}, CoinGecko=${coinGecko.topCoins.length} coins`);

    // Run AI scan with all data sources
    const result = await runAIScan(marketQuotes, extraQuotes, terminal, options, fredData, finnhubData, fearGreed, coinGecko);

    console.log(`[Scanner] Found ${result.opportunities.length} opportunities from ${result.instrumentsScanned} instruments`);

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
