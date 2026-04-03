/**
 * GET /api/tradingbot/logs — Fetch recent bot logs
 *
 * Supports optional query params:
 *   ?level=ERROR      — filter by level (INFO, WARNING, ERROR)
 *   ?category=trade   — filter by category
 *   ?limit=100        — max rows (default 200, cap 500)
 *
 * Requires Clerk authentication.
 * Data stored in Supabase `bot_logs` table.
 *
 * DROP INTO: src/app/api/tradingbot/logs/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const level = searchParams.get('level');
    const category = searchParams.get('category');
    const limitParam = parseInt(searchParams.get('limit') || '200', 10);
    const limit = Math.min(Math.max(limitParam, 1), 500);

    const supabase = createServerSupabase();

    let query = supabase
      .from('bot_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (level) {
      query = query.eq('level', level.toUpperCase());
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[tradingbot/logs] GET error:', error);
      return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error('[GET /api/tradingbot/logs]', err);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
