import { NextResponse } from 'next/server';
import DailySynthesisEmail from '@/emails/DailySynthesis';
import { sendEmail } from '@/lib/resend';

/**
 * Dev-only smoke test for the Resend integration. Hits the configured
 * RESEND_TO_ADDRESS with a render of the Phase 0 placeholder template.
 *
 * Gated to non-production so it 404s on Vercel prod even if accidentally
 * deployed. Remove once Phase 4 ships the real daily synthesis job.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const to = process.env.RESEND_TO_ADDRESS;
  if (!to) {
    return NextResponse.json(
      { error: 'RESEND_TO_ADDRESS not set' },
      { status: 500 },
    );
  }

  try {
    const result = await sendEmail({
      to,
      subject: 'Armed Capital — Daily Synthesis (smoke test)',
      template: DailySynthesisEmail({ date: new Date() }),
      tags: [{ name: 'env', value: 'smoke-test' }],
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
