import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── SSE: Real-time Market Data Push ─────────────────────────────────────────
// Pushes live TradingView WS quotes to the frontend via Server-Sent Events.
// Client connects once, receives a stream of price updates every 2 seconds.

const DEFAULT_SYMBOLS = [
  'BITSTAMP:BTCUSD', 'BITSTAMP:ETHUSD', 'BINANCE:SOLUSDT',
  'SP:SPX', 'NASDAQ:QQQ', 'TVC:DXY', 'TVC:US10Y',
  'COMEX:GC1!', 'CBOE:VIX',
];

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get('symbols');
  const symbols = symbolsParam ? symbolsParam.split(',') : DEFAULT_SYMBOLS;
  const interval = parseInt(req.nextUrl.searchParams.get('interval') || '2000', 10);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ symbols, interval })}\n\n`));

      const push = async () => {
        if (closed) return;
        try {
          const { getQuotes, getConnectionStatus } = await import('@/lib/tradingviewWS');
          const quotes = getQuotes(symbols);
          const status = getConnectionStatus();

          const payload = JSON.stringify({
            ts: Date.now(),
            connected: status.connected,
            authenticated: status.authenticated,
            quotes,
          });

          controller.enqueue(encoder.encode(`event: quotes\ndata: ${payload}\n\n`));
        } catch (err) {
          const errPayload = JSON.stringify({ error: (err as Error).message });
          controller.enqueue(encoder.encode(`event: error\ndata: ${errPayload}\n\n`));
        }
      };

      // Initial push
      await push();

      // Set up interval
      const timer = setInterval(push, Math.max(interval, 1000));

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
        } catch {
          // Connection closed
        }
      }, 30000);

      // Cleanup when client disconnects
      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
