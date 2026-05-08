import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { apiGuard } from '@/lib/apiGuard';
import { isAdmin } from '@/lib/adminConfig';
import { getDataSourcesForChokepoint, createDataSource } from '@/lib/chokepoints';
import { log } from '@/lib/logger';
import type { ChokepointId, DataSourceType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: DataSourceType[] = ['rss', 'news_query', 'twitter_account', 'manual_url', 'webhook'];

const VALID_CHOKEPOINTS: ChokepointId[] = [
  'hormuz', 'bab_el_mandeb', 'malacca', 'suez', 'bosporus', 'panama', 'cape_of_good_hope',
];

function isValidChokepoint(id: string): id is ChokepointId {
  return (VALID_CHOKEPOINTS as string[]).includes(id);
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(request, { requireAuth: false, tier: 'public' });
  if (guard instanceof NextResponse) return guard;

  if (!isValidChokepoint(params.id)) {
    return NextResponse.json({ error: 'Unknown chokepoint' }, { status: 404 });
  }

  try {
    const sources = await getDataSourcesForChokepoint(params.id);
    return NextResponse.json({ data: sources });
  } catch (err) {
    log.error('chokepoints.data_sources.list_failed', {
      route: '/api/chokepoints/[id]/data-sources',
      chokepoint_id: params.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to load data sources' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(request, { requireAuth: true, tier: 'api' });
  if (guard instanceof NextResponse) return guard;

  // Admin-only mutation
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!isValidChokepoint(params.id)) {
    return NextResponse.json({ error: 'Unknown chokepoint' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, name, url, config } = (body ?? {}) as {
    type?: string; name?: string; url?: string; config?: Record<string, unknown>;
  };

  if (!type || !(VALID_TYPES as string[]).includes(type)) {
    return NextResponse.json({ error: 'Invalid or missing type' }, { status: 400 });
  }
  if (!name || typeof name !== 'string' || name.length < 1 || name.length > 200) {
    return NextResponse.json({ error: 'name required (1-200 chars)' }, { status: 400 });
  }
  if (url !== undefined && (typeof url !== 'string' || url.length > 2000)) {
    return NextResponse.json({ error: 'url too long' }, { status: 400 });
  }

  try {
    const source = await createDataSource({
      chokepoint_id: params.id,
      type: type as DataSourceType,
      name,
      url: url ?? null,
      config: config ?? {},
    });
    return NextResponse.json({ data: source }, { status: 201 });
  } catch (err) {
    log.error('chokepoints.data_sources.create_failed', {
      route: '/api/chokepoints/[id]/data-sources',
      chokepoint_id: params.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to create data source' }, { status: 500 });
  }
}
