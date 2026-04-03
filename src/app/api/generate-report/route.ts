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

    const body = await request.json();

    // ── PATH A: AI parse from existing snapshot ──
    // Called by Dashboard as second request, or as retry
    if (body.snapshotId) {
      console.log(`[API] AI parse for snapshot ${body.snapshotId}`);
      const snapshot = await loadReportSnapshot(body.snapshotId);
      if (!snapshot) {
        return NextResponse.json(
          { error: 'Snapshot not found or expired. Please generate a new report.' },
          { status: 404 }
        );
      }

      const AI_TIMEOUT_MS = 110_000; // Full 120s budget minus overhead
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS)
        );
        const report = await Promise.race([parseReportWithAI(snapshot), timeout]);
        await markSnapshotParsed(body.snapshotId, 'success');
        console.log(`[API] ✓ AI parse complete for snapshot ${body.snapshotId}`);
        return NextResponse.json(report);
      } catch (aiError) {
        const msg = aiError instanceof Error ? aiError.message : String(aiError);
        console.error('[API] AI parse failed:', msg);

        let errorType = 'AI_PARSE_FAILED';
        let statusCode = 502;
        let userMessage = `AI parsing failed: ${msg.substring(0, 150)}`;

        if (msg === 'AI_TIMEOUT') {
          errorType = 'TIMEOUT';
          statusCode = 504;
          userMessage = 'AI timed out. Your data is saved — hit "Retry AI Parse" to try again.';
        } else if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota')) {
          errorType = 'RATE_LIMIT';
          statusCode = 429;
          userMessage = 'Rate limit reached. Data saved — retry in a moment.';
        } else if (msg.includes('All AI providers failed')) {
          errorType = 'ALL_PROVIDERS_FAILED';
          statusCode = 503;
          userMessage = 'All AI providers unavailable. Data saved — retry shortly.';
        } else if (msg.includes('JSON') || msg.includes('parse')) {
          errorType = 'PARSING_ERROR';
          userMessage = 'AI returned invalid format. Data saved — retry will use a fresh AI call.';
        }

        return NextResponse.json(
          { error: userMessage, type: errorType, snapshotId: body.snapshotId, retryable: true, details: msg.substring(0, 200) },
          { status: statusCode }
        );
      }
    }

    // ── PATH B: Fetch data + save snapshot ──
    // If fetchOnly=true, return snapshotId immediately (Dashboard calls PATH A next)
    // If fetchOnly is not set, do both phases in one request (legacy/fallback)
    const { data, error: validationError } = validate(body, REPORT_SCHEMA);
    if (validationError) return validationError;

    const { type, customTopic } = data as { type: string; customTopic?: string };
    const fetchOnly = body.fetchOnly === true;

    if (type === 'custom' && !customTopic?.trim()) {
      return NextResponse.json({ error: 'Custom topic text is required' }, { status: 400 });
    }

    console.log(`[API] Fetching data for ${type} report (fetchOnly=${fetchOnly})...`);

    const logProgress = (stage: string, percent: number) => {
      console.log(`[API] ${type} progress: ${percent}% — ${stage}`);
    };

    // Fetch all data (RSS + enrichment) — 45s budget
    let snapshot: ReportDataSnapshot;
    try {
      const fetchTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Data fetch timed out after 45s')), 45_000)
      );
      snapshot = await Promise.race([fetchReportData(type, customTopic, logProgress), fetchTimeout]);
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error('[API] Data fetch failed:', msg);
      return NextResponse.json({ error: `Data fetch failed: ${msg}`, type: 'FETCH_FAILED' }, { status: 502 });
    }

    // Save snapshot
    const snapshotId = await saveReportSnapshot(snapshot);
    if (!snapshotId) {
      // Can't persist — if fetchOnly, that's a hard fail
      if (fetchOnly) {
        return NextResponse.json({ error: 'Failed to save data snapshot', type: 'SNAPSHOT_FAILED' }, { status: 500 });
      }
      console.warn('[API] Snapshot save failed — continuing inline');
    } else {
      console.log(`[API] ✓ Snapshot saved: ${snapshotId}`);
    }

    // If fetchOnly, return the snapshotId so Dashboard can call PATH A
    if (fetchOnly) {
      return NextResponse.json({
        snapshotId,
        phase: 'fetched',
        sourceStatuses: snapshot.sourceStatuses,
        fetchedAt: snapshot.fetchedAt,
      });
    }

    // Legacy: do AI inline (for backwards compat)
    console.log(`[API] Inline AI parse for ${type} report...`);
    try {
      const aiTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI_TIMEOUT')), 70_000)
      );
      const report = await Promise.race([parseReportWithAI(snapshot, logProgress), aiTimeout]);
      if (snapshotId) await markSnapshotParsed(snapshotId, 'inline');
      return NextResponse.json(report);
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      console.error('[API] Inline AI parse failed:', msg);
      return NextResponse.json(
        {
          error: msg === 'AI_TIMEOUT'
            ? 'AI timed out. Your data is saved — hit "Retry AI Parse".'
            : `AI parsing failed: ${msg.substring(0, 150)}`,
          type: msg === 'AI_TIMEOUT' ? 'TIMEOUT' : 'AI_PARSE_FAILED',
          snapshotId: snapshotId || undefined,
          retryable: !!snapshotId,
          details: msg.substring(0, 200),
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error('[API] Report generation error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.substring(0, 200), type: 'UNKNOWN' }, { status: 500 });
  }
}
