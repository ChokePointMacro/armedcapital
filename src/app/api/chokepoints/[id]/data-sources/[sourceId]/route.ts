import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { apiGuard } from '@/lib/apiGuard';
import { isAdmin } from '@/lib/adminConfig';
import { updateDataSource, deleteDataSource } from '@/lib/chokepoints';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const guard = await apiGuard(request, { requireAuth: true, tier: 'api' });
  if (guard instanceof NextResponse) return guard;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  const blocked = await requireAdmin(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch = body as { enabled?: boolean; name?: string; url?: string | null; config?: Record<string, unknown> };
  const allowed: typeof patch = {};
  if (typeof patch.enabled === 'boolean') allowed.enabled = patch.enabled;
  if (typeof patch.name === 'string' && patch.name.length > 0 && patch.name.length <= 200) allowed.name = patch.name;
  if (patch.url === null || (typeof patch.url === 'string' && patch.url.length <= 2000)) allowed.url = patch.url;
  if (patch.config && typeof patch.config === 'object') allowed.config = patch.config;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    await updateDataSource(params.sourceId, allowed);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('chokepoints.data_sources.update_failed', {
      route: '/api/chokepoints/[id]/data-sources/[sourceId]',
      source_id: params.sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  const blocked = await requireAdmin(request);
  if (blocked) return blocked;

  try {
    await deleteDataSource(params.sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('chokepoints.data_sources.delete_failed', {
      route: '/api/chokepoints/[id]/data-sources/[sourceId]',
      source_id: params.sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
