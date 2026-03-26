/**
 * GET /api/tradingbot/positions — Fetch all bot positions (open first, then recent closed)
 *
 * Requires Clerk authentication.
 * Data stored in Supabase `bot_positions` table.
 *
 * DROP INTO: src/app/api/tradingbot/positions/route.ts
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

    // Fetch open positions first, then most recent closed (limit 50 total)
    const { data: openPositions, error: openErr } = await supabase
      .from('bot_positions')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (openErr) {
      console.error('[tradingbot/positions] open query error:', openErr);
      return NextResponse.json([], { status: 200 });
    }

    const { data: closedPositions, error: closedErr } = await supabase
      .from('bot_positions')
      .select('*')
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(50);

    if (closedErr) {
      console.error('[tradingbot/positions] closed query error:', closedErr);
    }

    const all = [...(openPositions ?? []), ...(closedPositions ?? [])];
    return NextResponse.json(all);
  } catch (err: any) {
    console.error('[GET /api/tradingbot/positions]', err);
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 });
  }
}
