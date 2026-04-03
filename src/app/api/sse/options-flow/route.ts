import { NextRequest } from 'next/server';
import { WebSocket } from 'ws';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── Types ──────────────────────────────────────────────────────────────────────

interface OptionsTrade {
  id: string;
  ticker: string;
  strike: number;
  expiry: string;
  type: 'Call' | 'Put';
  premium: number;
  size: number;
  price: number;
  tradeType: 'Sweep' | 'Block' | 'Split';
  timestamp: number;
  exchange: number;
  conditions: number[];
  unusualScore: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseOptionSymbol(sym: string): {
  ticker: string;
  expiry: string;
  type: 'Call' | 'Put';
  strike: number;
} | null {
  // Format: O:AAPL240719C00150000
  // O:TICKER + YYMMDD + C/P + 00STRIKE
  const match = sym.match(/^O:([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;

  const [, ticker, dateStr, typeChar, strikeStr] = match;

  try {
    const year = parseInt('20' + dateStr.substring(0, 2), 10);
    const month = parseInt(dateStr.substring(2, 4), 10);
    const day = parseInt(dateStr.substring(4, 6), 10);
    const strike = parseInt(strikeStr, 10) / 1000;

    const expiry = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    const type = typeChar === 'C' ? ('Call' as const) : ('Put' as const);

    return { ticker, expiry, type, strike };
  } catch {
    return null;
  }
}

function classifyTrade(
  size: number,
  conditions: number[]
): 'Sweep' | 'Block' | 'Split' {
  // Sweep: condition includes 14 (ask in conditions)
  if (conditions.includes(14)) return 'Sweep';
  // Block: size > 100 contracts
  if (size > 100) return 'Block';
  // Default: Split
  return 'Split';
}

function calculateUnusualScore(
  premium: number,
  size: number,
  tradeType: 'Sweep' | 'Block' | 'Split'
): number {
  // Score 0-10 based on premium, size, and type
  // Sweeps are most unusual, blocks second, splits normal
  let score = 0;

  // Base score from type
  if (tradeType === 'Sweep') score += 5;
  else if (tradeType === 'Block') score += 3;

  // Premium score (log scale)
  if (premium > 100000) score += 4;
  else if (premium > 50000) score += 3;
  else if (premium > 10000) score += 2;
  else if (premium > 1000) score += 1;

  // Size score
  if (size > 1000) score += 1;

  return Math.min(10, score);
}

function generateSimulationData(id: number): OptionsTrade {
  const tickers = ['AAPL', 'SPY', 'QQQ', 'TSLA', 'NVDA', 'META', 'MSFT', 'AMZN'];
  const ticker = tickers[Math.floor(Math.random() * tickers.length)];
  const strikes = [100, 150, 200, 250, 300, 350, 400, 450, 500];
  const strike = strikes[Math.floor(Math.random() * strikes.length)];
  const type = Math.random() > 0.5 ? 'Call' : 'Put';
  const size = Math.floor(Math.random() * 500) + 1;
  const price = Math.random() * 10 + 0.1;
  const premium = price * size * 100;
  const tradeTypes = ['Sweep', 'Block', 'Split'] as const;
  const tradeType = tradeTypes[Math.floor(Math.random() * tradeTypes.length)];

  const monthOffset = Math.floor(Math.random() * 4);
  const daysOffset = Math.floor(Math.random() * 20) + 1;
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + monthOffset);
  expiryDate.setDate(expiryDate.getDate() + daysOffset);
  const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
  const day = String(expiryDate.getDate()).padStart(2, '0');
  const expiry = `${month}/${day}`;

  return {
    id: `sim-${id}`,
    ticker,
    strike,
    expiry,
    type: type as 'Call' | 'Put',
    premium,
    size,
    price,
    tradeType,
    timestamp: Date.now(),
    exchange: 1,
    conditions: [],
    unusualScore: calculateUnusualScore(premium, size, tradeType),
  };
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let closed = false;
  const polygonApiKey = process.env.POLYGON_API_KEY;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ polygonConnected: !!polygonApiKey })}\n\n`
        )
      );

      if (polygonApiKey) {
        // Real Polygon WebSocket connection
        try {
          const ws = new WebSocket('wss://socket.polygon.io/options');
          let tradeId = 0;

          ws.on('open', () => {
            console.log('[OptionsFlow] WebSocket connected to Polygon');
            // Send auth
            ws.send(JSON.stringify({ action: 'auth', params: polygonApiKey }));
            // Subscribe to all options trades
            ws.send(JSON.stringify({ action: 'subscribe', params: 'O.*' }));
          });

          ws.on('message', (data: Buffer) => {
            if (closed) return;

            try {
              const message = JSON.parse(data.toString());

              // Handle auth confirmation
              if (message.status === 'auth_success') {
                console.log('[OptionsFlow] Authenticated with Polygon');
                return;
              }

              // Handle subscription confirmation
              if (message.status === 'success' && message.message === 'subscribed to O.*') {
                console.log('[OptionsFlow] Subscribed to options trades');
                return;
              }

              // Handle trade events
              if (message.type === 'trade' && message.symbol) {
                const sym = message.symbol as string;
                const parsed = parseOptionSymbol(sym);

                if (!parsed) return;

                const size = message.size || 1;
                const price = message.price || 0;
                const premium = price * size * 100;
                const conditions = message.conditions || [];
                const tradeType = classifyTrade(size, conditions);
                const unusualScore = calculateUnusualScore(premium, size, tradeType);

                const trade: OptionsTrade = {
                  id: `${Date.now()}-${tradeId++}`,
                  ticker: parsed.ticker,
                  strike: parsed.strike,
                  expiry: parsed.expiry,
                  type: parsed.type,
                  premium,
                  size,
                  price,
                  tradeType,
                  timestamp: Date.now(),
                  exchange: message.exchange || 1,
                  conditions,
                  unusualScore,
                };

                const payload = JSON.stringify({ trade });
                controller.enqueue(encoder.encode(`event: trade\ndata: ${payload}\n\n`));
              }
            } catch (err) {
              console.error('[OptionsFlow] Parse error:', err);
            }
          });

          ws.on('close', () => {
            console.log('[OptionsFlow] WebSocket disconnected');
          });

          ws.on('error', (err) => {
            console.error('[OptionsFlow] WebSocket error:', err);
          });

          // Cleanup when client disconnects
          req.signal.addEventListener('abort', () => {
            closed = true;
            try {
              ws.close();
            } catch {
              /* already closed */
            }
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        } catch (err) {
          console.error('[OptionsFlow] Failed to connect to Polygon:', err);
          // Fall through to simulation
        }
      }

      // Fallback: simulation mode (if no POLYGON_API_KEY or connection failed)
      if (!polygonApiKey || closed) {
        console.log('[OptionsFlow] Running in simulation mode');
        let simId = 0;

        const timer = setInterval(() => {
          if (closed) {
            clearInterval(timer);
            return;
          }

          try {
            const trade = generateSimulationData(simId++);
            const payload = JSON.stringify({ trade });
            controller.enqueue(encoder.encode(`event: trade\ndata: ${payload}\n\n`));
          } catch {
            /* ignore */
          }
        }, 2000);

        req.signal.addEventListener('abort', () => {
          closed = true;
          clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      }

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
        } catch {
          /* Connection closed */
        }
      }, 30000);
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
