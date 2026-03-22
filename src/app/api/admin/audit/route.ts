import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getAuditLog } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

// ── Audit Log API ───────────────────────────────────────────────────────────
// GET: Query audit events with filters
// Params: ?agentId=X&type=X&limit=N&since=ISO

export async function GET(req: NextRequest) {
  try {
    await safeAuth();

    const agentId = req.nextUrl.searchParams.get('agentId') || undefined;
    const type = req.nextUrl.searchParams.get('type') || undefined;
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10);
    const since = req.nextUrl.searchParams.get('since') || undefined;

    const events = getAuditLog({ agentId, type, limit, since });

    return NextResponse.json({
      events,
      count: events.length,
      filters: { agentId, type, limit, since },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
