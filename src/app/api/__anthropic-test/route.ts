import { NextResponse } from 'next/server';
import { completeWithCachedSystem, DEFAULT_MODEL } from '@/lib/anthropic';

/**
 * Dev-only smoke test for the Anthropic singleton. Confirms:
 *   - ANTHROPIC_API_KEY is set
 *   - The singleton + prompt-caching path returns a real response
 *   - claude-sonnet-4-6 is reachable from this account/workspace
 *
 * Gated to non-production. Returns 404 on prod even if accidentally deployed.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not set' },
      { status: 500 },
    );
  }

  try {
    const text = await completeWithCachedSystem({
      systemPrompt:
        'You are a terse smoke-test responder. Reply with exactly one short sentence confirming you received the prompt.',
      userMessage: 'Smoke test from /api/__anthropic-test. Respond.',
      maxTokens: 100,
    });

    return NextResponse.json({ ok: true, model: DEFAULT_MODEL, response: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
