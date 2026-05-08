import { NextRequest, NextResponse } from 'next/server';
import { runChokepointAgent } from '@/lib/agent/run';
import { redis } from '@/lib/redis';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily ChokePoint Watch tension agent.
// Schedule: vercel.json → "0 6 * * *" (06:00 UTC).
// Auth: Bearer ${CRON_SECRET}, same pattern as the main /api/cron route.

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('chokepoint_agent.missing_cron_secret', { route: '/api/cron/chokepoint-agent' });
    return NextResponse.json(
      { error: 'Server misconfiguration: cron secret not set' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.warn('chokepoint_agent.unauthorized', {
      route: '/api/cron/chokepoint-agent',
      ip: request.headers.get('x-forwarded-for'),
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed lock so two cron firings can't double-write the same day's run.
  const lockKey = 'cron:chokepoint-agent:lock';
  const lockAcquired = await redis.set(lockKey, Date.now().toString(), { nx: true, ex: 120 });
  if (!lockAcquired) {
    log.warn('chokepoint_agent.lock_held', { route: '/api/cron/chokepoint-agent' });
    return NextResponse.json({ ok: false, skipped: 'lock_held' }, { status: 200 });
  }

  try {
    const result = await runChokepointAgent();
    log.info('chokepoint_agent.run_complete', {
      route: '/api/cron/chokepoint-agent',
      agent_run_id: result.agent_run_id,
      anomaly_count: result.anomaly_count,
      status_writes: result.status_writes,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error('chokepoint_agent.run_failed', {
      route: '/api/cron/chokepoint-agent',
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Agent run failed' }, { status: 500 });
  } finally {
    await redis.del(lockKey);
  }
}
