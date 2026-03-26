/**
 * GET  /api/tradingbot/config — Fetch current bot configuration
 * PUT  /api/tradingbot/config — Update bot configuration
 *
 * Requires Clerk authentication.
 * Data stored in Supabase `bot_config` table (single row, user_id='bot').
 *
 * DROP INTO: src/app/api/tradingbot/config/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── GET: Fetch bot config ───────────────────────────────────────────────────

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from('bot_config')
      .select('*')
      .eq('user_id', 'bot')
      .single();

    if (error) {
      console.error('[tradingbot/config] GET error:', error);
      // Return sensible defaults if no config row exists
      return NextResponse.json({
        trading_mode: 'paper',
        kelly_fraction: 0.25,
        max_position_pct: 0.02,
        max_concurrent_positions: 10,
        daily_loss_limit_pct: 0.05,
        slippage_limit_pct: 0.02,
        ev_threshold: 0.05,
        polymarket_enabled: true,
        crypto_enabled: true,
        exchanges: ['coinbase'],
      });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[GET /api/tradingbot/config]', err);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

// ── PUT: Update bot config ──────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // Whitelist allowed config fields
    const allowed = [
      'trading_mode', 'kelly_fraction', 'max_position_pct',
      'max_concurrent_positions', 'daily_loss_limit_pct', 'slippage_limit_pct',
      'ev_threshold', 'polymarket_enabled', 'crypto_enabled', 'exchanges',
    ];

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const supabase = createServerSupabase();

    const { error } = await supabase
      .from('bot_config')
      .update(updates)
      .eq('user_id', 'bot');

    if (error) {
      console.error('[tradingbot/config] PUT error:', error);
      return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[PUT /api/tradingbot/config]', err);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
