import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';

/**
 * QStash webhook receiver. The actual signature verifier is lazy-imported on
 * first request — `verifySignatureAppRouter` from @upstash/qstash/nextjs reads
 * QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY at module load and
 * throws if absent, which would crash Next.js's "Collect page data" step on
 * Vercel before the envs are configured.
 *
 * Phase 0: this endpoint logs receipt and returns 200. Phase 1+ will dispatch
 * by job type, e.g.:
 *   - { type: 'ingest:rss', source: 'reuters' }     -> RSS ingestion
 *   - { type: 'agent:run', agent: 'forecast' }      -> agent invocation
 *   - { type: 'synthesis:daily' }                   -> daily report build
 */
async function handler(request: Request) {
  const startedAt = Date.now();
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const jobType = (body as { type?: string } | null)?.type ?? 'unknown';
  log.info('qstash.webhook.received', {
    route: '/api/qstash/webhook',
    jobType,
    latencyMs: Date.now() - startedAt,
  });

  // Phase 0: ack and exit. Phase 1+: dispatch by jobType.
  return NextResponse.json({ ok: true, received: jobType });
}

let verifiedHandlerCache: ((req: Request) => Promise<Response>) | null = null;

async function getVerifiedHandler() {
  if (verifiedHandlerCache) return verifiedHandlerCache;
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) {
    return null;
  }
  const { verifySignatureAppRouter } = await import('@upstash/qstash/nextjs');
  verifiedHandlerCache = verifySignatureAppRouter(handler) as (req: Request) => Promise<Response>;
  return verifiedHandlerCache;
}

export async function POST(request: Request) {
  const verified = await getVerifiedHandler();
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: 'qstash_signing_keys_not_configured' },
      { status: 503 },
    );
  }
  return verified(request);
}
