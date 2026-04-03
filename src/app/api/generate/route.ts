/**
 * POST /api/generate
 *
 * Claude-powered intelligence generation endpoint.
 * Used by the ORACLE agent for daily briefs, risk assessments, BTC confluence reports.
 *
 * Body: { prompt: string, agentId?: string, opsMode?: boolean }
 * Returns: { text: string, summary: string, model: string, tokens: object, generatedAt: string }
 *
 * DROP INTO: src/app/api/generate/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Market context fetcher ───────────────────────────────────────────────────

async function getMarketContext(): Promise<string> {
  const symbols = [
    'BTC-USD', 'ETH-USD', 'SOL-USD',
    'SPY', 'QQQ', '^GSPC', '^VIX',
    'GC=F', '^TNX', 'DX-Y.NYB',
  ];

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&fields=symbol,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 0 },
    });
    if (!res.ok) return 'Market data temporarily unavailable.';
    const json = await res.json();
    const results = json?.quoteResponse?.result ?? [];

    return results
      .map((q: any) => {
        const pct = q.regularMarketChangePercent?.toFixed(2) ?? '?';
        const dir = (q.regularMarketChangePercent ?? 0) >= 0 ? '+' : '';
        return `${q.symbol}: $${q.regularMarketPrice?.toFixed(2) ?? '?'} (${dir}${pct}%)`;
      })
      .join('\n');
  } catch {
    return 'Market data temporarily unavailable.';
  }
}

// ── Claude API call ──────────────────────────────────────────────────────────

interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  model?: string;
}

interface GenerateResult {
  text: string;
  summary: string;
  model: string;
  tokens: {
    input: number;
    output: number;
  };
  generatedAt: string;
}

async function callClaude(options: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const model = options.model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
  const maxTokens = options.maxTokens || 2048;

  const systemPrompt = options.systemPrompt || `You are ORACLE, the senior macro intelligence analyst at Armed Capital.
You produce structured, data-driven intelligence reports with confidence ratings.
Write in dense, professional prose. Use **bold** for key figures.
Always include an executive summary (3 sentences max) at the top.
End with a risk assessment section rating key risks on a 1-5 scale.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: options.prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json?.content?.[0]?.text ?? '';
  const inputTokens = json?.usage?.input_tokens ?? 0;
  const outputTokens = json?.usage?.output_tokens ?? 0;

  // Extract first 2 sentences as summary
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(' ').slice(0, 500);

  return {
    text,
    summary,
    model,
    tokens: { input: inputTokens, output: outputTokens },
    generatedAt: new Date().toISOString(),
  };
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await safeAuth();

    const body = await req.json();
    const { prompt, agentId = 'intelligence', opsMode = false } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "prompt" field' }, { status: 400 });
    }

    // Budget check
    try {
      const { checkBudget, logAuditEvent } = await import('@/lib/agentBus');
      const budgetCheck = checkBudget(agentId, 'intelligence', 0.10);
      if (!budgetCheck.allowed) {
        return NextResponse.json(
          { error: 'Budget limit reached', details: budgetCheck.reason },
          { status: 429 }
        );
      }
      await logAuditEvent({
        type: 'task_execution',
        agentId,
        action: `[GENERATE] Starting intelligence generation`,
        details: { opsMode, promptLength: prompt.length },
      });
    } catch { /* agentBus not critical */ }

    // Fetch market context to enrich the prompt
    const marketContext = await getMarketContext();
    const enrichedPrompt = `${prompt}\n\n--- CURRENT MARKET DATA ---\n${marketContext}`;

    // Generate via Claude
    const result = await callClaude({ prompt: enrichedPrompt });

    // Record spend
    try {
      const { recordSpend } = await import('@/lib/agentBus');
      // Estimate cost: ~$3/MTok input, ~$15/MTok output for Sonnet
      const estimatedCost = (result.tokens.input * 0.003 + result.tokens.output * 0.015) / 1000;
      recordSpend(agentId, 'intelligence', estimatedCost);
    } catch { /* non-critical */ }

    // Persist to Supabase
    try {
      const supabase = createServerSupabase();
      await supabase.from('agent_tasks').insert({
        agent_id: agentId,
        title: 'Intelligence Generation',
        description: prompt.slice(0, 200),
        status: 'completed',
        priority: 'high',
        source: opsMode ? 'system' : 'manual',
        result_summary: result.summary,
        result_content: result.text.slice(0, 50000),
        completed_at: result.generatedAt,
      });
    } catch { /* non-critical */ }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[POST /api/generate]', err);

    // Log error
    try {
      const { logAuditEvent } = await import('@/lib/agentBus');
      await logAuditEvent({
        type: 'error',
        agentId: 'intelligence',
        action: `[GENERATE] Failed: ${err.message}`,
        details: { error: err.message },
      });
    } catch { /* non-critical */ }

    return NextResponse.json(
      { error: 'Failed to generate intelligence', message: err.message },
      { status: 500 }
    );
  }
}
