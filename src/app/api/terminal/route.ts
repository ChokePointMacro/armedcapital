import { NextRequest, NextResponse } from 'next/server';
import { fetchFredData, fetchFearGreedIndex, fetchCoinGeckoData } from '@/lib/enrichedData';
import { getToken, initTokens } from '@/lib/tokenManager';

export const dynamic = 'force-dynamic';

const TERMINAL_TTL = 5 * 60 * 1000; // 5 minutes
let terminalCache: { data: any; ts: number } | null = null;

// ─── Yahoo Finance fetcher ─────────────────────────────────────────────────

interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketPreviousClose: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuote[]> {
  // Ensure tokens loaded from Supabase
  await initTokens().catch(() => {});

  try {
    // Try authenticated v7 first (cookie + crumb from platform_credentials)
    const yahooCookie = getToken('yahoo', 'cookie');
    const yahooCrumb = getToken('yahoo', 'crumb');

    const symbolsParam = encodeURIComponent(symbols.join(','));
    const url = yahooCrumb
      ? `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbolsParam}&crumb=${encodeURIComponent(yahooCrumb)}`
      : `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsParam}`;

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    };
    if (yahooCookie) {
      headers['Cookie'] = yahooCookie;
    }

    const res = await fetch(url, { headers, next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Yahoo v7 ${res.status}`);
    const data = await res.json();
    return data.quoteResponse?.result || [];
  } catch (err) {
    console.warn('[Terminal] Yahoo v7 failed, trying v8 chart fallback:', (err as Error).message);
    return fetchYahooChartFallback(symbols);
  }
}

async function fetchYahooChartFallback(symbols: string[]): Promise<YahooQuote[]> {
  const results: YahooQuote[] = [];
  await Promise.allSettled(
    symbols.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&includePrePost=false`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const meta = data.chart?.result?.[0]?.meta;
        if (!meta) return;
        const price = meta.regularMarketPrice ?? 0;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        results.push({
          symbol: sym,
          regularMarketPrice: price,
          regularMarketChange: price - prevClose,
          regularMarketChangePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
          regularMarketPreviousClose: prevClose,
        });
      } catch { /* individual symbol fetch — non-critical */ }
    })
  );
  return results;
}

// Fetch VIX history for IV percentile calculation
async function fetchVixHistory(): Promise<{ current: number; percentile: number; trend: string; avg20d: number }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1y&includePrePost=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!res.ok) throw new Error(`VIX history ${res.status}`);
    const data = await res.json();
    const closes: number[] = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v: any) => v != null) || [];
    if (closes.length < 20) throw new Error('Not enough VIX data');

    const current = closes[closes.length - 1];
    const prev5 = closes.slice(-6, -1);
    const avg5d = prev5.reduce((a: number, b: number) => a + b, 0) / prev5.length;
    const avg20d = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
    const belowCurrent = closes.filter((v: number) => v < current).length;
    const percentile = Math.round((belowCurrent / closes.length) * 100);
    const trend = current < avg5d ? 'Falling' : current > avg5d * 1.05 ? 'Rising' : 'Stable';

    return { current, percentile, trend, avg20d };
  } catch {
    return { current: 0, percentile: 50, trend: 'Unknown', avg20d: 0 };
  }
}

// Fetch SPX chart data for MA calculations
async function fetchSpxMaData(): Promise<{ price: number; ma20: number; ma50: number; ma200: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1y&includePrePost=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const closes: number[] = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v: any) => v != null) || [];
    if (closes.length < 200) return null;

    const price = closes[closes.length - 1];
    const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    return { price, ma20, ma50, ma200 };
  } catch {
    return null;
  }
}

// ─── Score calculators ──────────────────────────────────────────────────────

function calcVolatilityScore(vix: number, percentile: number, trend: string): number {
  // Lower VIX = higher score (better for longs)
  let score = 50;
  if (vix < 12) score = 95;
  else if (vix < 15) score = 85;
  else if (vix < 18) score = 75;
  else if (vix < 22) score = 65;
  else if (vix < 28) score = 45;
  else if (vix < 35) score = 30;
  else score = 15;

  // Adjust for trend
  if (trend === 'Falling') score = Math.min(100, score + 5);
  if (trend === 'Rising') score = Math.max(0, score - 10);

  // Adjust for percentile (high percentile = VIX is elevated relative to history)
  if (percentile > 80) score = Math.max(0, score - 10);
  if (percentile < 20) score = Math.min(100, score + 5);

  return Math.round(score);
}

function calcTrendScore(spxMa: { price: number; ma20: number; ma50: number; ma200: number } | null, qqqChange: number): number {
  if (!spxMa) return 50;
  let score = 50;
  const { price, ma20, ma50, ma200 } = spxMa;

  // Above/below MAs
  if (price > ma20) score += 10;
  else score -= 10;
  if (price > ma50) score += 12;
  else score -= 12;
  if (price > ma200) score += 15;
  else score -= 20;

  // MA ordering (golden cross pattern)
  if (ma20 > ma50 && ma50 > ma200) score += 8;
  if (ma20 < ma50 && ma50 < ma200) score -= 8;

  // QQQ direction
  if (qqqChange > 0) score += 5;
  else if (qqqChange < -1) score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcBreadthScore(sectors: { change: number }[]): { score: number; pctPositive: number } {
  if (sectors.length === 0) return { score: 50, pctPositive: 50 };
  const positive = sectors.filter(s => s.change > 0).length;
  const pctPositive = Math.round((positive / sectors.length) * 100);

  let score = 50;
  if (pctPositive >= 90) score = 92;
  else if (pctPositive >= 80) score = 85;
  else if (pctPositive >= 70) score = 75;
  else if (pctPositive >= 60) score = 65;
  else if (pctPositive >= 50) score = 55;
  else if (pctPositive >= 40) score = 40;
  else if (pctPositive >= 30) score = 30;
  else score = 20;

  return { score, pctPositive };
}

function calcMomentumScore(sectors: { name: string; symbol: string; change: number }[]): number {
  if (sectors.length === 0) return 50;
  const avgChange = sectors.reduce((s, sec) => s + sec.change, 0) / sectors.length;
  const positive = sectors.filter(s => s.change > 0).length;

  let score = 50;
  if (avgChange > 1.5) score = 90;
  else if (avgChange > 1) score = 80;
  else if (avgChange > 0.5) score = 70;
  else if (avgChange > 0) score = 60;
  else if (avgChange > -0.5) score = 45;
  else if (avgChange > -1) score = 35;
  else score = 20;

  // Broad participation bonus
  if (positive >= 9) score = Math.min(100, score + 5);
  if (positive <= 3) score = Math.max(0, score - 5);

  return Math.round(score);
}

function calcOilScore(oilPrice: number | null, oilChangePct: number | null): number {
  if (oilPrice == null) return 50;
  let score = 50;

  // Price level impact on equities
  if (oilPrice > 100) score = 20;       // severe inflationary pressure
  else if (oilPrice > 90) score = 30;   // high inflation risk
  else if (oilPrice > 80) score = 40;   // moderate inflation concern
  else if (oilPrice > 70) score = 55;   // normal range
  else if (oilPrice > 60) score = 65;   // goldilocks — low inflation
  else if (oilPrice > 50) score = 55;   // getting low — demand concern
  else score = 35;                       // crash — recession signal

  // Daily change factor
  if (oilChangePct != null) {
    if (oilChangePct > 5) score = Math.max(0, score - 15);     // oil spike = bad for stocks
    else if (oilChangePct > 2) score = Math.max(0, score - 8);
    else if (oilChangePct < -5) score = Math.max(0, score - 10); // oil crash = recession fear
    else if (oilChangePct < -2) score = Math.min(100, score + 3); // mild dip = marginally positive
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcCryptoScore(
  btcPrice: number | null,
  btcChangePct: number | null,
  btcDominance: number | null
): number {
  if (btcPrice == null) return 50;
  let score = 50;

  // BTC daily change as risk sentiment proxy
  if (btcChangePct != null) {
    if (btcChangePct > 5) score += 20;       // strong risk-on
    else if (btcChangePct > 2) score += 12;
    else if (btcChangePct > 0) score += 5;
    else if (btcChangePct > -2) score -= 5;
    else if (btcChangePct > -5) score -= 12;
    else score -= 20;                        // risk-off panic
  }

  // BTC dominance: very high dominance = flight to quality within crypto = less risk appetite
  if (btcDominance != null) {
    if (btcDominance > 65) score -= 5;   // rotation to BTC only — risk-off within crypto
    else if (btcDominance < 45) score += 5; // alt season — full risk-on
  }

  // BTC price level as general risk barometer
  if (btcPrice > 100000) score = Math.min(100, score + 5);
  else if (btcPrice > 60000) score = Math.min(100, score + 3);
  else if (btcPrice < 30000) score = Math.max(0, score - 10);
  else if (btcPrice < 20000) score = Math.max(0, score - 20);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcMacroScore(
  tenYield: number | null,
  spread2s10s: number | null,
  fearGreedValue: number | null,
  dxy: number | null
): number {
  let score = 50;

  // 10Y yield: moderate is good, extreme is bad
  if (tenYield != null) {
    if (tenYield >= 3.5 && tenYield <= 4.5) score += 10;
    else if (tenYield > 5) score -= 15;
    else if (tenYield < 2) score -= 5;
  }

  // Yield curve: inverted is bad
  if (spread2s10s != null) {
    if (spread2s10s < -0.5) score -= 15;
    else if (spread2s10s < 0) score -= 8;
    else if (spread2s10s > 0.5) score += 5;
  }

  // Fear & Greed: moderate/greed is better for longs, extreme greed is contrarian risk
  if (fearGreedValue != null) {
    if (fearGreedValue >= 70) score += 3; // greed — cautiously positive
    else if (fearGreedValue >= 50) score += 8; // neutral-to-greed
    else if (fearGreedValue >= 30) score += 0;
    else score -= 10; // extreme fear
  }

  // DXY: strong dollar can pressure equities
  if (dxy != null) {
    if (dxy > 107) score -= 8;
    else if (dxy > 105) score -= 4;
    else if (dxy < 100) score += 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getSignal(pct: number): string {
  if (pct > 5) return 'strong';
  if (pct > 2) return 'intact';
  if (pct > 0) return 'weak';
  if (pct > -2) return 'caution';
  return 'broken';
}

function getRegime(spxMa: { price: number; ma20: number; ma50: number; ma200: number } | null): string {
  if (!spxMa) return 'unknown';
  const { price, ma50, ma200 } = spxMa;
  if (price > ma50 && ma50 > ma200) return 'uptrend';
  if (price < ma50 && ma50 < ma200) return 'downtrend';
  if (price > ma200) return 'recovery';
  return 'choppy';
}

// ─── Next FOMC meeting dates (hardcoded schedule, update annually) ──────────

function getNextFomc(): { label: string; signal: string } {
  const fomcDates = [
    '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
    '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16',
  ].map(d => new Date(d + 'T14:00:00-05:00'));

  const now = new Date();
  const next = fomcDates.find(d => d > now);
  if (!next) return { label: 'TBD', signal: 'neutral' };

  const days = Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const label = days <= 1 ? 'Today' : days <= 2 ? 'Tomorrow' : `In ${days} days`;
  const signal = days <= 3 ? 'caution' : days <= 7 ? 'watch' : 'clear';
  return { label, signal };
}

// ─── Sector ETF list ────────────────────────────────────────────────────────

const SECTOR_ETFS = [
  { name: 'Technology', symbol: 'XLK' },
  { name: 'Financials', symbol: 'XLF' },
  { name: 'Healthcare', symbol: 'XLV' },
  { name: 'Energy', symbol: 'XLE' },
  { name: 'Industrials', symbol: 'XLI' },
  { name: 'Materials', symbol: 'XLB' },
  { name: 'Utilities', symbol: 'XLU' },
  { name: 'Consumer Staples', symbol: 'XLP' },
  { name: 'Consumer Disc.', symbol: 'XLY' },
  { name: 'Real Estate', symbol: 'XLRE' },
  { name: 'Comm. Services', symbol: 'XLC' },
];

// ─── Main data builder ──────────────────────────────────────────────────────

async function buildTerminalData() {
  // Fetch everything in parallel
  const [
    indexQuotes,
    sectorQuotes,
    vixHistory,
    spxMa,
    fred,
    fearGreed,
    coinGecko,
  ] = await Promise.all([
    fetchYahooQuotes(['^GSPC', '^IXIC', '^VIX', 'DX-Y.NYB', '^TNX', 'GLD', 'CL=F', 'BTC-USD']),
    fetchYahooQuotes(SECTOR_ETFS.map(s => s.symbol)),
    fetchVixHistory(),
    fetchSpxMaData(),
    fetchFredData(),
    fetchFearGreedIndex(),
    fetchCoinGeckoData(),
  ]);

  // Parse index quotes
  const findQ = (sym: string) => indexQuotes.find(q => q.symbol === sym || q.symbol === sym.replace('^', ''));
  const spx = findQ('^GSPC');
  const ndx = findQ('^IXIC');
  const vix = findQ('^VIX');
  const dxyQ = findQ('DX-Y.NYB');
  const tnx = findQ('^TNX');
  const gld = findQ('GLD');
  const oil = findQ('CL=F');
  const btc = findQ('BTC-USD');

  // Build sector data
  const sectors = SECTOR_ETFS.map(s => {
    const q = sectorQuotes.find(sq => sq.symbol === s.symbol);
    return {
      name: s.name,
      symbol: s.symbol,
      change: q ? Math.round(q.regularMarketChangePercent * 100) / 100 : 0,
    };
  }).sort((a, b) => b.change - a.change);

  // Real VIX data
  const vixLevel = vix?.regularMarketPrice ?? vixHistory.current ?? 18;
  const vixPercentile = vixHistory.percentile;
  const vixTrend = vixHistory.trend;

  // FRED yields
  const tenYearYield = tnx?.regularMarketPrice ?? fred.yieldCurve.find(y => y.series === 'DGS10')?.value ?? 4.25;
  const twoYearYield = fred.yieldCurve.find(y => y.series === 'DGS2')?.value ?? 4.50;
  const fiveYearYield = fred.yieldCurve.find(y => y.series === 'DGS5')?.value ?? 4.30;
  const thirtyYearYield = fred.yieldCurve.find(y => y.series === 'DGS30')?.value ?? 4.40;
  const spread2s10s = fred.spread2s10s;
  const fedFundsRate = fred.fedFundsRate;

  // DXY
  const dxyPrice = dxyQ?.regularMarketPrice ?? 103;

  // ─── Calculate scores from real data ───────────────────────────────────

  const volatilityScore = calcVolatilityScore(vixLevel, vixPercentile, vixTrend);

  const qqqChange = ndx?.regularMarketChangePercent ?? 0;
  const trendScore = calcTrendScore(spxMa, qqqChange);

  const { score: breadthScore, pctPositive } = calcBreadthScore(sectors);

  const momentumScore = calcMomentumScore(sectors);

  const macroScore = calcMacroScore(
    tenYearYield,
    spread2s10s,
    fearGreed?.value ?? null,
    dxyPrice
  );

  // Oil score
  const oilPrice = oil?.regularMarketPrice ?? null;
  const oilChangePct = oil?.regularMarketChangePercent ?? null;
  const oilScore = calcOilScore(oilPrice, oilChangePct);

  // Crypto score
  const btcPrice = btc?.regularMarketPrice ?? null;
  const btcChangePct = btc?.regularMarketChangePercent ?? null;
  const btcDominance = coinGecko.available ? coinGecko.btcDominance : null;
  const cryptoScore = calcCryptoScore(btcPrice, btcChangePct, btcDominance);

  // Composite score (weighted — includes oil & crypto)
  const compositeScore = Math.round(
    volatilityScore * 0.15 +
    trendScore * 0.20 +
    breadthScore * 0.16 +
    momentumScore * 0.16 +
    macroScore * 0.13 +
    oilScore * 0.10 +
    cryptoScore * 0.10
  );

  // Execution window derived from trend + momentum
  const execScore = Math.round((trendScore * 0.4 + momentumScore * 0.3 + breadthScore * 0.3));
  const breakoutsWorking = trendScore > 65;
  const leadersHolding = sectors[0]?.change > 0.5;
  const pullbacksBought = spxMa ? spxMa.price > spxMa.ma20 : true;
  const followThrough = momentumScore > 70 ? 'Strong' : momentumScore > 50 ? 'Moderate' : 'Weak';

  // Decision
  const shouldTrade = compositeScore >= 60;
  const label = compositeScore >= 75 ? 'Strong' : compositeScore >= 60 ? 'Trade' : compositeScore >= 45 ? 'Caution' : 'Avoid';

  // FOMC
  const fomc = getNextFomc();

  // Yield curve signal
  let yieldCurveSignal = 'normal';
  if (spread2s10s != null && spread2s10s < 0) yieldCurveSignal = 'inverted';
  else if (spread2s10s != null && spread2s10s < 0.2) yieldCurveSignal = 'flat';

  // SPX vs MAs for display
  const spxVs20d = spxMa ? Math.round(((spxMa.price - spxMa.ma20) / spxMa.ma20) * 10000) / 100 : 0;
  const spxVs50d = spxMa ? Math.round(((spxMa.price - spxMa.ma50) / spxMa.ma50) * 10000) / 100 : 0;
  const spxVs200d = spxMa ? Math.round(((spxMa.price - spxMa.ma200) / spxMa.ma200) * 10000) / 100 : 0;

  // Leader & laggard
  const leader = sectors[0] ?? { name: 'N/A', change: 0 };
  const laggard = sectors[sectors.length - 1] ?? { name: 'N/A', change: 0 };
  const sectorsPositive = sectors.filter(s => s.change > 0).length;

  // Put/call ratio estimate from VIX relationship
  const putCallRatio = Math.round((0.7 + (vixLevel - 15) * 0.03) * 100) / 100;
  const putCallSignal = putCallRatio < 0.8 ? 'low' : putCallRatio > 1.1 ? 'elevated' : 'normal';

  return {
    ticker: [
      { symbol: 'SPX', price: Math.round((spx?.regularMarketPrice ?? 0) * 100) / 100, change: Math.round((spx?.regularMarketChange ?? 0) * 100) / 100, changePercent: (spx?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: 'NDX', price: Math.round((ndx?.regularMarketPrice ?? 0) * 100) / 100, change: Math.round((ndx?.regularMarketChange ?? 0) * 100) / 100, changePercent: (ndx?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: 'VIX', price: Math.round(vixLevel * 100) / 100, change: Math.round((vix?.regularMarketChange ?? 0) * 100) / 100, changePercent: (vix?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: 'DXY', price: Math.round(dxyPrice * 100) / 100, change: Math.round((dxyQ?.regularMarketChange ?? 0) * 100) / 100, changePercent: (dxyQ?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: '10Y', price: Math.round(tenYearYield * 100) / 100, change: Math.round((tnx?.regularMarketChange ?? 0) * 100) / 100, changePercent: (tnx?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: 'GLD', price: Math.round((gld?.regularMarketPrice ?? 0) * 100) / 100, change: Math.round((gld?.regularMarketChange ?? 0) * 100) / 100, changePercent: (gld?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: 'OIL', price: Math.round((oil?.regularMarketPrice ?? 0) * 100) / 100, change: Math.round((oil?.regularMarketChange ?? 0) * 100) / 100, changePercent: (oil?.regularMarketChangePercent ?? 0) / 100 },
      { symbol: 'BTC', price: Math.round((btc?.regularMarketPrice ?? 0) * 100) / 100, change: Math.round((btc?.regularMarketChange ?? 0) * 100) / 100, changePercent: (btc?.regularMarketChangePercent ?? 0) / 100 },
    ],
    decision: { shouldTrade, score: compositeScore, label },
    volatility: {
      score: volatilityScore,
      vixLevel: Math.round(vixLevel * 100) / 100,
      vixTrend,
      vixTrendSignal: vixTrend === 'Falling' ? 'positive' : vixTrend === 'Rising' ? 'negative' : 'neutral',
      vixIvPercentile: vixPercentile,
      vixIvSignal: vixPercentile > 75 ? 'elevated' : vixPercentile > 50 ? 'normal' : 'low',
      putCallRatio,
      putCallSignal,
    },
    trend: {
      score: trendScore,
      spxVs20d: { value: spxVs20d, signal: getSignal(spxVs20d) },
      spxVs50d: { value: spxVs50d, signal: getSignal(spxVs50d) },
      spxVs200d: { value: spxVs200d, signal: getSignal(spxVs200d) },
      qqqTrend: qqqChange > 0.5 ? 'uptrend' : qqqChange < -0.5 ? 'downtrend' : 'sideways',
      regime: getRegime(spxMa),
    },
    breadth: {
      score: breadthScore,
      pctAbove50d: pctPositive,
      pctAbove50dSignal: pctPositive >= 70 ? 'strong' : pctPositive >= 50 ? 'moderate' : 'weak',
      pctAbove200d: Math.round(pctPositive * 0.9), // approximate
      pctAbove200dSignal: pctPositive >= 65 ? 'strong' : pctPositive >= 45 ? 'moderate' : 'weak',
      nyseAd: Math.round((sectorsPositive / SECTOR_ETFS.length - 0.5) * 200) / 100,
      nyseAdSignal: sectorsPositive >= 7 ? 'positive' : sectorsPositive >= 5 ? 'neutral' : 'negative',
      newHighsLows: `${sectorsPositive}/${SECTOR_ETFS.length - sectorsPositive}`,
      newHighsLowsSignal: sectorsPositive >= 8 ? 'good' : sectorsPositive >= 5 ? 'mixed' : 'poor',
    },
    momentum: {
      score: momentumScore,
      sectorsPositive,
      sectorsTotal: SECTOR_ETFS.length,
      sectorsSignal: sectorsPositive >= 9 ? 'strong' : sectorsPositive >= 7 ? 'moderate' : sectorsPositive >= 5 ? 'mixed' : 'weak',
      leader: { name: leader.name, change: leader.change },
      laggard: { name: laggard.name, change: laggard.change },
      participation: sectorsPositive >= 9 ? 'broad' : sectorsPositive >= 6 ? 'moderate' : 'narrow',
    },
    macro: {
      score: macroScore,
      fomc: fomc.label,
      fomcSignal: fomc.signal,
      tenYearYield: Math.round(tenYearYield * 100) / 100,
      tenYearSignal: tenYearYield > 4.8 ? 'elevated' : tenYearYield < 3.5 ? 'low' : 'stable',
      dxy: Math.round(dxyPrice * 100) / 100,
      dxySignal: dxyPrice > 107 ? 'strengthening' : dxyPrice < 100 ? 'weakening' : 'stable',
      fedStance: fedFundsRate ? `Hold ${fedFundsRate.toFixed(2)}%` : 'Data pending',
      geopolitical: 'Monitor global tensions',
      yieldCurve: {
        twoYear: twoYearYield,
        fiveYear: fiveYearYield,
        tenYear: tenYearYield,
        thirtyYear: thirtyYearYield,
        spread2s10s,
        signal: yieldCurveSignal,
      },
      breakeven5y: fred.breakeven5y,
      breakeven10y: fred.breakeven10y,
      initialClaims: fred.initialClaims,
      fedFundsRate,
    },
    executionWindow: {
      score: execScore,
      breakoutsWorking: { answer: breakoutsWorking ? 'Yes' : 'No', signal: breakoutsWorking ? 'working' : 'failing' },
      leadersHolding: { answer: leadersHolding ? 'Yes' : 'No', signal: leadersHolding ? 'holding' : 'fading' },
      pullbacksBought: { answer: pullbacksBought ? 'Yes' : 'No', signal: pullbacksBought ? 'support' : 'breakdown' },
      followThrough: { answer: followThrough, signal: followThrough === 'Strong' ? 'conviction' : followThrough === 'Moderate' ? 'neutral' : 'exhaustion' },
    },
    oil: {
      score: oilScore,
      price: oilPrice != null ? Math.round(oilPrice * 100) / 100 : null,
      change: oilChangePct != null ? Math.round(oilChangePct * 100) / 100 : null,
      priceSignal: oilPrice == null ? 'unknown' : oilPrice > 90 ? 'elevated' : oilPrice > 70 ? 'normal' : oilPrice > 50 ? 'low' : 'crash',
      inflationImpact: oilPrice == null ? 'unknown' : oilPrice > 90 ? 'high' : oilPrice > 70 ? 'moderate' : 'low',
      trendSignal: oilChangePct == null ? 'unknown' : oilChangePct > 2 ? 'spiking' : oilChangePct > 0 ? 'rising' : oilChangePct > -2 ? 'falling' : 'crashing',
    },
    crypto: {
      score: cryptoScore,
      btcPrice: btcPrice != null ? Math.round(btcPrice * 100) / 100 : null,
      btcChange: btcChangePct != null ? Math.round(btcChangePct * 100) / 100 : null,
      btcDominance: btcDominance != null ? Math.round(btcDominance * 10) / 10 : null,
      sentiment: btcChangePct == null ? 'unknown' : btcChangePct > 3 ? 'risk-on' : btcChangePct > 0 ? 'neutral' : btcChangePct > -3 ? 'cautious' : 'risk-off',
      dominanceSignal: btcDominance == null ? 'unknown' : btcDominance > 60 ? 'flight-to-quality' : btcDominance > 50 ? 'normal' : 'alt-season',
    },
    sectors: sectors.slice(0, 5),
    scoringWeights: {
      volatility: { weight: Math.round(volatilityScore * 0.15), label: `+${Math.round(volatilityScore * 0.15)}` },
      trend: { weight: Math.round(trendScore * 0.20), label: `+${Math.round(trendScore * 0.20)}` },
      breadth: { weight: Math.round(breadthScore * 0.16), label: `+${Math.round(breadthScore * 0.16)}` },
      momentum: { weight: Math.round(momentumScore * 0.16), label: `+${Math.round(momentumScore * 0.16)}` },
      macro: { weight: Math.round(macroScore * 0.13), label: `+${Math.round(macroScore * 0.13)}` },
      oil: { weight: Math.round(oilScore * 0.10), label: `+${Math.round(oilScore * 0.10)}` },
      crypto: { weight: Math.round(cryptoScore * 0.10), label: `+${Math.round(cryptoScore * 0.10)}` },
    },
    fearGreed: fearGreed ? {
      value: fearGreed.value,
      label: fearGreed.label,
      previousClose: fearGreed.previousClose,
      oneWeekAgo: fearGreed.oneWeekAgo,
      oneMonthAgo: fearGreed.oneMonthAgo,
    } : null,
    cryptoGlobal: coinGecko.available ? {
      btcDominance: coinGecko.btcDominance,
      totalMarketCap: coinGecko.globalMarketCap,
      topMover: coinGecko.topCoins.length > 0
        ? coinGecko.topCoins.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))[0]
        : null,
      trending: coinGecko.trending.slice(0, 3),
    } : null,
    dataSources: {
      fred: fred.available,
      fearGreed: !!fearGreed,
      coinGecko: coinGecko.available,
      yahoo: indexQuotes.length > 0,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    if (terminalCache && Date.now() - terminalCache.ts < TERMINAL_TTL) {
      return NextResponse.json(terminalCache.data);
    }

    const data = await buildTerminalData();
    terminalCache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Terminal] Error:', err);
    // Return cached data if available
    if (terminalCache) {
      return NextResponse.json({ ...terminalCache.data, stale: true });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
