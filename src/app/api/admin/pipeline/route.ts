import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { PIPELINES, runPipeline, getPipelineRun, listPipelineRuns } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

// ── Pipeline API ────────────────────────────────────────────────────────────
// GET: List pipelines and recent runs
// POST: Execute a pipeline

export async function GET(req: NextRequest) {
  try {
    await safeAuth();
    const runId = req.nextUrl.searchParams.get('runId');

    if (runId) {
      const run = getPipelineRun(runId);
      return NextResponse.json({ run: run || null });
    }

    return NextResponse.json({
      pipelines: PIPELINES,
      runs: listPipelineRuns().slice(0, 20),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const { pipelineId } = await req.json();

    if (!pipelineId) {
      return NextResponse.json({ error: 'pipelineId required' }, { status: 400 });
    }

    const pipeline = PIPELINES.find(p => p.id === pipelineId);
    if (!pipeline) {
      return NextResponse.json({ error: `Pipeline ${pipelineId} not found` }, { status: 404 });
    }

    // Start pipeline execution (async — returns immediately with run ID)
    const run = runPipeline(pipelineId).catch(err => {
      console.error(`[Pipeline] ${pipelineId} failed:`, err);
    });

    // Return the run ID so client can poll for status
    const runId = `${pipelineId}-${Date.now()}`;
    return NextResponse.json({
      runId,
      pipelineId,
      status: 'started',
      steps: pipeline.steps.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
