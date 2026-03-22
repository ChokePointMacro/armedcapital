import { NextRequest, NextResponse } from 'next/server';
import { fetchFredData, fetchFearGreedIndex, fetchCoinGeckoData, type FredData, type FearGreedData, type CoinGeckoData } from '@/lib/enrichedData';

const TERMINAL_TTL = 5 * 60 * 1000; // 5 minutes

let terminalCache: { data: any; ts: number } | null = null;

// Build terminal data — now enriched with FRED yield curve + Fear & Greed
async function buildTerminalData() {
  // Fetch enrichment data in parallel
  const [fred, fearGreed, coinGecko] = await Promise.all([
    fetchFredData(),
    fetchFearGreedIndex(),
    fetchCoinGeckoData(),
  ]);

  // Use real FRED yields if available, otherwise fallback
  const tenYearYield = fred.yieldCurve.find(y => y.series === 'DGS10')?.value ?? 4.25;
  const twoYearYield = fred.yieldCurve.find(y => y.series === 'DGS2')?.value ?? 4.50;
  const fiveYearYield = fred.yieldCurve.find(y => y.series === 'DGS5')?.value ?? 4.30;
  const thirtyYearYield = fred.yieldCurve.find(y => y.series === 'DGS30')?.value ?? 4.40;
  const spread2s10s = fred.spread2s10s;
  const fedFundsRate = fred.fedFundsRate;

  // Determine macro signal from yield curve
  let yieldCurveSignal = 'normal';
  if (spread2s10s != null && spread2s10s < 0) yieldCurveSignal = 'inverted';
  else if (spread2s10s != null && spread2s10s < 0.2) yieldCurveSignal = 'flat';

  return {
    ticker: [
      { symbol: 'SPX', price: 5000, change: 15.2, changePercent: 0.00304 },
      { symbol: 'NDX', price: 18000, change: 45.6, changePercent: 0.00253 },
      { symbol: 'VIX', price: 18.5, change: -0.5, changePercent: -0.0263 },
      { symbol: 'DXY', price: 103.2, change: 0.3, changePercent: 0.00291 },
      { symbol: '10Y', price: tenYearYield, change: 0.02, changePercent: 0.00472 },
      { symbol: 'GLD', price: 190.5, change: 1.2, changePercent: 0.00631 },
    ],
    decision: { shouldTrade: true, score: 72, label: 'Trade' },
    volatility: {
      score: 75,
      vixLevel: 18.5,
      vixTrend: 'Falling',
      vixTrendSignal: 'positive',
      vixIvPercentile: 55,
      vixIvSignal: 'normal',
      putCallRatio: 0.85,
      putCallSignal: 'low',
    },
    trend: {
      score: 78,
      spxVs20d: { value: 1.25, signal: 'intact' },
      spxVs50d: { value: 3.15, signal: 'intact' },
      spxVs200d: { value: 8.5, signal: 'strong' },
      qqqTrend: 'uptrend',
      regime: 'uptrend',
    },
    breadth: {
      score: 82,
      pctAbove50d: 82,
      pctAbove50dSignal: 'strong',
      pctAbove200d: 73,
      pctAbove200dSignal: 'strong',
      nyseAd: 0.45,
      nyseAdSignal: 'positive',
      newHighsLows: '8/3',
      newHighsLowsSignal: 'good',
    },
    momentum: {
      score: 73,
      sectorsPositive: 9,
      sectorsTotal: 11,
      sectorsSignal: 'strong',
      leader: { name: 'Technology', change: 2.15 },
      laggard: { name: 'Utilities', change: -0.85 },
      participation: 'broad',
    },
    macro: {
      score: 68,
      fomc: 'In 8 days',
      fomcSignal: 'caution',
      tenYearYield,
      tenYearSignal: 'stable',
      dxy: 103.2,
      dxySignal: 'stable',
      fedStance: fedFundsRate ? `Hold ${fedFundsRate.toFixed(2)}%` : 'Hold 4.25-4.50%',
      geopolitical: 'Monitor global tensions',
      // NEW enrichment data
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
      score: 75,
      breakoutsWorking: { answer: 'Yes', signal: 'working' },
      leadersHolding: { answer: 'Yes', signal: 'holding' },
      pullbacksBought: { answer: 'Yes', signal: 'support' },
      followThrough: { answer: 'Strong', signal: 'conviction' },
    },
    sectors: [
      { name: 'Technology', symbol: 'XLK', change: 2.15 },
      { name: 'Financials', symbol: 'XLF', change: 1.85 },
      { name: 'Healthcare', symbol: 'XLV', change: 1.2 },
    ],
    scoringWeights: {
      volatility: { weight: 19, label: '+19' },
      momentum: { weight: 15, label: '+15' },
      trend: { weight: 16, label: '+16' },
      breadth: { weight: 14, label: '+14' },
      macro: { weight: 8, label: '+8' },
    },
    // NEW: Enrichment data exposed to frontend
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
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
