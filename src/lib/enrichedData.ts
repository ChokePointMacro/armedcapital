/**
 * Shared enriched data fetchers — FRED, Finnhub, Fear & Greed, CoinGecko
 * Used across Scanner, Terminal, Reports, Market Insights, etc.
 *
 * All fetchers are backed by Redis cache (survives serverless cold starts)
 * with in-memory fallback if Redis is unavailable.
 */

import {
  cached,
  TTL_GOVERNMENT, TTL_MARKET_DATA, TTL_CRYPTO, TTL_SENTIMENT,
  TTL_WEEKLY, TTL_DEFI, TTL_REALTIME, TTL_QUOTES,
} from './cache';

// ── Market Tide (Options Flow + Sentiment) ──────────────────────────────────

export interface MarketTideData {
  source: string;
  sentiment: string;
  sentimentStrength: string;
  netPremium: number;
  callPct: number;
  putPct: number;
  vix: number | null;
  totalOptionsVolume: number;
  sectors: Array<{ sector: string; etf: string; netPremium: number; sentimentScore: number }>;
  topTickers: Array<{ symbol: string; netPremium: number; totalVolume: number }>;
  available: boolean;
}

// In-memory fallback cache for Market Tide data
let marketTideCache: { data: MarketTideData; ts: number } | null = null;
const MARKET_TIDE_CACHE_TTL = 60 * 1000; // 60 seconds for real-time data

// ── FRED (Federal Reserve Economic Data) ────────────────────────────────────

export interface FredData {
  yieldCurve: { series: string; label: string; value: number | null }[];
  spread2s10s: number | null;
  breakeven5y: number | null;
  breakeven10y: number | null;
  initialClaims: number | null;
  fedFundsRate: number | null;
  available: boolean;
}

const FRED_SERIES = [
  { id: 'DGS2', label: '2Y Yield' },
  { id: 'DGS5', label: '5Y Yield' },
  { id: 'DGS10', label: '10Y Yield' },
  { id: 'DGS30', label: '30Y Yield' },
  { id: 'T10Y2Y', label: '10Y-2Y Spread' },
  { id: 'T10YIE', label: '10Y Breakeven Inflation' },
  { id: 'T5YIE', label: '5Y Breakeven Inflation' },
  { id: 'ICSA', label: 'Initial Jobless Claims' },
  { id: 'FEDFUNDS', label: 'Fed Funds Rate' },
];

// In-memory fallback cache for FRED data
let fredCache: { data: FredData; ts: number } | null = null;
const FRED_CACHE_TTL = 60 * 60 * 1000;

async function fetchFredSeries(seriesId: string): Promise<number | null> {
  try {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) return null;
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const json = await res.json();
    const obs = json.observations || [];
    for (const o of obs) {
      if (o.value && o.value !== '.') return parseFloat(o.value);
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchFredData(): Promise<FredData> {
  // In-memory fast check
  if (fredCache && Date.now() - fredCache.ts < FRED_CACHE_TTL) return fredCache.data;

  const data = await cached<FredData>('fred', TTL_GOVERNMENT, async () => {
    const results = await Promise.all(
      FRED_SERIES.map(async (s) => ({
        id: s.id,
        label: s.label,
        value: await fetchFredSeries(s.id),
      }))
    );

    const lookup = Object.fromEntries(results.map(r => [r.id, r.value]));
    const hasData = results.some(r => r.value !== null);

    return {
      yieldCurve: [
        { series: 'DGS2', label: '2Y', value: lookup['DGS2'] },
        { series: 'DGS5', label: '5Y', value: lookup['DGS5'] },
        { series: 'DGS10', label: '10Y', value: lookup['DGS10'] },
        { series: 'DGS30', label: '30Y', value: lookup['DGS30'] },
      ],
      spread2s10s: lookup['T10Y2Y'],
      breakeven5y: lookup['T5YIE'],
      breakeven10y: lookup['T10YIE'],
      initialClaims: lookup['ICSA'],
      fedFundsRate: lookup['FEDFUNDS'],
      available: hasData,
    };
  });

  fredCache = { data, ts: Date.now() };
  return data;
}

/** Compact text block for AI prompts */
export function fredToPromptBlock(fred: FredData): string {
  if (!fred.available) return 'FRED DATA: Unavailable (no API key configured)';
  return `FEDERAL RESERVE DATA (FRED):
- Yield Curve: ${fred.yieldCurve.map(y => `${y.label}: ${y.value != null ? y.value.toFixed(2) + '%' : 'N/A'}`).join(' | ')}
- 2s10s Spread: ${fred.spread2s10s != null ? fred.spread2s10s.toFixed(2) + '%' : 'N/A'} ${fred.spread2s10s != null && fred.spread2s10s < 0 ? '⚠️ INVERTED — recession signal' : ''}
- 5Y Breakeven Inflation: ${fred.breakeven5y != null ? fred.breakeven5y.toFixed(2) + '%' : 'N/A'}
- 10Y Breakeven Inflation: ${fred.breakeven10y != null ? fred.breakeven10y.toFixed(2) + '%' : 'N/A'}
- Fed Funds Rate: ${fred.fedFundsRate != null ? fred.fedFundsRate.toFixed(2) + '%' : 'N/A'}
- Initial Jobless Claims: ${fred.initialClaims != null ? fred.initialClaims.toLocaleString() : 'N/A'}`;
}

// ── Finnhub (Earnings Calendar + Insider Transactions) ──────────────────────

export interface EarningsEvent {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  hour: string;
}

export interface InsiderTransaction {
  symbol: string;
  name: string;
  share: number;
  change: number;
  transactionType: string;
  transactionDate: string;
}

export interface FinnhubData {
  earningsThisWeek: EarningsEvent[];
  insiderTransactions: InsiderTransaction[];
  available: boolean;
}

let finnhubCache: { data: FinnhubData; ts: number } | null = null;
const FINNHUB_CACHE_TTL = 60 * 60 * 1000;

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
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=AAPL&token=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const json = await res.json();
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

export async function fetchFinnhubData(): Promise<FinnhubData> {
  if (finnhubCache && Date.now() - finnhubCache.ts < FINNHUB_CACHE_TTL) return finnhubCache.data;

  const data = await cached<FinnhubData>('finnhub', TTL_MARKET_DATA, async () => {
    const [earnings, insider] = await Promise.all([
      fetchFinnhubEarnings(),
      fetchFinnhubInsiderTransactions(),
    ]);
    return {
      earningsThisWeek: earnings,
      insiderTransactions: insider,
      available: earnings.length > 0 || insider.length > 0,
    };
  });

  finnhubCache = { data, ts: Date.now() };
  return data;
}

/** Compact text block for AI prompts */
export function finnhubToPromptBlock(fh: FinnhubData): string {
  let block = '';
  if (fh.earningsThisWeek.length > 0) {
    block += `UPCOMING EARNINGS (next 7 days — ${fh.earningsThisWeek.length} reports):\n`;
    block += fh.earningsThisWeek.slice(0, 15).map(e =>
      `- ${e.symbol} on ${e.date} (${e.hour === 'bmo' ? 'pre-market' : e.hour === 'amc' ? 'after-close' : 'TBD'}) | EPS est: ${e.epsEstimate ?? 'N/A'} | Rev est: ${e.revenueEstimate ? '$' + (e.revenueEstimate / 1e9).toFixed(1) + 'B' : 'N/A'}`
    ).join('\n');
  } else {
    block += 'EARNINGS DATA: Unavailable';
  }

  if (fh.insiderTransactions.length > 0) {
    block += `\n\nINSIDER TRANSACTIONS (last 7 days, large >10k shares):\n`;
    block += fh.insiderTransactions.slice(0, 10).map(t =>
      `- ${t.symbol}: ${t.name} ${t.transactionType} ${Math.abs(t.change).toLocaleString()} shares on ${t.transactionDate}`
    ).join('\n');
  }

  return block;
}

// ── Fear & Greed Index ──────────────────────────────────────────────────────

export interface FearGreedData {
  value: number;
  label: string;
  previousClose: number;
  oneWeekAgo: number;
  oneMonthAgo: number;
  timestamp: string;
}

let fgCache: { data: FearGreedData | null; ts: number } | null = null;
const FG_CACHE_TTL = 60 * 60 * 1000;

function classifyFearGreed(value: number): string {
  if (value <= 25) return 'Extreme Fear';
  if (value <= 44) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 75) return 'Greed';
  return 'Extreme Greed';
}

export async function fetchFearGreedIndex(): Promise<FearGreedData | null> {
  if (fgCache && Date.now() - fgCache.ts < FG_CACHE_TTL) return fgCache.data;

  const data = await cached<FearGreedData | null>('fear-greed', TTL_SENTIMENT, async () => {
    let result: FearGreedData | null = null;

    // Attempt 1: CNN graphdata endpoint (works from browsers, often blocked server-side)
    try {
      const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://edition.cnn.com/',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json = await res.json();
        const fg = json.fear_and_greed;
        if (fg) {
          result = {
            value: Math.round(fg.score),
            label: fg.rating,
            previousClose: Math.round(fg.previous_close),
            oneWeekAgo: Math.round(fg.previous_1_week),
            oneMonthAgo: Math.round(fg.previous_1_month),
            timestamp: new Date().toISOString(),
          };
        }
      }
    } catch { /* fall through */ }

    // Attempt 2: CNN current endpoint
    if (!result) {
      try {
        const url = 'https://production.dataviz.cnn.io/index/fearandgreed/current';
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://edition.cnn.com/',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const json = await res.json();
          result = {
            value: Math.round(json.score || json.value || 50),
            label: json.rating || classifyFearGreed(json.score || json.value || 50),
            previousClose: Math.round(json.previous_close || json.score || 50),
            oneWeekAgo: Math.round(json.previous_1_week || 50),
            oneMonthAgo: Math.round(json.previous_1_month || 50),
            timestamp: new Date().toISOString(),
          };
        }
      } catch { /* fall through */ }
    }

    // Attempt 3: alternative.me Crypto Fear & Greed (reliable from server-side)
    if (!result) {
      try {
        const res = await fetch('https://api.alternative.me/fng/?limit=2', {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json();
          const today = json.data?.[0];
          const yesterday = json.data?.[1];
          if (today) {
            const val = parseInt(today.value);
            result = {
              value: val,
              label: today.value_classification || classifyFearGreed(val),
              previousClose: yesterday ? parseInt(yesterday.value) : val,
              oneWeekAgo: val, // not available from this API
              oneMonthAgo: val,
              timestamp: new Date(parseInt(today.timestamp) * 1000).toISOString(),
            };
          }
        }
      } catch { /* give up */ }
    }

    return result;
  });

  fgCache = { data, ts: Date.now() };
  return data;
}

/** Compact text block for AI prompts */
export function fearGreedToPromptBlock(fg: FearGreedData | null): string {
  if (!fg) return 'FEAR & GREED INDEX: Unavailable';
  return `CNN FEAR & GREED INDEX:
- Current: ${fg.value}/100 — "${fg.label}"
- Previous Close: ${fg.previousClose}
- 1 Week Ago: ${fg.oneWeekAgo}
- 1 Month Ago: ${fg.oneMonthAgo}
${fg.value <= 25 ? '⚠️ EXTREME FEAR — historically a strong contrarian BUY signal for equities' : ''}${fg.value >= 75 ? '⚠️ EXTREME GREED — historically a warning sign, longs are crowded' : ''}`;
}

// ── CoinGecko (Deep Crypto Data) ────────────────────────────────────────────

export interface CoinGeckoAsset {
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

export interface CoinGeckoData {
  topCoins: CoinGeckoAsset[];
  trending: { name: string; symbol: string; marketCapRank: number; priceBtc: number }[];
  globalMarketCap: number | null;
  btcDominance: number | null;
  available: boolean;
}

let cgCache: { data: CoinGeckoData; ts: number } | null = null;
const CG_CACHE_TTL = 10 * 60 * 1000; // 10min (CoinGecko rate limits are tight)

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
      sparkline7d: (c.sparkline_in_7d?.price || []).filter((_: any, i: number) => i % 24 === 0),
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

export async function fetchCoinGeckoData(): Promise<CoinGeckoData> {
  if (cgCache && Date.now() - cgCache.ts < CG_CACHE_TTL) return cgCache.data;

  const data = await cached<CoinGeckoData>('coingecko', TTL_CRYPTO, async () => {
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
      available: topCoins.length > 0,
    };
  });

  cgCache = { data, ts: Date.now() };
  return data;
}

/** Compact text block for AI prompts */
export function coinGeckoToPromptBlock(cg: CoinGeckoData): string {
  if (!cg.available) return 'CRYPTO DATA: Limited (CoinGecko unavailable)';
  return `CRYPTO MARKET DATA (CoinGecko — top 30 by market cap):
Global Crypto Market Cap: ${cg.globalMarketCap ? '$' + (cg.globalMarketCap / 1e12).toFixed(2) + 'T' : 'N/A'}
BTC Dominance: ${cg.btcDominance ? cg.btcDominance + '%' : 'N/A'}

Top Movers (24h):
${cg.topCoins
  .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
  .slice(0, 15)
  .map(c => `- ${c.symbol}: $${c.price.toLocaleString()} | 24h: ${c.change24h > 0 ? '+' : ''}${c.change24h}% | 7d: ${c.change7d > 0 ? '+' : ''}${c.change7d}% | Vol/MCap: ${c.volumeToMcap} | ATH dist: ${c.athChangePercent}% | MCap: $${(c.marketCap / 1e9).toFixed(1)}B`)
  .join('\n')}

Trending Coins (social momentum):
${cg.trending.map(t => `- ${t.symbol} (${t.name}) — rank #${t.marketCapRank || 'N/A'}`).join(', ')}`;
}

// ── BLS (Bureau of Labor Statistics) ─────────────────────────────────────────

export interface BlsData {
  cpiAllItems: number | null;
  cpiYoY: number | null;
  ppiAllCommodities: number | null;
  nonfarmPayrolls: number | null;
  unemploymentRate: number | null;
  averageHourlyEarnings: number | null;
  available: boolean;
}

let blsCache: { data: BlsData; ts: number } | null = null;
const BLS_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (BLS updates monthly)

async function fetchBlsSeries(seriesIds: string[]): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  seriesIds.forEach(id => { result[id] = null; });

  const apiKey = process.env.BLS_API_KEY;

  // Try POST first if we have an API key (more reliable with registered key)
  if (apiKey) {
    try {
      const currentYear = new Date().getFullYear();
      const res = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesid: seriesIds,
          startyear: String(currentYear - 1),
          endyear: String(currentYear),
          latest: true,
          registrationkey: apiKey,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'REQUEST_SUCCEEDED' && json.Results?.series) {
          for (const s of json.Results.series) {
            const latest = s.data?.find((d: any) => d.value && d.value !== '-');
            if (latest?.value) {
              result[s.seriesID] = parseFloat(latest.value);
            }
          }
          // If we got at least some data, return early
          if (Object.values(result).some(v => v !== null)) return result;
        }
      }
    } catch { /* fall through to GET */ }
  }

  // Fallback: individual GET requests per series (no auth required, works from serverless)
  const fetches = seriesIds.map(async (id) => {
    try {
      const res = await fetch(`https://api.bls.gov/publicAPI/v2/timeseries/data/${id}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.status === 'REQUEST_SUCCEEDED' && json.Results?.series?.[0]) {
        const latest = json.Results.series[0].data?.find((d: any) => d.value && d.value !== '-');
        if (latest?.value) {
          result[id] = parseFloat(latest.value);
        }
      }
    } catch { /* silent */ }
  });
  await Promise.all(fetches);
  return result;
}

export async function fetchBlsData(): Promise<BlsData> {
  if (blsCache && Date.now() - blsCache.ts < BLS_CACHE_TTL) return blsCache.data;

  const data = await cached<BlsData>('bls', TTL_GOVERNMENT, async () => {
    const seriesIds = ['CUSR0000SA0', 'WPUFD49104', 'CES0000000001', 'LNS14000000', 'CES0500000003'];
    const vals = await fetchBlsSeries(seriesIds);
    return {
      cpiAllItems: vals['CUSR0000SA0'],
      cpiYoY: null,
      ppiAllCommodities: vals['WPUFD49104'],
      nonfarmPayrolls: vals['CES0000000001'],
      unemploymentRate: vals['LNS14000000'],
      averageHourlyEarnings: vals['CES0500000003'],
      available: Object.values(vals).some(v => v !== null),
    };
  });

  blsCache = { data, ts: Date.now() };
  return data;
}

export function blsToPromptBlock(bls: BlsData): string {
  if (!bls.available) return 'BLS DATA: Unavailable';
  return `BLS LABOR & INFLATION DATA:
- CPI All Items (index): ${bls.cpiAllItems?.toFixed(1) ?? 'N/A'}
- PPI All Commodities (index): ${bls.ppiAllCommodities?.toFixed(1) ?? 'N/A'}
- Nonfarm Payrolls: ${bls.nonfarmPayrolls ? (bls.nonfarmPayrolls).toLocaleString() + 'K' : 'N/A'}
- Unemployment Rate: ${bls.unemploymentRate ? bls.unemploymentRate.toFixed(1) + '%' : 'N/A'}
- Avg Hourly Earnings: ${bls.averageHourlyEarnings ? '$' + bls.averageHourlyEarnings.toFixed(2) : 'N/A'}`;
}

// ── CFTC Commitment of Traders ──────────────────────────────────────────────

export interface CotPosition {
  market: string;
  longPositions: number;
  shortPositions: number;
  netPosition: number;
  changeInNet: number;
  reportDate: string;
}

export interface CftcData {
  positions: CotPosition[];
  available: boolean;
}

let cftcCache: { data: CftcData; ts: number } | null = null;
const CFTC_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours (weekly report)

async function fetchCftcRaw(): Promise<CftcData> {
  const positions: CotPosition[] = [];

  try {
    // CFTC SOCRATA API — Disaggregated / Legacy COT Reports
    // Key markets matched against actual CFTC market_and_exchange_names values
    const contracts = [
      { match: 'E-MINI S&P 500', label: 'E-Mini S&P 500' },
      { match: 'UST 10Y NOTE', label: '10-Year T-Note' },
      { match: 'GOLD - COMMODITY', label: 'Gold' },
      { match: 'EURO FX - CHICAGO', label: 'Euro FX' },
      { match: 'BITCOIN - CHICAGO', label: 'Bitcoin' },
    ];

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=200&$where=report_date_as_yyyy_mm_dd > '${cutoff}'`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const json = await res.json();
      // Get latest report per contract (case-insensitive matching)
      const seen = new Set<string>();
      for (const row of json) {
        const name = (row.market_and_exchange_names || row.contract_market_name || '').toUpperCase();
        const matched = contracts.find(c => name.includes(c.match.toUpperCase()));
        if (matched && !seen.has(matched.label)) {
          seen.add(matched.label);
          const longPos = parseInt(row.noncomm_positions_long_all || '0');
          const shortPos = parseInt(row.noncomm_positions_short_all || '0');
          positions.push({
            market: matched.label,
            longPositions: longPos,
            shortPositions: shortPos,
            netPosition: longPos - shortPos,
            changeInNet: parseInt(row.change_in_noncomm_long_all || '0') - parseInt(row.change_in_noncomm_short_all || '0'),
            reportDate: row.report_date_as_yyyy_mm_dd || '',
          });
        }
      }
    }
  } catch { /* silent */ }

  return { positions, available: positions.length > 0 };
}

export async function fetchCftcData(): Promise<CftcData> {
  if (cftcCache && Date.now() - cftcCache.ts < CFTC_CACHE_TTL) return cftcCache.data;
  const data = await cached<CftcData>('cftc', TTL_WEEKLY, fetchCftcRaw);
  cftcCache = { data, ts: Date.now() };
  return data;
}

export function cftcToPromptBlock(cftc: CftcData): string {
  if (!cftc.available) return 'CFTC COT DATA: Unavailable';
  return `CFTC COMMITMENT OF TRADERS (non-commercial/speculative positioning):
${cftc.positions.map(p =>
    `- ${p.market}: Net ${p.netPosition > 0 ? '+' : ''}${p.netPosition.toLocaleString()} (Δ${p.changeInNet > 0 ? '+' : ''}${p.changeInNet.toLocaleString()}) | Long: ${p.longPositions.toLocaleString()} Short: ${p.shortPositions.toLocaleString()} [${p.reportDate}]`
  ).join('\n')}`;
}

// ── Treasury.gov (Fiscal Data) ──────────────────────────────────────────────

export interface TreasuryData {
  tgaBalance: number | null;
  tgaDate: string | null;
  debtToThePenny: number | null;
  debtDate: string | null;
  avgInterestRate: number | null;
  available: boolean;
}

let treasuryCache: { data: TreasuryData; ts: number } | null = null;
const TREASURY_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

async function fetchTreasuryRaw(): Promise<TreasuryData> {
  let tgaBalance: number | null = null;
  let tgaDate: string | null = null;
  let debtToThePenny: number | null = null;
  let debtDate: string | null = null;
  let avgInterestRate: number | null = null;

  // TGA Balance (Treasury General Account)
  try {
    const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/dts_table_1?sort=-record_date&page[size]=1&fields=record_date,close_today_bal&filter=account_type:eq:Treasury General Account (TGA) Closing Balance';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      const row = json.data?.[0];
      if (row) {
        tgaBalance = parseFloat(row.close_today_bal);
        tgaDate = row.record_date;
      }
    }
  } catch { /* silent */ }

  // Debt to the Penny
  try {
    const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      const row = json.data?.[0];
      if (row) {
        debtToThePenny = parseFloat(row.tot_pub_debt_out_amt);
        debtDate = row.record_date;
      }
    }
  } catch { /* silent */ }

  // Average Interest Rate on Debt
  try {
    const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=1&filter=security_desc:eq:Total Marketable';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      const row = json.data?.[0];
      if (row?.avg_interest_rate_amt) {
        avgInterestRate = parseFloat(row.avg_interest_rate_amt);
      }
    }
  } catch { /* silent */ }

  const data: TreasuryData = {
    tgaBalance,
    tgaDate,
    debtToThePenny,
    debtDate,
    avgInterestRate,
    available: tgaBalance !== null || debtToThePenny !== null,
  };

  return data;
}

export async function fetchTreasuryData(): Promise<TreasuryData> {
  if (treasuryCache && Date.now() - treasuryCache.ts < TREASURY_CACHE_TTL) return treasuryCache.data;
  const data = await cached<TreasuryData>('treasury', TTL_GOVERNMENT, fetchTreasuryRaw);
  treasuryCache = { data, ts: Date.now() };
  return data;
}

export function treasuryToPromptBlock(t: TreasuryData): string {
  if (!t.available) return 'TREASURY DATA: Unavailable';
  return `U.S. TREASURY FISCAL DATA:
- TGA Balance: ${t.tgaBalance ? '$' + (t.tgaBalance / 1e9).toFixed(1) + 'B' : 'N/A'}${t.tgaDate ? ` (${t.tgaDate})` : ''}${t.tgaBalance && t.tgaBalance < 100e9 ? ' ⚠️ LOW — liquidity squeeze risk' : ''}
- National Debt: ${t.debtToThePenny ? '$' + (t.debtToThePenny / 1e12).toFixed(2) + 'T' : 'N/A'}${t.debtDate ? ` (${t.debtDate})` : ''}
- Avg Interest Rate on Debt: ${t.avgInterestRate ? t.avgInterestRate.toFixed(2) + '%' : 'N/A'}`;
}

// ── DefiLlama (DeFi TVL & Stablecoins) ─────────────────────────────────────

export interface DefiLlamaProtocol {
  name: string;
  tvl: number;
  change1d: number;
  change7d: number;
  category: string;
  chains: string[];
}

export interface DefiLlamaData {
  totalTvl: number | null;
  topProtocols: DefiLlamaProtocol[];
  chainTvl: { name: string; tvl: number }[];
  stablecoinMcap: number | null;
  available: boolean;
}

let defiCache: { data: DefiLlamaData; ts: number } | null = null;
const DEFI_CACHE_TTL = 15 * 60 * 1000; // 15 min

async function fetchDefiLlamaRaw(): Promise<DefiLlamaData> {
  let totalTvl: number | null = null;
  let topProtocols: DefiLlamaProtocol[] = [];
  let chainTvl: { name: string; tvl: number }[] = [];
  let stablecoinMcap: number | null = null;

  // Top protocols by TVL
  try {
    const res = await fetch('https://api.llama.fi/protocols');
    if (res.ok) {
      const json = await res.json();
      topProtocols = json
        .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 20)
        .map((p: any) => ({
          name: p.name,
          tvl: p.tvl || 0,
          change1d: p.change_1d || 0,
          change7d: p.change_7d || 0,
          category: p.category || 'Other',
          chains: (p.chains || []).slice(0, 5),
        }));
    }
  } catch { /* silent */ }

  // Chain TVL
  try {
    const res = await fetch('https://api.llama.fi/v2/chains');
    if (res.ok) {
      const json = await res.json();
      chainTvl = json
        .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 15)
        .map((c: any) => ({ name: c.name, tvl: c.tvl || 0 }));
      totalTvl = json.reduce((sum: number, c: any) => sum + (c.tvl || 0), 0);
    }
  } catch { /* silent */ }

  // Stablecoin market cap
  try {
    const res = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=false');
    if (res.ok) {
      const json = await res.json();
      stablecoinMcap = (json.peggedAssets || []).reduce(
        (sum: number, s: any) => sum + (s.circulating?.peggedUSD || 0), 0
      );
    }
  } catch { /* silent */ }

  const data: DefiLlamaData = {
    totalTvl,
    topProtocols,
    chainTvl,
    stablecoinMcap,
    available: topProtocols.length > 0 || chainTvl.length > 0,
  };

  return data;
}

export async function fetchDefiLlamaData(): Promise<DefiLlamaData> {
  if (defiCache && Date.now() - defiCache.ts < DEFI_CACHE_TTL) return defiCache.data;
  const data = await cached<DefiLlamaData>('defi-llama', TTL_DEFI, fetchDefiLlamaRaw);
  defiCache = { data, ts: Date.now() };
  return data;
}

export function defiLlamaToPromptBlock(d: DefiLlamaData): string {
  if (!d.available) return 'DEFI DATA: Unavailable';
  const fmtB = (n: number) => n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : '$' + (n / 1e6).toFixed(0) + 'M';
  return `DEFI & ON-CHAIN DATA (DefiLlama):
Total DeFi TVL: ${d.totalTvl ? fmtB(d.totalTvl) : 'N/A'}
Stablecoin Market Cap: ${d.stablecoinMcap ? fmtB(d.stablecoinMcap) : 'N/A'}

Top Protocols by TVL:
${d.topProtocols.slice(0, 10).map(p =>
    `- ${p.name}: ${fmtB(p.tvl)} (1d: ${p.change1d > 0 ? '+' : ''}${p.change1d.toFixed(1)}% | 7d: ${p.change7d > 0 ? '+' : ''}${p.change7d.toFixed(1)}%) [${p.category}]`
  ).join('\n')}

Chain TVL Rankings:
${d.chainTvl.slice(0, 10).map(c => `- ${c.name}: ${fmtB(c.tvl)}`).join('\n')}`;
}

// ── TradingView Signals (from webhook) ─────────────────────────────────────

export interface TradingViewSignalData {
  signals: Array<{
    ticker: string;
    action: string;
    close: number | null;
    volume: number | null;
    interval: string | null;
    strategy: string | null;
    message: string | null;
    received_at: string;
  }>;
  count: number;
  available: boolean;
}

// In-memory cache for TradingView signals (5 min TTL — signals should be near-real-time)
let tvCache: { data: TradingViewSignalData; ts: number } | null = null;
const TV_CACHE_TTL = 5 * 60 * 1000;

export async function fetchTradingViewSignals(): Promise<TradingViewSignalData> {
  if (tvCache && Date.now() - tvCache.ts < TV_CACHE_TTL) return tvCache.data;

  try {
    // Try in-memory buffer first
    const { getRecentSignals } = await import('@/lib/tradingviewSignals');
    const buffered = getRecentSignals(50);

    if (buffered.length > 0) {
      const data: TradingViewSignalData = {
        signals: buffered.map(s => ({
          ticker: s.ticker || 'UNKNOWN',
          action: s.action || 'alert',
          close: s.close ?? null,
          volume: s.volume ?? null,
          interval: s.interval ?? null,
          strategy: s.strategy ?? null,
          message: s.message ?? null,
          received_at: s.received_at,
        })),
        count: buffered.length,
        available: true,
      };
      tvCache = { data, ts: Date.now() };
      return data;
    }

    // Fallback: query Supabase for recent signals (last 6 hours)
    const { createServerSupabase } = await import('@/lib/supabase');
    const db = createServerSupabase();
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const { data: rows } = await db.from('tradingview_signals')
      .select('ticker, action, price_close, volume, interval_tf, strategy, message, received_at')
      .gte('received_at', sixHoursAgo)
      .order('received_at', { ascending: false })
      .limit(50);

    const signals = (rows || []).map(r => ({
      ticker: r.ticker || 'UNKNOWN',
      action: r.action || 'alert',
      close: r.price_close,
      volume: r.volume,
      interval: r.interval_tf,
      strategy: r.strategy,
      message: r.message,
      received_at: r.received_at,
    }));

    const data: TradingViewSignalData = {
      signals,
      count: signals.length,
      available: signals.length > 0,
    };
    tvCache = { data, ts: Date.now() };
    return data;
  } catch {
    return { signals: [], count: 0, available: false };
  }
}

/** Prompt block for AI reports */
export function tradingViewToPromptBlock(tv: TradingViewSignalData): string {
  if (!tv.available || tv.signals.length === 0) {
    return 'TRADINGVIEW SIGNALS: No recent signals received.';
  }

  // Group by action type
  const buys = tv.signals.filter(s => ['buy', 'long'].includes(s.action));
  const sells = tv.signals.filter(s => ['sell', 'short'].includes(s.action));
  const alerts = tv.signals.filter(s => !['buy', 'long', 'sell', 'short'].includes(s.action));

  const formatSig = (s: typeof tv.signals[0]) =>
    `- ${s.ticker} @ $${s.close?.toLocaleString() || 'N/A'} (${s.strategy || 'manual'}) ${s.interval || ''} — ${new Date(s.received_at).toLocaleTimeString()}${s.message ? ` [${s.message}]` : ''}`;

  let block = `TRADINGVIEW LIVE SIGNALS (${tv.count} signals, last 6h):\n`;
  if (buys.length > 0) block += `\nBUY/LONG Signals:\n${buys.map(formatSig).join('\n')}`;
  if (sells.length > 0) block += `\nSELL/SHORT Signals:\n${sells.map(formatSig).join('\n')}`;
  if (alerts.length > 0) block += `\nALERTS:\n${alerts.slice(0, 10).map(formatSig).join('\n')}`;

  return block;
}

// ── TradingView Real-Time Quotes (WebSocket) ─────────────────────────────────

export interface TVLiveQuotes {
  quotes: Array<{
    symbol: string;
    price: number | null;
    change: number | null;
    changePercent: number | null;
    volume: number | null;
    high: number | null;
    low: number | null;
  }>;
  connected: boolean;
  authenticated: boolean;
  available: boolean;
}

let tvQuotesCache: { data: TVLiveQuotes; ts: number } | null = null;
const TV_QUOTES_CACHE_TTL = 60_000; // 1 minute

export async function fetchTVLiveQuotes(): Promise<TVLiveQuotes> {
  if (tvQuotesCache && Date.now() - tvQuotesCache.ts < TV_QUOTES_CACHE_TTL) return tvQuotesCache.data;

  const data = await cached<TVLiveQuotes>('tv-quotes', TTL_QUOTES, async () => {
    try {
      const { fetchQuotes, getConnectionStatus, DEFAULT_SYMBOLS } = await import('@/lib/tradingviewWS');
      const quotes = await fetchQuotes(DEFAULT_SYMBOLS, 3000);
      const status = getConnectionStatus();
      return {
        quotes: quotes.map(q => ({
          symbol: q.symbol,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          volume: q.volume,
          high: q.high,
          low: q.low,
        })),
        connected: status.connected,
        authenticated: status.authenticated,
        available: quotes.length > 0,
      };
    } catch {
      return { quotes: [], connected: false, authenticated: false, available: false };
    }
  });

  tvQuotesCache = { data, ts: Date.now() };
  return data;
}

function tvQuotesToPromptBlock(quotes: TVLiveQuotes): string {
  if (!quotes.available || quotes.quotes.length === 0) {
    return 'TRADINGVIEW LIVE QUOTES: No real-time data available.';
  }

  const lines = quotes.quotes.map(q => {
    const price = q.price != null ? `$${q.price.toLocaleString()}` : 'N/A';
    const chg = q.changePercent != null ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '';
    const vol = q.volume != null ? `vol: ${(q.volume / 1e6).toFixed(1)}M` : '';
    return `- ${q.symbol}: ${price} ${chg} ${vol}`.trim();
  });

  return `TRADINGVIEW REAL-TIME QUOTES (${quotes.authenticated ? 'Plus — no delay' : 'free — 10min delay'}):\n${lines.join('\n')}`;
}

// ── Market Tide (Options Flow + Sentiment) ─────────────────────────────────

export async function fetchMarketTide(): Promise<MarketTideData> {
  // In-memory fast check
  if (marketTideCache && Date.now() - marketTideCache.ts < MARKET_TIDE_CACHE_TTL) return marketTideCache.data;

  const data = await cached<MarketTideData>('market_tide', TTL_REALTIME, async () => {
    try {
      // Use internal API call
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const res = await fetch(`${baseUrl}/api/market-tide`);
      if (!res.ok) throw new Error(`Market Tide fetch failed: ${res.status}`);
      const d = await res.json();
      return { ...d, available: true };
    } catch {
      return { source: 'unavailable', sentiment: 'Unknown', sentimentStrength: '0%', netPremium: 0, callPct: 50, putPct: 50, vix: null, totalOptionsVolume: 0, sectors: [], topTickers: [], available: false };
    }
  });

  marketTideCache = { data, ts: Date.now() };
  return data;
}

export function marketTideToPromptBlock(tide: MarketTideData): string {
  if (!tide.available) return 'MARKET TIDE: Unavailable';
  const topSector = tide.sectors.sort((a, b) => b.sentimentScore - a.sentimentScore)[0];
  const topTickers = tide.topTickers.slice(0, 5).map(t => `${t.symbol} (net $${(t.netPremium/1e6).toFixed(1)}M)`).join(', ');
  return `LIVE MARKET TIDE (${tide.source}):
- Sentiment: ${tide.sentiment} (${tide.sentimentStrength})
- Net Premium: ${tide.netPremium > 0 ? '+' : ''}$${(tide.netPremium/1e6).toFixed(1)}M
- Calls ${tide.callPct}% vs Puts ${tide.putPct}%
- VIX: ${tide.vix?.toFixed(1) ?? 'N/A'}
- Options Volume: ${tide.totalOptionsVolume.toLocaleString()}
- Top Sector: ${topSector?.sector ?? 'N/A'} (${topSector?.etf ?? ''})
- Top Flow Tickers: ${topTickers || 'N/A'}`;
}

// ── Fetch All Enrichment Data ───────────────────────────────────────────────

export interface EnrichedData {
  fred: FredData;
  finnhub: FinnhubData;
  fearGreed: FearGreedData | null;
  coinGecko: CoinGeckoData;
  tradingView: TradingViewSignalData;
  tvLiveQuotes: TVLiveQuotes;
  bls: BlsData;
  cftc: CftcData;
  treasury: TreasuryData;
  defiLlama: DefiLlamaData;
  marketTide: MarketTideData;
}

/** Fetch all enriched data in parallel. Safe to call frequently — cached. */
export async function fetchAllEnrichedData(): Promise<EnrichedData> {
  const [fred, finnhub, fearGreed, coinGecko, tradingView, tvLiveQuotes, bls, cftc, treasury, defiLlama, marketTide] = await Promise.all([
    fetchFredData(),
    fetchFinnhubData(),
    fetchFearGreedIndex(),
    fetchCoinGeckoData(),
    fetchTradingViewSignals(),
    fetchTVLiveQuotes(),
    fetchBlsData(),
    fetchCftcData(),
    fetchTreasuryData(),
    fetchDefiLlamaData(),
    fetchMarketTide(),
  ]);
  return { fred, finnhub, fearGreed, coinGecko, tradingView, tvLiveQuotes, bls, cftc, treasury, defiLlama, marketTide };
}

/** Clear all in-memory caches — used by reconnect endpoint to force fresh fetches */
export function clearAllMemoryCaches() {
  fredCache = null;
  finnhubCache = null;
  fgCache = null;
  cgCache = null;
  blsCache = null;
  cftcCache = null;
  treasuryCache = null;
  defiCache = null;
  tvCache = null;
  tvQuotesCache = null;
  marketTideCache = null;
}

/** Build a combined macro context block for AI prompts */
export function enrichedDataToPromptBlock(data: EnrichedData): string {
  return [
    fredToPromptBlock(data.fred),
    blsToPromptBlock(data.bls),
    treasuryToPromptBlock(data.treasury),
    cftcToPromptBlock(data.cftc),
    fearGreedToPromptBlock(data.fearGreed),
    finnhubToPromptBlock(data.finnhub),
    coinGeckoToPromptBlock(data.coinGecko),
    defiLlamaToPromptBlock(data.defiLlama),
    tradingViewToPromptBlock(data.tradingView),
    tvQuotesToPromptBlock(data.tvLiveQuotes),
    marketTideToPromptBlock(data.marketTide),
  ].join('\n\n');
}
