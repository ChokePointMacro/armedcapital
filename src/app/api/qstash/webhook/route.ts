import { NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { log } from '@/lib/logger';

/**
 * QStash webhook receiver. verifySignatureAppRouter validates the
 * Upstash-Signature header against QSTASH_CURRENT_SIGNING_KEY /
 * QSTASH_NEXT_SIGNING_KEY (signed by Upstash, not us).
 *
 * Phase 0: this endpoint logs receipt and returns 200. Phase 1+ will
 * dispatch by job type, e.g.:
 *   - { type: 'ingest:rss', source: 'reuters' }     -> RSS ingestion
 *   - { type: 'agent:run', agent: 'forecast' }      -> agent invocation
 *   - { type: 'synthesis:daily' }                   -> daily report build
 *
 * Sample enqueue (Phase 1+):
 *   await enqueue(
 *     `${process.env.NEXT_PUBLIC_BASE_URL}/api/qstash/webhook`,
 *     { type: 'ingest:rss', source: 'reuters' },
 *     { retries: 5 }
 *   );
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

export const POST = verifySignatureAppRouter(handler);
