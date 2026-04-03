/**
 * GET  /api/admin/agents/tasks  — Get recommended task queue
 * POST /api/admin/agents/tasks  — Execute a specific task from the queue
 *
 * Query params (GET):
 *   ?forceAll=1         — Show all possible tasks regardless of time
 *   ?agent=intelligence  — Filter by agent ID
 *   ?tags=daily,macro    — Filter by tags (comma-separated)
 *
 * Body (POST):
 *   { taskId: string, agentId: string, prompt: string, runEndpoint: string }
 *
 * DROP INTO: src/app/api/admin/agents/tasks/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';
import { generateTaskQueue } from '@/lib/taskQueue';
import {
  getAgent,
  checkBudget,
  checkDependencies,
  recordSpend,
  logAuditEvent,
  addNotification,
} from '@/lib/agentBus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── GET: Generate and return recommended task queue ──────────────────────────

export async function GET(req: NextRequest) {
  try {
    await safeAuth();

    const { searchParams } = new URL(req.url);
    const forceAll = searchParams.get('forceAll') === '1';
    const agentFilter = searchParams.get('agent') || undefined;
    const tagsParam = searchParams.get('tags');
    const tagFilter = tagsParam ? tagsParam.split(',').map((t) => t.trim()) : undefined;

    // Try to load last run times from Supabase
    let lastRunTimes: Record<string, string> = {};
    try {
      const supabase = createServerSupabase();
      const { data } = await supabase
        .from('agent_task_runs')
        .select('task_def_id, completed_at')
        .order('completed_at', { ascending: false })
        .limit(50);

      if (data) {
        for (const row of data) {
          if (!lastRunTimes[row.task_def_id]) {
            lastRunTimes[row.task_def_id] = row.completed_at;
          }
        }
      }
    } catch {
      // Table might not exist — cooldowns just won't apply
    }

    const queue = generateTaskQueue({
      forceAll,
      agentFilter,
      tagFilter,
      lastRunTimes,
    });

    return NextResponse.json(queue);
  } catch (err: any) {
    console.error('[GET /api/admin/agents/tasks]', err);
    return NextResponse.json({ error: 'Failed to generate task queue' }, { status: 500 });
  }
}

// ── POST: Execute a specific task ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const start = Date.now();

    const body = await req.json();
    const { taskId, agentId, prompt, runEndpoint } = body;

    if (!agentId || !prompt || !runEndpoint) {
      return NextResponse.json(
        { error: 'Missing required fields: agentId, prompt, runEndpoint' },
        { status: 400 }
      );
    }

    const agent = getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: `Agent "${agentId}" not found` }, { status: 404 });
    }

    // Pre-flight: dependency check
    const deps = checkDependencies(agent);
    if (!deps.healthy) {
      return NextResponse.json(
        {
          status: 'skipped',
          error: `Missing dependencies: ${deps.missing.join(', ')}`,
          agentId,
          codename: agent.codename,
        },
        { status: 424 }
      );
    }

    // Pre-flight: budget check
    const budget = checkBudget(agentId, agent.category, 0.01);
    if (!budget.allowed) {
      return NextResponse.json(
        {
          status: 'skipped',
          error: budget.reason,
          agentId,
          codename: agent.codename,
        },
        { status: 429 }
      );
    }

    // Audit: starting
    await logAuditEvent({
      type: 'task_execution',
      agentId,
      action: `[TASK QUEUE] Executing: ${taskId || 'manual task'}`,
      details: { taskId, runEndpoint, promptLength: prompt.length },
    });

    // Dispatch to agent's endpoint
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const res = await fetch(`${baseUrl}${runEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, agentId, opsMode: true }),
    });

    const elapsed = Date.now() - start;

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const summary = data.summary || data.text?.slice(0, 500) || `Completed in ${elapsed}ms`;

      // Record spend
      const costNum = elapsed * 0.00001;
      recordSpend(agentId, agent.category, costNum);

      // Persist the run time for cooldown tracking
      try {
        const supabase = createServerSupabase();
        if (taskId) {
          // Extract the base task ID (before the timestamp suffix)
          const baseTaskId = taskId.replace(/-\d+-[a-z0-9]+$/, '');
          await supabase.from('agent_task_runs').insert({
            task_def_id: baseTaskId,
            agent_id: agentId,
            completed_at: new Date().toISOString(),
            elapsed_ms: elapsed,
            status: 'completed',
            result_summary: typeof summary === 'string' ? summary.slice(0, 2000) : JSON.stringify(summary).slice(0, 2000),
          });
        }
      } catch { /* non-critical */ }

      // Audit + notify
      await logAuditEvent({
        type: 'task_execution',
        agentId,
        action: `[TASK QUEUE] Completed: ${taskId || 'manual'} in ${elapsed}ms`,
        details: { elapsed, taskId },
      });

      addNotification({
        type: 'task_completed',
        title: `${agent.codename} task completed`,
        message: typeof summary === 'string' ? summary.slice(0, 200) : 'Task completed',
        agentId,
        severity: 'success',
        actionUrl: '/agents',
      });

      return NextResponse.json({
        status: 'completed',
        agentId,
        codename: agent.codename,
        taskId,
        elapsed_ms: elapsed,
        cost: `$${costNum.toFixed(4)}`,
        result: data,
      });
    } else {
      const errText = await res.text().catch(() => '');

      await logAuditEvent({
        type: 'error',
        agentId,
        action: `[TASK QUEUE] Failed: ${taskId || 'manual'} — HTTP ${res.status}`,
        details: { status: res.status, error: errText.slice(0, 500) },
      });

      addNotification({
        type: 'task_failed',
        title: `${agent.codename} task failed`,
        message: `HTTP ${res.status}: ${res.statusText}`,
        agentId,
        severity: 'error',
        actionUrl: '/agents',
      });

      return NextResponse.json(
        {
          status: 'failed',
          agentId,
          codename: agent.codename,
          taskId,
          elapsed_ms: elapsed,
          error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
        },
        { status: 502 }
      );
    }
  } catch (err: any) {
    console.error('[POST /api/admin/agents/tasks]', err);
    return NextResponse.json(
      { error: 'Task execution failed', message: err.message },
      { status: 500 }
    );
  }
}
