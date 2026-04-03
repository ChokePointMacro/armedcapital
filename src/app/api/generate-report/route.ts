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
        const report = await parseReportWithAI(snapshot);
        await markSnapshotParsed(body.snapshotId, 'retry');
        return NextResponse.json(report);
      } catch (aiError) {
        const msg = aiError instanceof Error ? aiError.message : String(aiError);
        console.error('[API] Retry parse failed:', msg);
        return NextResponse.json(
          {
            error: 'AI parsing failed on retry. Please try again.',
            type: 'AI_PARSE_FAILED',
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
    // This is the part that should never be lost
    let snapshot: ReportDataSnapshot;
    try {
      snapshot = await fetchReportData(type, customTopic, logProgress);
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

    // ── PHASE 2: AI parsing ──
    console.log(`[API] Phase 2: AI parsing for ${type} report...`);
    try {
      const report = await parseReportWithAI(snapshot, logProgress);

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

      if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota')) {
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
