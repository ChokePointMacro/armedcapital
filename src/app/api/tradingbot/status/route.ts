/**
 * GET /api/tradingbot/status — Check if the bot is alive via heartbeat
 *
 * Returns the bot's current status (running, paused, offline) by checking
 * the heartbeat_at timestamp in bot_config. If the last heartbeat is older
 * than 30 seconds, the bot is considered offline.
 *
 * Requires Clerk authentication.
 *
 * DROP INTO: src/app/api/tradingbot/status/route.ts
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from('bot_config')
      .select('bot_status, heartbeat_at, trading_mode')
      .eq('user_id', 'bot')
      .single();

    if (error || !data) {
      return NextResponse.json({
        status: 'offline',
        trading_mode: 'paper',
        heartbeat_at: null,
        message: 'No bot config found',
      });
    }

    const heartbeatAt = data.heartbeat_at ? new Date(data.heartbeat_at).getTime() : 0;
    const now = Date.now();
    const isStale = now - heartbeatAt > HEARTBEAT_TIMEOUT_MS;

    // If the heartbeat is stale, the bot process is dead regardless of what bot_status says
    const effectiveStatus = isStale ? 'offline' : (data.bot_status || 'offline');

    return NextResponse.json({
      status: effectiveStatus,
      trading_mode: data.trading_mode || 'paper',
      heartbeat_at: data.heartbeat_at,
      stale: isStale,
      message: isStale
        ? 'Bot process is not running. Start it with: python -m bot.main'
        : effectiveStatus === 'paused'
          ? 'Bot is paused. Click Resume to continue scanning.'
          : 'Bot is running and scanning markets.',
    });
  } catch (err: any) {
    console.error('[GET /api/tradingbot/status]', err);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}
