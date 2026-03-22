/**
 * Shared enriched data fetchers — FRED, Finnhub, Fear & Greed, CoinGecko
 * Used across Scanner, Terminal, Reports, Market Insights, etc.
 */

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

// In-memory cache for FRED data (1 hour TTL)
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
  // Return cached if fresh
  if (fredCache && Date.now() - fredCache.ts < FRED_CACHE_TTL) return fredCache.data;

  const results = await Promise.all(
    FRED_SERIES.map(async (s) => ({
      id: s.id,
      label: s.label,
      value: await fetchFredSeries(s.id),
    }))
  );

  const lookup = Object.fromEntries(results.map(r => [r.id, r.value]));
  const hasData = results.some(r => r.value !== null);

  const data: FredData = {
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

  const [earnings, insider] = await Promise.all([
    fetchFinnhubEarnings(),
    fetchFinnhubInsiderTransactions(),
  ]);

  const data: FinnhubData = {
    earningsThisWeek: earnings,
    insiderTransactions: insider,
    available: earnings.length > 0 || insider.length > 0,
  };

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

  let result: FearGreedData | null = null;

  try {
    const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      next: { revalidate: 3600 },
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

  // Fallback endpoint
  if (!result) {
    try {
      const url = 'https://production.dataviz.cnn.io/index/fearandgreed/current';
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 3600 },
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
    } catch { /* give up */ }
  }

  fgCache = { data: result, ts: Date.now() };
  return result;
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

  const [topCoins, trending, global] = await Promise.all([
    fetchCoinGeckoMarkets(),
    fetchCoinGeckoTrending(),
    fetchCoinGeckoGlobal(),
  ]);

  const data: CoinGeckoData = {
    topCoins,
    trending,
    globalMarketCap: global.marketCap,
    btcDominance: global.btcDominance,
    available: topCoins.length > 0,
  };

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

// ── Fetch All Enrichment Data ───────────────────────────────────────────────

export interface EnrichedData {
  fred: FredData;
  finnhub: FinnhubData;
  fearGreed: FearGreedData | null;
  coinGecko: CoinGeckoData;
}

/** Fetch all enriched data in parallel. Safe to call frequently — cached. */
export async function fetchAllEnrichedData(): Promise<EnrichedData> {
  const [fred, finnhub, fearGreed, coinGecko] = await Promise.all([
    fetchFredData(),
    fetchFinnhubData(),
    fetchFearGreedIndex(),
    fetchCoinGeckoData(),
  ]);
  return { fred, finnhub, fearGreed, coinGecko };
}

/** Build a combined macro context block for AI prompts */
export function enrichedDataToPromptBlock(data: EnrichedData): string {
  return [
    fredToPromptBlock(data.fred),
    fearGreedToPromptBlock(data.fearGreed),
    finnhubToPromptBlock(data.finnhub),
    coinGeckoToPromptBlock(data.coinGecko),
  ].join('\n\n');
}
