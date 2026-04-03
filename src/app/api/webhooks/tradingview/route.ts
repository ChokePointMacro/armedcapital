import { NextRequest, NextResponse } from 'next/server';
import {
  pushSignal, getRecentSignals, getSignalsForTicker, getBufferSize,
  type TradingViewSignal, type BufferedSignal,
} from '@/lib/tradingviewSignals';

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
      payload: signal,
      received_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[TV Webhook] Failed to persist signal:', err);
  }
}

// ── Webhook Auth ────────────────────────────────────────────────────────────

function validateWebhookSecret(signal: TradingViewSignal): boolean {
  const expectedSecret = process.env.TV_WEBHOOK_SECRET;
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
      const text = await request.text();
      try {
        signal = JSON.parse(text);
      } catch {
        signal = { message: text, action: 'alert' };
      }
    }

    if (!validateWebhookSecret(signal)) {
      console.warn('[TV Webhook] Invalid secret received');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { secret, ...cleanSignal } = signal;

    if (cleanSignal.action) {
      cleanSignal.action = cleanSignal.action.toLowerCase().trim();
    }

    const buffered: BufferedSignal = {
      ...cleanSignal,
      received_at: new Date().toISOString(),
    };
    pushSignal(buffered);

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
    const { safeAuth } = await import('@/lib/authHelper');
    await safeAuth();

    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const source = url.searchParams.get('source') || 'buffer';

    if (source === 'db') {
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

    let signals: BufferedSignal[];
    if (ticker) {
      signals = getSignalsForTicker(ticker, limit);
    } else {
      signals = getRecentSignals(limit);
    }

    return NextResponse.json({
      signals,
      count: signals.length,
      bufferSize: getBufferSize(),
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
