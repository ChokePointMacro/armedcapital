import { NextRequest, NextResponse } from 'next/server';
import {
  fetchReportData,
  parseReportWithAI,
  type ReportDataSnapshot,
} from '@/services/geminiService';
import { createServerSupabase } from '@/lib/supabase';
import { apiGuard } from '@/lib/apiGuard';
import { validate, REPORT_SCHEMA } from '@/lib/validate';

export const maxDuration = 120;

// ── Snapshot persistence ─────────────────────────────────────────────────────

async function saveReportSnapshot(snapshot: ReportDataSnapshot): Promise<string | null> {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('report_snapshots')
      .insert({
        // Store the full snapshot as JSON in custom_context
        custom_context: snapshot,
        source_status: Object.fromEntries(
          snapshot.sourceStatuses.map(s => [s.name, s.status === 'ok'])
        ),
        fetched_at: snapshot.fetchedAt,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[generate-report] Snapshot save failed:', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[generate-report] Snapshot save error:', err);
    return null;
  }
}

async function loadReportSnapshot(snapshotId: string): Promise<ReportDataSnapshot | null> {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('report_snapshots')
      .select('custom_context')
      .eq('id', snapshotId)
      .single();

    if (error || !data?.custom_context) return null;
    return data.custom_context as ReportDataSnapshot;
  } catch {
    return null;
  }
}

async function markSnapshotParsed(snapshotId: string, model: string): Promise<void> {
  try {
    const supabase = createServerSupabase();
    await supabase
      .from('report_snapshots')
      .update({ parsed_at: new Date().toISOString(), model_used: model })
      .eq('id', snapshotId);
  } catch { /* non-critical */ }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const guard = await apiGuard(request, { requireAuth: true, tier: 'report' });
    if (guard instanceof NextResponse) return guard;
    const { userId } = guard;

    const body = await request.json();

    // ── Retry path: re-parse existing snapshot ──
    if (body.snapshotId && body.retryParse) {
      console.log(`[API] Retry parse for snapshot ${body.snapshotId}`);
      const snapshot = await loadReportSnapshot(body.snapshotId);
      if (!snapshot) {
        return NextResponse.json(
          { error: 'Snapshot not found or expired. Please generate a new report.' },
          { status: 404 }
        );
      }

      try {
        const retryTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('PHASE2_TIMEOUT')), 110_000)
        );
        const report = await Promise.race([
          parseReportWithAI(snapshot),
          retryTimeout,
        ]);
        await markSnapshotParsed(body.snapshotId, 'retry');
        return NextResponse.json(report);
      } catch (aiError) {
        const msg = aiError instanceof Error ? aiError.message : String(aiError);
        console.error('[API] Retry parse failed:', msg);
        return NextResponse.json(
          {
            error: msg === 'PHASE2_TIMEOUT'
              ? 'AI timed out on retry. Your data is still saved — try again.'
              : 'AI parsing failed on retry. Please try again.',
            type: msg === 'PHASE2_TIMEOUT' ? 'TIMEOUT' : 'AI_PARSE_FAILED',
            snapshotId: body.snapshotId,
            retryable: true,
            details: msg.substring(0, 200),
          },
          { status: 502 }
        );
      }
    }

    // ── Normal path: two-phase generation ──
    const { data, error: validationError } = validate(body, REPORT_SCHEMA);
    if (validationError) return validationError;

    const { type, customTopic } = data as { type: string; customTopic?: string };

    if (type === 'custom' && !customTopic?.trim()) {
      return NextResponse.json(
        { error: 'Custom topic text is required' },
        { status: 400 }
      );
    }

    console.log(`[API] Phase 1: Fetching data for ${type} report...`);

    const logProgress = (stage: string, percent: number) => {
      console.log(`[API] ${type} progress: ${percent}% — ${stage}`);
    };

    // ── PHASE 1: Fetch all data (RSS + enrichment) ──
    // Budget: 30s max — individual fetches have 5-10s timeouts already
    const PHASE1_TIMEOUT_MS = 30_000;
    let snapshot: ReportDataSnapshot;
    try {
      const phase1Timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Data fetch timed out after 30s')), PHASE1_TIMEOUT_MS)
      );
      snapshot = await Promise.race([
        fetchReportData(type, customTopic, logProgress),
        phase1Timeout,
      ]);
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error('[API] Phase 1 (data fetch) failed:', msg);
      return NextResponse.json(
        { error: `Data fetch failed: ${msg}`, type: 'FETCH_FAILED' },
        { status: 502 }
      );
    }

    // Persist snapshot so it survives AI failures
    const snapshotId = await saveReportSnapshot(snapshot);
    if (snapshotId) {
      console.log(`[API] Snapshot saved: ${snapshotId}`);
    } else {
      console.warn('[API] Snapshot save failed — continuing without persistence');
    }

    // ── PHASE 2: AI parsing (with safety timeout) ──
    // Must finish before Vercel's 120s hard kill — leave 10s buffer
    const PHASE2_TIMEOUT_MS = 95_000;
    console.log(`[API] Phase 2: AI parsing for ${type} report (${PHASE2_TIMEOUT_MS / 1000}s budget)...`);

    const phase2Timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PHASE2_TIMEOUT')), PHASE2_TIMEOUT_MS)
    );

    try {
      const report = await Promise.race([
        parseReportWithAI(snapshot, logProgress),
        phase2Timeout,
      ]);

      if (snapshotId) {
        await markSnapshotParsed(snapshotId, 'success');
      }

      // Validate result
      const isForecast = type === 'forecast';
      if (isForecast) {
        if (!(report as any).events?.length) {
          return NextResponse.json(
            { error: 'No forecast events returned', type: 'EMPTY_RESULT', snapshotId, retryable: !!snapshotId },
            { status: 500 }
          );
        }
        console.log(`[API] ✓ Forecast: ${(report as any).events.length} events`);
      } else {
        if (!(report as any).headlines?.length) {
          return NextResponse.json(
            { error: 'No headlines returned', type: 'EMPTY_RESULT', snapshotId, retryable: !!snapshotId },
            { status: 500 }
          );
        }
        console.log(`[API] ✓ Report: ${(report as any).headlines.length} headlines`);
      }

      return NextResponse.json(report);
    } catch (aiError) {
      // AI failed but data is saved — return retryable error
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      console.error('[API] Phase 2 (AI parse) failed:', msg);

      let errorType = 'AI_PARSE_FAILED';
      let statusCode = 502;
      let userMessage = `AI parsing failed: ${msg.substring(0, 150)}`;

      if (msg === 'PHASE2_TIMEOUT') {
        errorType = 'TIMEOUT';
        statusCode = 504;
        userMessage = 'AI generation timed out, but your data is saved. Hit "Retry AI Parse" to try again without re-fetching.';
      } else if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota')) {
        errorType = 'RATE_LIMIT';
        statusCode = 429;
        userMessage = 'Rate limit reached. Your data is saved — retry in a moment.';
      } else if (msg.includes('All AI providers failed')) {
        errorType = 'ALL_PROVIDERS_FAILED';
        statusCode = 503;
        userMessage = 'All AI providers unavailable. Your data is saved — retry shortly.';
      } else if (msg.includes('JSON') || msg.includes('parse')) {
        errorType = 'PARSING_ERROR';
        userMessage = 'AI returned invalid format. Your data is saved — retry will use a fresh AI call.';
      }

      return NextResponse.json(
        {
          error: userMessage,
          type: errorType,
          snapshotId: snapshotId || undefined,
          retryable: !!snapshotId,
          details: msg.substring(0, 200),
        },
        { status: statusCode }
      );
    }
  } catch (error) {
    console.error('[API] Report generation error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message.substring(0, 200), type: 'UNKNOWN' },
      { status: 500 }
    );
  }
}
