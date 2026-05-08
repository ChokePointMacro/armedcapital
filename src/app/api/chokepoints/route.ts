import { NextRequest, NextResponse } from 'next/server';
import { apiGuard } from '@/lib/apiGuard';
import {
  getChokepointsWithStatus,
  getProducerCountries,
  getLatestAgentRun,
  sortChokepoints,
} from '@/lib/chokepoints';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Single dashboard endpoint: chokepoints + producer lists + latest agent run.
// One fetch from <Chokepoints /> keeps the UI simple.

export async function GET(request: NextRequest) {
  const guard = await apiGuard(request, { requireAuth: false, tier: 'public' });
  if (guard instanceof NextResponse) return guard;

  try {
    const [chokepointsRaw, oilProducers, lngProducers, latestRun] = await Promise.all([
      getChokepointsWithStatus(),
      getProducerCountries({ product: 'oil' }),
      getProducerCountries({ product: 'lng' }),
      getLatestAgentRun(),
    ]);

    return NextResponse.json(
      {
        chokepoints: sortChokepoints(chokepointsRaw),
        oil_producers: oilProducers,
        lng_producers: lngProducers,
        latest_run: latestRun,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err) {
    log.error('chokepoints.dashboard_failed', {
      route: '/api/chokepoints',
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to load chokepoints' }, { status: 500 });
  }
}
