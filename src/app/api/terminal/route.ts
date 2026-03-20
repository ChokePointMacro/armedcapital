import { NextRequest, NextResponse } from 'next/server';

const TERMINAL_TTL = 5 * 60 * 1000; // 5 minutes

let terminalCache: { data: any; ts: number } | null = null;

// Simplified terminal data builder
async function buildTerminalData() {
  // In production, this would fetch real market data from Yahoo Finance
  // For now, returning a mock structure that matches the expected format
  return {
    ticker: [
      { symbol: 'SPX', price: 5000, change: 15.2, changePercent: 0.00304 },
      { symbol: 'NDX', price: 18000, change: 45.6, changePercent: 0.00253 },
      { symbol: 'VIX', price: 18.5, change: -0.5, changePercent: -0.0263 },
      { symbol: 'DXY', price: 103.2, change: 0.3, changePercent: 0.00291 },
      { symbol: '10Y', price: 4.25, change: 0.02, changePercent: 0.00472 },
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
      tenYearYield: 4.25,
      tenYearSignal: 'stable',
      dxy: 103.2,
      dxySignal: 'stable',
      fedStance: 'Hold 4.25-4.50%',
      geopolitical: 'Monitor global tensions',
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
