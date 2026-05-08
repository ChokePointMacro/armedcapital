import { NextRequest, NextResponse } from 'next/server';
import { apiGuard } from '@/lib/apiGuard';
import { getChokepointsWithStatus, sortChokepoints } from '@/lib/chokepoints';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const guard = await apiGuard(request, { requireAuth: false, tier: 'public' });
  if (guard instanceof NextResponse) return guard;

  try {
    const chokepoints = sortChokepoints(await getChokepointsWithStatus());
    return NextResponse.json(
      { data: chokepoints },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err) {
    log.error('chokepoints.list_failed', {
      route: '/api/chokepoints',
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to load chokepoints' }, { status: 500 });
  }
}
