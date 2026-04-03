/**
 * Market Tide — Options flow sentiment and sector analysis
 * GET /api/market-tide
 *
 * Fetches options snapshot data from Polygon.io for major market indices and stocks,
 * calculates net premium, sentiment, and sector aggregations.
 * Includes fallback synthetic data when API key is missing.
 */

import { NextResponse } from 'next/server';
import { cached, TTL_QUOTES } from '@/lib/cache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OptionsSnapshot {
  status: string;
  results?: Array<{
    contract_type: 'call' | 'put';
    option_symbol: string;
    last_quote?: {
      bid: number;
      ask: number;
      bid_size: number;
      ask_size: number;
      last_updated: number;
    };
    last_trade?: {
      price: number;
      size: number;
      sip_timestamp: number;
      exchange: number;
    };
  }>;
}

interface TickerData {
  symbol: string;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  callVolume: number;
  putVolume: number;
  totalVolume: number;
  callPct: number;
  putPct: number;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sector: string | null;
}

interface SectorData {
  sector: string;
  etf: string;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  sentimentScore: number;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
}

interface MarketTideResponse {
  source: 'polygon' | 'fallback';
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sentimentStrength: string;
  netPremium: number;
  callPct: number;
  putPct: number;
  totalCallPremium: number;
  totalPutPremium: number;
  vix: number | null;
  totalOptionsVolume: number;
  sectors: SectorData[];
  topTickers: Array<{
    symbol: string;
    callPremium: number;
    putPremium: number;
    netPremium: number;
    totalVolume: number;
    sentiment: 'Bullish' | 'Bearish' | 'Neutral';
    sector: string | null;
  }>;
  indexStrip: Array<{
    symbol: string;
    price: number | null;
    change: number | null;
    sentiment: string;
  }>;
  lastUpdated: string;
}

// ─── Ticker → Sector Mapping ──────────────────────────────────────────────────

const TICKER_SECTORS: Record<string, string> = {
  XLK: 'Technology',
  XLF: 'Finance',
  XLE: 'Energy',
  XLV: 'Healthcare',
  XLI: 'Industrial',
  XLY: 'Cons. Discretionary',
  XLP: 'Cons. Staples',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
  XLC: 'Comm. Services',
  XLB: 'Materials',
  SPY: null, // Broad market
  QQQ: null, // Nasdaq
  IWM: null, // Russell 2000
  DIA: null, // Dow Jones
  AAPL: 'Technology',
  MSFT: 'Technology',
  NVDA: 'Technology',
  AMD: 'Technology',
  META: 'Comm. Services',
  AMZN: 'Cons. Discretionary',
  TSLA: 'Cons. Discretionary',
  MSTR: 'Technology',
  GOOGL: 'Comm. Services',
  NFLX: 'Comm. Services',
};

// ─── Fetch Options Data ───────────────────────────────────────────────────────

async function fetchPolygonOptionsSnapshot(ticker: string): Promise<TickerData> {
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey) {
    return generateFallbackTickerData(ticker);
  }

  try {
    const url = `https://api.polygon.io/v3/snapshot/options/${ticker}?apiKey=${apiKey}&limit=250`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'armed-capital/1.0' },
    });

    if (!response.ok) {
      console.error(`[MarketTide] Polygon API error for ${ticker}: ${response.status}`);
      return generateFallbackTickerData(ticker);
    }

    const data = (await response.json()) as OptionsSnapshot;

    if (!data.results || data.results.length === 0) {
      return generateFallbackTickerData(ticker);
    }

    let callPremium = 0;
    let putPremium = 0;
    let callVolume = 0;
    let putVolume = 0;

    for (const option of data.results) {
      const lastTrade = option.last_trade;
      const lastQuote = option.last_quote;

      // Use last trade price or mid-quote
      let price = 0;
      if (lastTrade?.price) {
        price = lastTrade.price;
      } else if (lastQuote?.bid && lastQuote?.ask) {
        price = (lastQuote.bid + lastQuote.ask) / 2;
      }

      // Use size from last trade or bid_size from quote
      let size = 0;
      if (lastTrade?.size) {
        size = lastTrade.size;
      } else if (lastQuote?.bid_size) {
        size = lastQuote.bid_size;
      }

      const premium = price * size * 100; // Options are per 100 shares

      if (option.contract_type === 'call') {
        callPremium += premium;
        callVolume += size;
      } else {
        putPremium += premium;
        putVolume += size;
      }
    }

    const totalVolume = callVolume + putVolume;
    const netPremium = callPremium - putPremium;

    return {
      symbol: ticker,
      callPremium,
      putPremium,
      netPremium,
      callVolume,
      putVolume,
      totalVolume,
      callPct: totalVolume > 0 ? (callVolume / totalVolume) * 100 : 0,
      putPct: totalVolume > 0 ? (putVolume / totalVolume) * 100 : 0,
      sentiment: netPremium > 0 ? 'Bullish' : netPremium < 0 ? 'Bearish' : 'Neutral',
      sector: TICKER_SECTORS[ticker] || null,
    };
  } catch (err) {
    console.error(`[MarketTide] Error fetching ${ticker}:`, err instanceof Error ? err.message : err);
    return generateFallbackTickerData(ticker);
  }
}

// ─── Fallback Data Generator ──────────────────────────────────────────────────

function generateFallbackTickerData(ticker: string): TickerData {
  // Pseudo-random but deterministic based on ticker
  const seed = ticker.charCodeAt(0) + ticker.charCodeAt(ticker.length - 1);
  const rand = ((seed * 9301 + 49297) % 233280) / 233280;

  const totalVolume = Math.floor(50000 + rand * 200000);
  const callPct = 45 + rand * 20; // 45-65% calls
  const putPct = 100 - callPct;
  const callVolume = Math.floor((callPct / 100) * totalVolume);
  const putVolume = totalVolume - callVolume;

  const callPremium = callVolume * (500000 + rand * 2000000);
  const putPremium = putVolume * (500000 + rand * 2000000);
  const netPremium = callPremium - putPremium;

  return {
    symbol: ticker,
    callPremium,
    putPremium,
    netPremium,
    callVolume,
    putVolume,
    totalVolume,
    callPct,
    putPct,
    sentiment: netPremium > 0 ? 'Bullish' : netPremium < 0 ? 'Bearish' : 'Neutral',
    sector: TICKER_SECTORS[ticker] || null,
  };
}

// ─── VIX Fetch ────────────────────────────────────────────────────────────────

async function fetchVIX(): Promise<number | null> {
  try {
    const url = 'https://query2.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'armed-capital/1.0' },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const quote = data.chart?.result?.[0]?.meta;
    return quote?.regularMarketPrice || null;
  } catch (err) {
    console.warn('[MarketTide] VIX fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const TICKERS = [
      'SPY', 'QQQ', 'IWM', 'DIA', // Broad market
      'AAPL', 'MSFT', 'NVDA', 'AMD', 'META', 'AMZN', 'TSLA', 'MSTR', 'GOOGL', 'NFLX', // Mega-cap tech
      'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLRE', 'XLC', 'XLB', // Sector ETFs
    ];

    // Fetch all tickers and VIX in parallel with caching
    const [tickerDataArray, vixPrice] = await Promise.all([
      Promise.all(
        TICKERS.map(ticker => cached(`market-tide:${ticker}`, TTL_QUOTES, () => fetchPolygonOptionsSnapshot(ticker))),
      ),
      cached('market-tide:vix', TTL_QUOTES, () => fetchVIX()),
    ]);

    // Aggregate data
    let totalCallPremium = 0;
    let totalPutPremium = 0;
    let totalVolume = 0;

    const sectorMap: Record<string, SectorData> = {};
    const tickerMap: Record<string, TickerData> = {};

    for (const td of tickerDataArray) {
      tickerMap[td.symbol] = td;
      totalCallPremium += td.callPremium;
      totalPutPremium += td.putPremium;
      totalVolume += td.totalVolume;

      // Aggregate by sector
      if (td.sector) {
        if (!sectorMap[td.sector]) {
          sectorMap[td.sector] = {
            sector: td.sector,
            etf: Object.entries(TICKER_SECTORS).find(([, s]) => s === td.sector)?.[0] || td.sector,
            callPremium: 0,
            putPremium: 0,
            netPremium: 0,
            sentimentScore: 0,
            sentiment: 'Neutral',
          };
        }
        sectorMap[td.sector].callPremium += td.callPremium;
        sectorMap[td.sector].putPremium += td.putPremium;
        sectorMap[td.sector].netPremium += td.netPremium;
      }
    }

    // Calculate sector sentiment scores (-1 to 1)
    const sectors: SectorData[] = Object.values(sectorMap).map(sector => {
      const totalSectorPremium = sector.callPremium + sector.putPremium;
      const sentimentScore =
        totalSectorPremium > 0 ? sector.netPremium / totalSectorPremium : 0;
      return {
        ...sector,
        sentimentScore,
        sentiment: sentimentScore > 0.05 ? 'Bullish' : sentimentScore < -0.05 ? 'Bearish' : 'Neutral',
      };
    });

    // Calculate net premium and overall sentiment
    const netPremium = totalCallPremium - totalPutPremium;
    const overallSentiment: 'Bullish' | 'Bearish' | 'Neutral' =
      netPremium > 0 ? 'Bullish' : netPremium < 0 ? 'Bearish' : 'Neutral';

    const totalPremium = totalCallPremium + totalPutPremium;
    const sentimentStrengthRaw = totalPremium > 0 ? Math.abs(netPremium / totalPremium) : 0;
    const sentimentStrength = `${Math.round(sentimentStrengthRaw * 100)}%`;

    // Top 10 tickers by net premium
    const topTickers = Object.values(tickerMap)
      .sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium))
      .slice(0, 10)
      .map(td => ({
        symbol: td.symbol,
        callPremium: td.callPremium,
        putPremium: td.putPremium,
        netPremium: td.netPremium,
        totalVolume: td.totalVolume,
        sentiment: td.sentiment,
        sector: td.sector,
      }));

    // Index strip (SPY, QQQ, IWM, DIA) — no real price data here, just sentiment
    const indexStrip = ['SPY', 'QQQ', 'IWM', 'DIA'].map(sym => ({
      symbol: sym,
      price: null, // Would need separate stock price fetch
      change: null,
      sentiment: tickerMap[sym]?.sentiment || 'Neutral',
    }));

    const response: MarketTideResponse = {
      source: process.env.POLYGON_API_KEY ? 'polygon' : 'fallback',
      sentiment: overallSentiment,
      sentimentStrength,
      netPremium: totalPremium > 0 ? netPremium / 1_000_000 : 0, // In millions
      callPct: totalVolume > 0 ? (totalCallPremium / totalPremium) * 100 : 0,
      putPct: totalVolume > 0 ? (totalPutPremium / totalPremium) * 100 : 0,
      totalCallPremium: totalCallPremium / 1_000_000,
      totalPutPremium: totalPutPremium / 1_000_000,
      vix: vixPrice,
      totalOptionsVolume: totalVolume,
      sectors: sectors.sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium)),
      topTickers,
      indexStrip,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[MarketTide] Unhandled error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to fetch market tide data' },
      { status: 500 },
    );
  }
}
