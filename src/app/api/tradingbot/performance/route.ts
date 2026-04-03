/**
 * GET /api/tradingbot/performance — Fetch performance snapshots (most recent first)
 *
 * Requires Clerk authentication.
 * Data stored in Supabase `bot_performance` table.
 *
 * DROP INTO: src/app/api/tradingbot/performance/route.ts
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from('bot_performance')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(168); // 7 days of hourly snapshots

    if (error) {
      console.error('[tradingbot/performance] query error:', error);
      return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error('[GET /api/tradingbot/performance]', err);
    return NextResponse.json({ error: 'Failed to fetch performance' }, { status: 500 });
  }
}
