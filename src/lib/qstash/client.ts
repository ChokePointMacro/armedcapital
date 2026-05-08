import { Client } from '@upstash/qstash';

/**
 * Singleton QStash client. Reads QSTASH_TOKEN from env at load.
 *
 * Use cases on this project:
 *   - Schedule recurring jobs that exceed Vercel's 120s function ceiling
 *     (e.g. multi-source ingestion sweeps).
 *   - Defer work past a request boundary with retry semantics.
 *
 * The webhook receiver lives at /api/qstash/webhook and validates the
 * QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY pair (key rotation
 * is supported by Upstash — both keys are valid at any time).
 */
export const qstash = new Client({
  token: process.env.QSTASH_TOKEN || '',
});

export interface EnqueueOptions {
  /** Delay before delivery in seconds. */
  delay?: number;
  /** Max retries (Upstash default is 3). */
  retries?: number;
  /** Cron expression for recurring schedules (use schedules.create separately). */
  callback?: string;
  /** Dedup key — Upstash will reject duplicate messages with the same id. */
  deduplicationId?: string;
}

/**
 * Enqueue a JSON message to the given absolute webhook URL.
 *
 * @param url   Public webhook endpoint (e.g. https://armedcapital.vercel.app/api/qstash/webhook)
 * @param body  Anything JSON-serializable. Will be POSTed to `url`.
 * @param opts  Delivery options.
 */
export async function enqueue<T>(url: string, body: T, opts: EnqueueOptions = {}) {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error('QSTASH_TOKEN not set — cannot enqueue');
  }

  return qstash.publishJSON({
    url,
    body,
    delay: opts.delay,
    retries: opts.retries,
    callback: opts.callback,
    deduplicationId: opts.deduplicationId,
  });
}
