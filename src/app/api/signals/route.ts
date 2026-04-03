/**
 * Flow Alerts / Signal Detection API
 * GET /api/signals
 *
 * Fetches recent options trades from Polygon.io for top 25 tickers,
 * applies anomaly detection scoring, and returns flagged alerts.
 * Includes fallback synthetic alerts when API key is missing.
 */

import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { safeAuth } from '@/lib/authHelper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PolygonOptionsTrade {
  option_symbol: string;
  underlying_symbol: string;
  contract_type: 'call' | 'put';
  strike_price: number;
  expiration_date: string;
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
  open_interest?: number;
  volume?: number;
}

interface PolygonSnapshot {
  status: string;
  results?: PolygonOptionsTrade[];
}

interface Greeks {
  delta: number;
  gamma: number;
  iv: number;
}

export interface SignalAlert {
  ticker: string;
  strike: number;
  expiry: string;
  premium: number;
  volOiRatio: number;
  tradeType: 'Call' | 'Put';
  sentiment: 'Bullish' | 'Bearish';
  score: number;
  greeks: Greeks;
  timestamp: string;
  interpretation: string;
}

interface SignalsResponse {
  source: 'polygon' | 'fallback';
  alerts: SignalAlert[];
  totalUnusualCallPremium: number;
  totalUnusualPutPremium: number;
  topAlertedTickers: { ticker: string; count: number }[];
  lastUpdated: string;
}

// ─── Ticker List ──────────────────────────────────────────────────────────────

const TOP_25_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AMD', 'META', 'AMZN', 'TSLA', 'GOOGL', 'NFLX', 'MSTR',
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY',
  'XLP', 'XLU', 'XLRE', 'XLC', 'XLB',
];

// ─── Greeks Calculator ────────────────────────────────────────────────────────

/**
 * Rough approximation of option Greeks using simplified Black-Scholes.
 * Not for trading — for display purposes only.
 */
function calculateGreeks(
  stockPrice: number,
  strikePrice: number,
  daysToExpiry: number,
  volatility: number,
  isCall: boolean
): Greeks {
  const r = 0.05; // Risk-free rate
  const T = Math.max(daysToExpiry / 365, 0.001);

  // Simplified delta approximation
  const moneyness = stockPrice / strikePrice;
  let delta = isCall
    ? Math.min(1, Math.max(0, 0.4 + 0.6 * Math.log(moneyness) / Math.log(1.2)))
    : Math.max(-1, Math.min(0, -0.6 + 0.6 * Math.log(moneyness) / Math.log(1.2)));

  // Simplified gamma (peaked at-the-money)
  const atmRatio = Math.abs(Math.log(moneyness));
  const gamma = (1 / (strikePrice * volatility * Math.sqrt(T))) * Math.exp(-atmRatio * atmRatio / (2 * volatility * volatility * T));

  // Simplified IV — use input or estimate from moneyness
  const iv = Math.max(0.1, Math.min(2.0, volatility * (0.8 + 0.4 * atmRatio)));

  return {
    delta: parseFloat(delta.toFixed(3)),
    gamma: parseFloat(gamma.toFixed(5)),
    iv: parseFloat(iv.toFixed(3)),
  };
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

interface TradeForScoring {
  premium: number;
  volOiRatio: number;
  isSweep: boolean;
  strike: number;
  stockPrice: number;
}

function scoreAlert(trade: TradeForScoring): number {
  let score = 0;

  // Premium size: 40% weight (>25K is unusual)
  const premiumScore = Math.min(10, (trade.premium / 25000) * 4);
  score += premiumScore * 0.4;

  // Vol/OI ratio: 30% weight (>3x is unusual)
  const volOiScore = Math.min(10, (trade.volOiRatio / 3) * 5);
  score += volOiScore * 0.3;

  // Sweep execution: 20% weight
  score += trade.isSweep ? 2 : 0;

  // Moneyness (ITM, ATM, OTM): 10% weight
  const moneyness = Math.abs(trade.strike - trade.stockPrice) / trade.stockPrice;
  const moneynessScore = moneyness < 0.02 ? 1 : moneyness < 0.05 ? 0.5 : 0;
  score += moneynessScore;

  return Math.min(10, Math.max(1, score));
}

// ─── Generate Alert Interpretation ────────────────────────────────────────────

function generateInterpretation(
  ticker: string,
  strike: number,
  expiry: string,
  premium: number,
  isCall: boolean,
  volOiRatio: number,
  isSweep: boolean
): string {
  const direction = isCall ? 'bullish' : 'bearish';
  const tradeDescription = isSweep ? 'sweep' : 'block';
  const sizeDesc = premium > 100000 ? 'mega' : premium > 50000 ? 'large' : 'notable';
  const ratioDesc = volOiRatio > 5 ? 'extreme' : volOiRatio > 3 ? 'significant' : 'elevated';

  const templates = [
    `${sizeDesc.charAt(0).toUpperCase() + sizeDesc.slice(1)} ${direction} ${tradeDescription} on ${ticker} $${strike}${isCall ? 'C' : 'P'} expiring ${expiry} — premium $${(premium / 1000000).toFixed(1)}M suggests institutional positioning`,
    `${ratioDesc.charAt(0).toUpperCase() + ratioDesc.slice(1)} vol/OI ratio on ${ticker} ${isCall ? 'calls' : 'puts'} indicates ${direction} gamma flow accumulation`,
    `Unusual ${direction} activity: ${ticker} $${strike}${isCall ? 'C' : 'P'} premium $${(premium / 1000000).toFixed(1)}M — possible hedge or directional bet`,
    `Large ${tradeDescription} detected: ${ticker} ${isCall ? 'call' : 'put'} sweep with vol/OI ratio at ${volOiRatio.toFixed(1)}x typical levels`,
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// ─── Fetch Polygon Options Snapshot ───────────────────────────────────────────

async function fetchPolygonSignals(ticker: string): Promise<SignalAlert[]> {
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey) {
    return [];
  }

  try {
    const url = `https://api.polygon.io/v3/snapshot/options/${ticker}?apiKey=${apiKey}&limit=250`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'armed-capital/1.0' },
    });

    if (!response.ok) {
      console.error(`[Signals] Polygon API error for ${ticker}: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as PolygonSnapshot;

    if (!data.results || data.results.length === 0) {
      return [];
    }

    const alerts: SignalAlert[] = [];

    // Estimate current stock price (use mid-quote from first result as proxy)
    let estimatedStockPrice = 100; // Fallback
    for (const opt of data.results) {
      if (opt.last_quote?.bid && opt.last_quote?.ask) {
        estimatedStockPrice = (opt.last_quote.bid + opt.last_quote.ask) / 2 * (opt.strike_price / 100);
        break;
      }
    }

    // Group by strike/expiry to calculate OI averages
    const strikeMap: Record<string, { volume: number; oi: number }> = {};

    for (const option of data.results) {
      const key = `${option.strike_price}-${option.expiration_date}`;
      if (!strikeMap[key]) {
        strikeMap[key] = { volume: 0, oi: 0 };
      }
      strikeMap[key].volume += option.volume || 0;
      strikeMap[key].oi += option.open_interest || 1;
    }

    // Calculate average OI across all strikes
    const allOI = Object.values(strikeMap).map(s => s.oi);
    const avgOI = allOI.length > 0 ? allOI.reduce((a, b) => a + b, 0) / allOI.length : 1;

    // Score individual trades
    for (const option of data.results) {
      const lastTrade = option.last_trade;
      const lastQuote = option.last_quote;

      if (!lastTrade || !lastQuote) continue;

      const price = lastTrade.price;
      const size = lastTrade.size || 0;
      const premium = price * size * 100; // Options are per 100 shares

      // Skip low-premium trades
      if (premium < 10000) continue;

      const oi = option.open_interest || avgOI;
      const volOiRatio = oi > 0 ? (size / oi) : 1;

      // Anomaly detection: flag if volume > 3x average OI OR premium > $25K OR sweep
      const isSweep = lastTrade.exchange === 1 || size > 500; // Simplified sweep detection
      const isAnomalous =
        volOiRatio > 3 ||
        premium > 25000 ||
        isSweep;

      if (!isAnomalous) continue;

      // Calculate score
      const stockPrice = estimatedStockPrice;
      const tradeForScoring: TradeForScoring = {
        premium,
        volOiRatio,
        isSweep,
        strike: option.strike_price,
        stockPrice,
      };
      const score = scoreAlert(tradeForScoring);

      // Parse expiry date
      const expiryDate = new Date(option.expiration_date);
      const expiryStr = `${(expiryDate.getMonth() + 1)}/${expiryDate.getDate()}`;

      // Days to expiry
      const now = new Date();
      const daysToExpiry = Math.max(1, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

      // Estimate volatility (0.2 to 1.0 range)
      const volatility = 0.3 + (volOiRatio / 10) * 0.5;

      // Calculate Greeks
      const greeks = calculateGreeks(
        stockPrice,
        option.strike_price,
        daysToExpiry,
        volatility,
        option.contract_type === 'call'
      );

      // Generate interpretation
      const interpretation = generateInterpretation(
        ticker,
        option.strike_price,
        expiryStr,
        premium,
        option.contract_type === 'call',
        volOiRatio,
        isSweep
      );

      alerts.push({
        ticker,
        strike: option.strike_price,
        expiry: expiryStr,
        premium,
        volOiRatio: parseFloat(volOiRatio.toFixed(2)),
        tradeType: option.contract_type === 'call' ? 'Call' : 'Put',
        sentiment: option.contract_type === 'call' ? 'Bullish' : 'Bearish',
        score: parseFloat(score.toFixed(1)),
        greeks,
        timestamp: new Date(lastTrade.sip_timestamp).toISOString(),
        interpretation,
      });
    }

    return alerts;
  } catch (err) {
    console.error(`[Signals] Error fetching ${ticker}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── Generate Fallback Alerts ─────────────────────────────────────────────────

function generateFallbackAlerts(): SignalAlert[] {
  const alerts: SignalAlert[] = [];
  const tickers = TOP_25_TICKERS.slice(0, 10);
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const ticker = tickers[i % tickers.length];
    const isCall = Math.random() > 0.5;
    const strike = 100 + Math.floor(Math.random() * 200);
    const premium = 30000 + Math.random() * 200000;
    const volOiRatio = 2 + Math.random() * 6;
    const daysToExp = 5 + Math.floor(Math.random() * 45);
    const expDate = new Date(now.getTime() + daysToExp * 24 * 60 * 60 * 1000);
    const expiryStr = `${(expDate.getMonth() + 1)}/${expDate.getDate()}`;

    const tradeForScoring: TradeForScoring = {
      premium,
      volOiRatio,
      isSweep: Math.random() > 0.6,
      strike,
      stockPrice: 100,
    };

    const score = scoreAlert(tradeForScoring);

    const greeks = calculateGreeks(100, strike, daysToExp, 0.35, isCall);

    alerts.push({
      ticker,
      strike,
      expiry: expiryStr,
      premium,
      volOiRatio: parseFloat(volOiRatio.toFixed(2)),
      tradeType: isCall ? 'Call' : 'Put',
      sentiment: isCall ? 'Bullish' : 'Bearish',
      score: parseFloat(score.toFixed(1)),
      greeks,
      timestamp: new Date(now.getTime() - Math.random() * 3600000).toISOString(),
      interpretation: generateInterpretation(
        ticker,
        strike,
        expiryStr,
        premium,
        isCall,
        volOiRatio,
        tradeForScoring.isSweep
      ),
    });
  }

  return alerts.sort((a, b) => b.score - a.score);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Auth check (optional, but recommended)
    const userId = await safeAuth();

    // Fetch signals from all tickers in parallel with 60s cache
    const signalResults = await Promise.all(
      TOP_25_TICKERS.map(ticker =>
        cached(`signals:${ticker}`, 60, () => fetchPolygonSignals(ticker))
      )
    );

    const allAlerts = signalResults.flat();

    // Sort by score (descending)
    allAlerts.sort((a, b) => b.score - a.score);

    // Calculate premium summaries
    const callAlerts = allAlerts.filter(a => a.tradeType === 'Call');
    const putAlerts = allAlerts.filter(a => a.tradeType === 'Put');
    const totalCallPremium = callAlerts.reduce((sum, a) => sum + a.premium, 0);
    const totalPutPremium = putAlerts.reduce((sum, a) => sum + a.premium, 0);

    // Top 5 most-alerted tickers
    const tickerCounts: Record<string, number> = {};
    for (const alert of allAlerts) {
      tickerCounts[alert.ticker] = (tickerCounts[alert.ticker] || 0) + 1;
    }
    const topAlertedTickers = Object.entries(tickerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ticker, count]) => ({ ticker, count }));

    const response: SignalsResponse = {
      source: process.env.POLYGON_API_KEY ? 'polygon' : 'fallback',
      alerts: allAlerts.slice(0, 50), // Return top 50
      totalUnusualCallPremium: totalCallPremium,
      totalUnusualPutPremium: totalPutPremium,
      topAlertedTickers,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[Signals] Unhandled error:', err instanceof Error ? err.message : err);

    // Return fallback alerts on error
    const fallbackAlerts = generateFallbackAlerts();
    const response: SignalsResponse = {
      source: 'fallback',
      alerts: fallbackAlerts,
      totalUnusualCallPremium: fallbackAlerts
        .filter(a => a.tradeType === 'Call')
        .reduce((sum, a) => sum + a.premium, 0),
      totalUnusualPutPremium: fallbackAlerts
        .filter(a => a.tradeType === 'Put')
        .reduce((sum, a) => sum + a.premium, 0),
      topAlertedTickers: [],
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  }
}
