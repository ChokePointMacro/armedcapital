import { NextRequest, NextResponse } from 'next/server';
import {
  fetchQuotes,
  getAllQuotes,
  getConnectionStatus,
  DEFAULT_SYMBOLS,
  type TVQuote,
} from '@/lib/tradingviewWS';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tradingview/quotes
 *
 * Fetch real-time quotes from TradingView WebSocket.
 *
 * Query params:
 *   symbols  — comma-separated list of TV symbols (default: Armed Capital watchlist)
 *   status   — if "1", return connection status only
 *
 * Examples:
 *   /api/tradingview/quotes
 *   /api/tradingview/quotes?symbols=BITSTAMP:BTCUSD,NASDAQ:AAPL
 *   /api/tradingview/quotes?status=1
 */
export async function GET(request: NextRequest) {
  try {
    const { safeAuth } = await import('@/lib/authHelper');
    await safeAuth();

    const url = new URL(request.url);

    // Status check only
    if (url.searchParams.get('status') === '1') {
      return NextResponse.json({
        ...getConnectionStatus(),
        checkedAt: new Date().toISOString(),
      });
    }

    // Parse symbols
    const symbolsParam = url.searchParams.get('symbols');
    const symbols = symbolsParam
      ? symbolsParam.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_SYMBOLS;

    const waitMs = parseInt(url.searchParams.get('wait') || '3000', 10);

    // Fetch quotes
    let quotes: TVQuote[];
    try {
      quotes = await fetchQuotes(symbols, Math.min(waitMs, 5000));
    } catch (err) {
      // WebSocket connection failed — return empty with error
      return NextResponse.json({
        quotes: [],
        count: 0,
        source: 'tradingview-ws',
        authenticated: false,
        error: err instanceof Error ? err.message : 'Connection failed',
        checkedAt: new Date().toISOString(),
      });
    }

    const status = getConnectionStatus();

    return NextResponse.json({
      quotes,
      count: quotes.length,
      source: 'tradingview-ws',
      authenticated: status.authenticated,
      totalCached: status.cached,
      totalSubscribed: status.symbols,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[TV Quotes] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch TradingView quotes' },
      { status: 500 }
    );
  }
}
