import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { apiGuard } from '@/lib/apiGuard';
import { isAdmin } from '@/lib/adminConfig';
import { getRecentSignalsForChokepoint, insertManualSignal } from '@/lib/chokepoints';
import { log } from '@/lib/logger';
import type { ChokepointId, SignalSeverity } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CHOKEPOINTS: ChokepointId[] = [
  'hormuz', 'bab_el_mandeb', 'malacca', 'suez', 'bosporus', 'panama', 'cape_of_good_hope',
];

const VALID_SEVERITIES: SignalSeverity[] = ['low', 'medium', 'high'];

function isValidChokepoint(id: string): id is ChokepointId {
  return (VALID_CHOKEPOINTS as string[]).includes(id);
}

// GET — list recent signals (last 7d default), public read
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(request, { requireAuth: false, tier: 'public' });
  if (guard instanceof NextResponse) return guard;

  if (!isValidChokepoint(params.id)) {
    return NextResponse.json({ error: 'Unknown chokepoint' }, { status: 404 });
  }

  try {
    const signals = await getRecentSignalsForChokepoint(params.id);
    return NextResponse.json({ data: signals });
  } catch (err) {
    log.error('chokepoints.signals.list_failed', {
      route: '/api/chokepoints/[id]/signals',
      chokepoint_id: params.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to load signals' }, { status: 500 });
  }
}

// POST — manually inject a signal (admin only). Used to test the pipeline
// and as a manual-flag escape hatch when an event matters but no source has caught it.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(request, { requireAuth: true, tier: 'api' });
  if (guard instanceof NextResponse) return guard;

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

  const { severity, headline, url, body: signalBody, data_source_id } = (body ?? {}) as {
    severity?: string;
    headline?: string;
    url?: string;
    body?: string;
    data_source_id?: string | null;
  };

  if (!severity || !(VALID_SEVERITIES as string[]).includes(severity)) {
    return NextResponse.json({ error: 'severity must be low|medium|high' }, { status: 400 });
  }
  if (!headline || typeof headline !== 'string' || headline.length < 1 || headline.length > 500) {
    return NextResponse.json({ error: 'headline required (1-500 chars)' }, { status: 400 });
  }

  try {
    const signal = await insertManualSignal({
      chokepoint_id: params.id,
      data_source_id: data_source_id ?? null,
      severity: severity as SignalSeverity,
      headline,
      url: url ?? null,
      body: signalBody ?? null,
    });
    return NextResponse.json({ data: signal }, { status: 201 });
  } catch (err) {
    log.error('chokepoints.signals.create_failed', {
      route: '/api/chokepoints/[id]/signals',
      chokepoint_id: params.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to create signal' }, { status: 500 });
  }
}
