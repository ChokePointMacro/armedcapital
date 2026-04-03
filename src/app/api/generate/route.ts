/**
 * POST /api/generate
 *
 * Two-phase intelligence generation:
 *   Phase 1 — Fetch & snapshot: gather all market data, persist raw snapshot to Supabase
 *   Phase 2 — AI parse: feed snapshot to Claude, return analysis
 *
 * If Phase 2 fails the raw data is already saved — the client can retry
 * parse-only via POST { snapshotId, retryParse: true }.
 *
 * Body:
 *   { prompt, agentId?, opsMode?, context? }         — full run
 *   { snapshotId, retryParse: true, prompt? }         — retry parse on existing snapshot
 *
 * Returns:
 *   { text, summary, model, tokens, generatedAt, snapshotId, dataSources }
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Types ───────────────────────────────────────────────────────────────────

interface DataSnapshot {
  id?: string;
  marketQuotes: string;
  fred: string;
  finnhub: string;
  fearGreed: string;
  coinGecko: string;
  bls: string;
  cftc: string;
  treasury: string;
  defiLlama: string;
  tradingView: string;
  marketTide: string;
  customContext: string;
  fetchedAt: string;
  sourceStatus: Record<string, boolean>;
}

interface GenerateResult {
  text: string;
  summary: string;
  model: string;
  tokens: { input: number; output: number };
  generatedAt: string;
  snapshotId: string | null;
  dataSources: Record<string, boolean>;
}

// ── Phase 1: Fetch all data sources in parallel ─────────────────────────────

async function fetchAllData(customContext?: string): Promise<DataSnapshot> {
  const sources: Record<string, boolean> = {};

  // Market quotes (Yahoo)
  const marketQuotesP = (async () => {
    try {
      const symbols = [
        'BTC-USD', 'ETH-USD', 'SOL-USD',
        'SPY', 'QQQ', '^GSPC', '^VIX',
        'GC=F', '^TNX', 'DX-Y.NYB',
      ];
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&fields=symbol,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { sources.marketQuotes = false; return 'Market quotes unavailable.'; }
      const json = await res.json();
      const results = json?.quoteResponse?.result ?? [];
      sources.marketQuotes = results.length > 0;
      return results
        .map((q: any) => {
          const pct = q.regularMarketChangePercent?.toFixed(2) ?? '?';
          const dir = (q.regularMarketChangePercent ?? 0) >= 0 ? '+' : '';
          return `${q.symbol}: $${q.regularMarketPrice?.toFixed(2) ?? '?'} (${dir}${pct}%)`;
        })
        .join('\n');
    } catch { sources.marketQuotes = false; return 'Market quotes unavailable.'; }
  })();

  // Import enriched data fetchers
  const enrichedP = (async () => {
    try {
      const mod = await import('@/lib/enrichedData');
      const [fred, finnhub, fearGreed, coinGecko, bls, cftc, treasury, defiLlama, tradingView] =
        await Promise.allSettled([
          mod.fetchFredData(),
          mod.fetchFinnhubData(),
          mod.fetchFearGreedIndex(),
          mod.fetchCoinGeckoData(),
          mod.fetchBlsData(),
          mod.fetchCftcData(),
          mod.fetchTreasuryData(),
          mod.fetchDefiLlamaData(),
          mod.fetchTradingViewSignals(),
        ]);

      const get = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;

      const fredData = get(fred, { available: false } as any);
      const finnhubData = get(finnhub, { available: false } as any);
      const fgData = get(fearGreed, null);
      const cgData = get(coinGecko, { available: false } as any);
      const blsData = get(bls, { available: false } as any);
      const cftcData = get(cftc, { available: false } as any);
      const treasuryData = get(treasury, { available: false } as any);
      const defiData = get(defiLlama, { available: false } as any);
      const tvData = get(tradingView, { available: false, signals: [], count: 0 } as any);

      sources.fred = fredData.available;
      sources.finnhub = finnhubData.available;
      sources.fearGreed = fgData !== null;
      sources.coinGecko = cgData.available;
      sources.bls = blsData.available;
      sources.cftc = cftcData.available;
      sources.treasury = treasuryData.available;
      sources.defiLlama = defiData.available;
      sources.tradingView = tvData.available;

      return {
        fred: mod.fredToPromptBlock(fredData),
        finnhub: mod.finnhubToPromptBlock(finnhubData),
        fearGreed: mod.fearGreedToPromptBlock(fgData),
        coinGecko: mod.coinGeckoToPromptBlock(cgData),
        bls: mod.blsToPromptBlock(blsData),
        cftc: mod.cftcToPromptBlock(cftcData),
        treasury: mod.treasuryToPromptBlock(treasuryData),
        defiLlama: mod.defiLlamaToPromptBlock(defiData),
        tradingView: mod.tradingViewToPromptBlock(tvData),
      };
    } catch (err) {
      console.error('[Generate] enrichedData import failed:', err);
      return {
        fred: 'FRED DATA: Unavailable',
        finnhub: 'EARNINGS DATA: Unavailable',
        fearGreed: 'FEAR & GREED INDEX: Unavailable',
        coinGecko: 'CRYPTO DATA: Unavailable',
        bls: 'BLS DATA: Unavailable',
        cftc: 'CFTC COT DATA: Unavailable',
        treasury: 'TREASURY DATA: Unavailable',
        defiLlama: 'DEFI DATA: Unavailable',
        tradingView: 'TRADINGVIEW SIGNALS: Unavailable',
      };
    }
  })();

  // Market Tide (separate fetch — it has its own endpoint)
  const marketTideP = (async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/market-tide`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) { sources.marketTide = false; return 'Market Tide: Unavailable'; }
      const json = await res.json();
      sources.marketTide = true;
      return `MARKET TIDE (Options Sentiment):
- Net Sentiment: ${json.sentiment || 'N/A'} (${json.sentimentStrength || 'N/A'})
- Net Premium: $${json.netPremium ? (json.netPremium / 1e6).toFixed(1) + 'M' : 'N/A'}
- Call/Put Split: ${json.callPct || '?'}% / ${json.putPct || '?'}%
- VIX: ${json.vix ?? 'N/A'}`;
    } catch { sources.marketTide = false; return 'Market Tide: Unavailable'; }
  })();

  const [marketQuotes, enriched, marketTide] = await Promise.all([
    marketQuotesP, enrichedP, marketTideP,
  ]);

  return {
    marketQuotes,
    ...enriched,
    marketTide,
    customContext: customContext || '',
    fetchedAt: new Date().toISOString(),
    sourceStatus: sources,
  };
}

// ── Persist snapshot to Supabase ────────────────────────────────────────────

async function saveSnapshot(snapshot: DataSnapshot): Promise<string | null> {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('report_snapshots')
      .insert({
        market_quotes: snapshot.marketQuotes,
        fred: snapshot.fred,
        finnhub: snapshot.finnhub,
        fear_greed: snapshot.fearGreed,
        coin_gecko: snapshot.coinGecko,
        bls: snapshot.bls,
        cftc: snapshot.cftc,
        treasury: snapshot.treasury,
        defi_llama: snapshot.defiLlama,
        trading_view: snapshot.tradingView,
        market_tide: snapshot.marketTide,
        custom_context: snapshot.customContext,
        source_status: snapshot.sourceStatus,
        fetched_at: snapshot.fetchedAt,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Generate] Snapshot save failed:', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[Generate] Snapshot save error:', err);
    return null;
  }
}

// ── Load snapshot from Supabase ─────────────────────────────────────────────

async function loadSnapshot(snapshotId: string): Promise<DataSnapshot | null> {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('report_snapshots')
      .select('*')
      .eq('id', snapshotId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      marketQuotes: data.market_quotes,
      fred: data.fred,
      finnhub: data.finnhub,
      fearGreed: data.fear_greed,
      coinGecko: data.coin_gecko,
      bls: data.bls,
      cftc: data.cftc,
      treasury: data.treasury,
      defiLlama: data.defi_llama,
      tradingView: data.trading_view,
      marketTide: data.market_tide,
      customContext: data.custom_context || '',
      fetchedAt: data.fetched_at,
      sourceStatus: data.source_status || {},
    };
  } catch {
    return null;
  }
}

// ── Build prompt from snapshot ──────────────────────────────────────────────

function buildPromptFromSnapshot(snapshot: DataSnapshot, userPrompt: string): string {
  const blocks = [
    snapshot.marketQuotes,
    snapshot.fred,
    snapshot.bls,
    snapshot.treasury,
    snapshot.cftc,
    snapshot.finnhub,
    snapshot.fearGreed,
    snapshot.coinGecko,
    snapshot.defiLlama,
    snapshot.marketTide,
    snapshot.tradingView,
  ].filter(Boolean);

  if (snapshot.customContext) {
    blocks.push(`ADDITIONAL CONTEXT:\n${snapshot.customContext}`);
  }

  return `${userPrompt}\n\n--- LIVE MARKET DATA SNAPSHOT (${snapshot.fetchedAt}) ---\n${blocks.join('\n\n')}`;
}

// ── Phase 2: AI Parse ───────────────────────────────────────────────────────

async function callClaude(enrichedPrompt: string, model?: string): Promise<{
  text: string; summary: string; model: string;
  tokens: { input: number; output: number }; generatedAt: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const selectedModel = model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
  const maxTokens = 4096;

  const systemPrompt = `You are ORACLE, the senior macro intelligence analyst at Armed Capital.
You produce structured, data-driven intelligence reports with confidence ratings.
Write in dense, professional prose. Use **bold** for key figures.
Always include an executive summary (3 sentences max) at the top.
End with a risk assessment section rating key risks on a 1-5 scale.
Base your analysis ONLY on the market data snapshot provided — do not fabricate numbers.
If a data source shows "Unavailable", acknowledge the gap rather than guessing.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: enrichedPrompt }],
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

  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(' ').slice(0, 500);

  return {
    text,
    summary,
    model: selectedModel,
    tokens: { input: inputTokens, output: outputTokens },
    generatedAt: new Date().toISOString(),
  };
}

// ── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await safeAuth();

    const body = await req.json();
    const {
      prompt,
      agentId = 'intelligence',
      opsMode = false,
      context: customContext,
      snapshotId: existingSnapshotId,
      retryParse = false,
    } = body;

    if (!retryParse && (!prompt || typeof prompt !== 'string')) {
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
        action: `[GENERATE] ${retryParse ? 'Retry parse' : 'Starting'} intelligence generation`,
        details: { opsMode, retryParse, snapshotId: existingSnapshotId },
      });
    } catch { /* agentBus not critical */ }

    // ── Phase 1: Get data snapshot ──────────────────────────────────────────

    let snapshot: DataSnapshot;
    let snapshotId: string | null = existingSnapshotId || null;

    if (retryParse && existingSnapshotId) {
      // Retry: load existing snapshot
      const loaded = await loadSnapshot(existingSnapshotId);
      if (!loaded) {
        return NextResponse.json(
          { error: 'Snapshot not found', snapshotId: existingSnapshotId },
          { status: 404 }
        );
      }
      snapshot = loaded;
    } else {
      // Fresh run: fetch all data
      snapshot = await fetchAllData(customContext);

      // Save snapshot so it survives AI failures
      snapshotId = await saveSnapshot(snapshot);

      console.log(
        `[Generate] Phase 1 complete — snapshot ${snapshotId || 'unsaved'}, sources:`,
        Object.entries(snapshot.sourceStatus)
          .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
          .join(' ')
      );
    }

    // ── Phase 2: AI Parse ───────────────────────────────────────────────────

    const userPrompt = prompt || 'Generate a comprehensive macro intelligence briefing covering all available data.';
    const enrichedPrompt = buildPromptFromSnapshot(snapshot, userPrompt);

    let result;
    try {
      result = await callClaude(enrichedPrompt);
    } catch (aiError: any) {
      // AI failed but data is saved — return snapshot info so client can retry
      console.error('[Generate] Phase 2 AI parse failed:', aiError.message);

      try {
        const { logAuditEvent } = await import('@/lib/agentBus');
        await logAuditEvent({
          type: 'error',
          agentId,
          action: `[GENERATE] AI parse failed — data snapshot preserved`,
          details: { error: aiError.message, snapshotId },
        });
      } catch { /* non-critical */ }

      return NextResponse.json(
        {
          error: 'AI parsing failed — market data has been captured',
          message: aiError.message,
          snapshotId,
          dataSources: snapshot.sourceStatus,
          retryable: true,
        },
        { status: 502 }
      );
    }

    // Record spend
    try {
      const { recordSpend } = await import('@/lib/agentBus');
      const estimatedCost = (result.tokens.input * 0.003 + result.tokens.output * 0.015) / 1000;
      recordSpend(agentId, 'intelligence', estimatedCost);
    } catch { /* non-critical */ }

    // Persist completed report to agent_tasks
    try {
      const supabase = createServerSupabase();
      await supabase.from('agent_tasks').insert({
        agent_id: agentId,
        title: 'Intelligence Generation',
        description: userPrompt.slice(0, 200),
        status: 'completed',
        priority: 'high',
        source: opsMode ? 'system' : 'manual',
        result_summary: result.summary,
        result_content: result.text.slice(0, 50000),
        completed_at: result.generatedAt,
      });
    } catch { /* non-critical */ }

    // Update snapshot with report reference
    if (snapshotId) {
      try {
        const supabase = createServerSupabase();
        await supabase
          .from('report_snapshots')
          .update({ parsed_at: result.generatedAt, model_used: result.model })
          .eq('id', snapshotId);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      ...result,
      snapshotId,
      dataSources: snapshot.sourceStatus,
    });
  } catch (err: any) {
    console.error('[POST /api/generate]', err);

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
