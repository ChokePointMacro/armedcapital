/**
 * POST /api/admin/agents/run
 *
 * On-demand agent execution endpoint.
 * Runs a specific agent task by agentId, with budget checks and audit logging.
 *
 * Body: { agentId: string, prompt: string, opsMode?: boolean }
 * Returns: { agentId, agentName, status, result, elapsed_ms, cost }
 *
 * DROP INTO: src/app/api/admin/agents/run/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import {
  getAgent,
  checkBudget,
  recordSpend,
  logAuditEvent,
  addNotification,
  checkDependencies,
} from '@/lib/agentBus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Types ────────────────────────────────────────────────────────────────────

interface RunResult {
  agentId: string;
  agentName: string;
  codename: string;
  status: 'completed' | 'failed' | 'skipped';
  result: any;
  elapsed_ms: number;
  cost: string;
  error?: string;
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const start = Date.now();

    const body = await req.json();
    const { agentId, prompt, opsMode = false } = body;

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'Missing "agentId"' }, { status: 400 });
    }
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing "prompt"' }, { status: 400 });
    }

    // Look up agent
    const agent = getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent "${agentId}" not found in registry` },
        { status: 404 }
      );
    }

    // Dependency check
    const deps = checkDependencies(agent);
    if (!deps.healthy) {
      await logAuditEvent({
        type: 'error',
        agentId,
        action: `[RUN] Skipped — missing dependencies: ${deps.missing.join(', ')}`,
      });

      const result: RunResult = {
        agentId,
        agentName: agent.name,
        codename: agent.codename,
        status: 'skipped',
        result: null,
        elapsed_ms: Date.now() - start,
        cost: '$0.00',
        error: `Missing dependencies: ${deps.missing.join(', ')}`,
      };
      return NextResponse.json(result, { status: 424 }); // Failed Dependency
    }

    // Budget check
    const budget = checkBudget(agentId, agent.category, 0.01);
    if (!budget.allowed) {
      await logAuditEvent({
        type: 'budget_check',
        agentId,
        action: `[RUN] Budget blocked: ${budget.reason}`,
      });

      const result: RunResult = {
        agentId,
        agentName: agent.name,
        codename: agent.codename,
        status: 'skipped',
        result: null,
        elapsed_ms: Date.now() - start,
        cost: '$0.00',
        error: budget.reason,
      };
      return NextResponse.json(result, { status: 429 });
    }

    // Audit: starting
    await logAuditEvent({
      type: 'task_execution',
      agentId,
      action: `[RUN] Executing agent ${agent.codename}`,
      details: { opsMode, endpoint: agent.runEndpoint, promptLength: prompt.length },
    });

    // Dispatch to agent's run endpoint
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const res = await fetch(`${baseUrl}${agent.runEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, agentId, opsMode }),
    });

    const elapsed = Date.now() - start;
    const costNum = elapsed * 0.00001; // rough estimate
    const cost = `$${costNum.toFixed(4)}`;

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const summary = data.summary || data.text?.slice(0, 500) || `Completed in ${elapsed}ms`;

      // Record spend
      recordSpend(agentId, agent.category, costNum);

      // Audit: completed
      await logAuditEvent({
        type: 'task_execution',
        agentId,
        action: `[RUN] Completed ${agent.codename} in ${elapsed}ms`,
        details: { elapsed, cost },
      });

      // Notify
      addNotification({
        type: 'task_completed',
        title: `${agent.codename} completed`,
        message: typeof summary === 'string' ? summary.slice(0, 200) : 'Task completed',
        agentId,
        severity: 'success',
        actionUrl: '/agents',
      });

      const result: RunResult = {
        agentId,
        agentName: agent.name,
        codename: agent.codename,
        status: 'completed',
        result: data,
        elapsed_ms: elapsed,
        cost,
      };
      return NextResponse.json(result);
    } else {
      const errText = await res.text().catch(() => '');

      // Audit: failed
      await logAuditEvent({
        type: 'error',
        agentId,
        action: `[RUN] Failed ${agent.codename}: HTTP ${res.status}`,
        details: { status: res.status, error: errText.slice(0, 500) },
      });

      addNotification({
        type: 'task_failed',
        title: `${agent.codename} failed`,
        message: `HTTP ${res.status}: ${res.statusText}`,
        agentId,
        severity: 'error',
        actionUrl: '/agents',
      });

      const result: RunResult = {
        agentId,
        agentName: agent.name,
        codename: agent.codename,
        status: 'failed',
        result: null,
        elapsed_ms: elapsed,
        cost,
        error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
      return NextResponse.json(result, { status: 502 });
    }
  } catch (err: any) {
    console.error('[POST /api/admin/agents/run]', err);
    return NextResponse.json(
      { error: 'Agent execution failed', message: err.message },
      { status: 500 }
    );
  }
}
