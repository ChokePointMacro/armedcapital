import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * TradingView Webhook Receiver
 *
 * Receives alert payloads from TradingView Premium via webhook.
 * Stores signals in Supabase and makes them available to the
 * enrichment layer, scanner, and report generator.
 *
 * TradingView Setup:
 *   1. Create alert on any chart/indicator
 *   2. Set Webhook URL to: https://armedcapital.vercel.app/api/webhooks/tradingview
 *   3. Set alert message to JSON with placeholders (template below)
 *
 * Recommended alert message template:
 * {
 *   "ticker": "{{ticker}}",
 *   "exchange": "{{exchange}}",
 *   "close": {{close}},
 *   "open": {{open}},
 *   "high": {{high}},
 *   "low": {{low}},
 *   "volume": {{volume}},
 *   "time": "{{time}}",
 *   "interval": "{{interval}}",
 *   "action": "alert",
 *   "strategy": "custom",
 *   "message": "{{strategy.order.comment}}",
 *   "secret": "YOUR_WEBHOOK_SECRET"
 * }
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TradingViewSignal {
  // Core fields (from TV placeholders)
  ticker?: string;
  exchange?: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  time?: string;
  interval?: string;
  // Custom fields
  action?: string;      // 'buy' | 'sell' | 'alert' | 'long' | 'short' | 'close'
  strategy?: string;    // strategy name or indicator
  message?: string;     // free-form signal description
  secret?: string;      // webhook auth secret
  // Strategy-specific
  price?: number;       // entry/exit price
  contracts?: number;   // position size
  position_size?: number;
  order_id?: string;
  // Extra indicator data (plot values)
  plot_0?: number;
  plot_1?: number;
  plot_2?: number;
  plot_3?: number;
  plot_4?: number;
}

export interface StoredSignal extends TradingViewSignal {
  id?: number;
  received_at: string;
  processed: boolean;
}

// ── In-Memory Signal Buffer ─────────────────────────────────────────────────
// Signals are stored in memory AND persisted to Supabase.
// The in-memory buffer gives other routes instant access without DB queries.

const SIGNAL_BUFFER_SIZE = 200;
const SIGNAL_BUFFER_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface BufferedSignal extends TradingViewSignal {
  received_at: string;
}

let signalBuffer: BufferedSignal[] = [];

/** Get recent signals from the in-memory buffer */
export function getRecentSignals(limit = 50): BufferedSignal[] {
  const cutoff = Date.now() - SIGNAL_BUFFER_TTL;
  return signalBuffer
    .filter(s => new Date(s.received_at).getTime() > cutoff)
    .slice(-limit);
}

/** Get signals for a specific ticker */
export function getSignalsForTicker(ticker: string, limit = 10): BufferedSignal[] {
  return signalBuffer
    .filter(s => s.ticker?.toUpperCase() === ticker.toUpperCase())
    .slice(-limit);
}

/** Get latest signal per unique ticker */
export function getLatestSignalPerTicker(): Map<string, BufferedSignal> {
  const map = new Map<string, BufferedSignal>();
  for (const sig of signalBuffer) {
    if (sig.ticker) {
      map.set(sig.ticker.toUpperCase(), sig);
    }
  }
  return map;
}

// ── Persistence to Supabase ─────────────────────────────────────────────────

async function persistSignal(signal: TradingViewSignal): Promise<void> {
  try {
    const { createServerSupabase } = await import('@/lib/supabase');
    const db = createServerSupabase();

    await db.from('tradingview_signals').insert({
      ticker: signal.ticker || null,
      exchange: signal.exchange || null,
      action: signal.action || 'alert',
      strategy: signal.strategy || null,
      message: signal.message || null,
      interval_tf: signal.interval || null,
      price_close: signal.close || null,
      price_open: signal.open || null,
      price_high: signal.high || null,
      price_low: signal.low || null,
      volume: signal.volume || null,
      payload: signal, // store full raw payload as JSONB
      received_at: new Date().toISOString(),
    });
  } catch (err) {
    // Don't fail the webhook response if DB write fails
    console.error('[TV Webhook] Failed to persist signal:', err);
  }
}

// ── Webhook Auth ────────────────────────────────────────────────────────────

function validateWebhookSecret(signal: TradingViewSignal): boolean {
  const expectedSecret = process.env.TV_WEBHOOK_SECRET;
  // If no secret is configured, accept all webhooks (open mode)
  if (!expectedSecret) return true;
  return signal.secret === expectedSecret;
}

// ── POST Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let signal: TradingViewSignal;

    if (contentType.includes('application/json')) {
      signal = await request.json();
    } else {
      // TradingView sends text/plain if the message isn't valid JSON
      const text = await request.text();
      try {
        signal = JSON.parse(text);
      } catch {
        // Treat as a simple text alert
        signal = { message: text, action: 'alert' };
      }
    }

    // Validate webhook secret
    if (!validateWebhookSecret(signal)) {
      console.warn('[TV Webhook] Invalid secret received');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Remove secret from stored payload
    const { secret, ...cleanSignal } = signal;

    // Normalize action
    if (cleanSignal.action) {
      cleanSignal.action = cleanSignal.action.toLowerCase().trim();
    }

    // Add to in-memory buffer
    const buffered: BufferedSignal = {
      ...cleanSignal,
      received_at: new Date().toISOString(),
    };
    signalBuffer.push(buffered);
    if (signalBuffer.length > SIGNAL_BUFFER_SIZE) {
      signalBuffer = signalBuffer.slice(-SIGNAL_BUFFER_SIZE);
    }

    // Persist to Supabase (async, don't block response)
    persistSignal(cleanSignal);

    console.log(`[TV Webhook] Signal received: ${cleanSignal.ticker || 'unknown'} ${cleanSignal.action || 'alert'} @ ${cleanSignal.close || 'N/A'}`);

    return NextResponse.json({
      received: true,
      ticker: cleanSignal.ticker,
      action: cleanSignal.action,
      timestamp: buffered.received_at,
    });
  } catch (err) {
    console.error('[TV Webhook] Error processing webhook:', err);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

// ── GET Handler (signal feed) ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Optional: require auth for reading signals
    const { safeAuth } = await import('@/lib/authHelper');
    await safeAuth();

    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const source = url.searchParams.get('source') || 'buffer'; // 'buffer' or 'db'

    if (source === 'db') {
      // Read from Supabase for historical signals
      const { createServerSupabase } = await import('@/lib/supabase');
      const db = createServerSupabase();
      let query = db.from('tradingview_signals')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(limit);

      if (ticker) {
        query = query.ilike('ticker', ticker);
      }

      const { data, error } = await query;
      if (error) throw error;

      return NextResponse.json({
        signals: data || [],
        count: data?.length || 0,
        source: 'database',
        checkedAt: new Date().toISOString(),
      });
    }

    // Default: read from in-memory buffer (fastest)
    let signals: BufferedSignal[];
    if (ticker) {
      signals = getSignalsForTicker(ticker, limit);
    } else {
      signals = getRecentSignals(limit);
    }

    return NextResponse.json({
      signals,
      count: signals.length,
      bufferSize: signalBuffer.length,
      source: 'buffer',
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[TV Webhook] Error reading signals:', err);
    return NextResponse.json(
      { error: 'Failed to read signals' },
      { status: 500 }
    );
  }
}
