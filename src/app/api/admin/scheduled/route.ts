import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { runPipeline, PIPELINES, logAuditEvent, addNotification, checkBudget, routeModel } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

// ── Scheduled Agent Auto-Execution ──────────────────────────────────────────
// Called by Vercel Cron or QStash on a schedule.
// Each schedule entry maps a cron time → pipeline or individual agent task.
// GET: List schedules
// POST: Trigger a scheduled run (called by cron or manually)

interface ScheduleEntry {
  id: string;
  name: string;
  cron: string;          // cron expression (Vercel Cron format)
  pipelineId?: string;   // run a full pipeline
  agentId?: string;      // or run a single agent task
  taskTemplate?: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

const SCHEDULES: ScheduleEntry[] = [
  {
    id: 'morning-brief',
    name: 'Morning Intelligence Brief',
    cron: '0 6 * * 1-5',  // 6am weekdays
    pipelineId: 'morning-pipeline',
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  {
    id: 'risk-check',
    name: 'Weekly Risk Assessment',
    cron: '0 9 * * 1',    // Monday 9am
    pipelineId: 'risk-assessment',
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  {
    id: 'infra-sweep',
    name: 'Daily Infrastructure Health',
    cron: '0 7 * * *',    // 7am daily
    pipelineId: 'infra-health',
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  {
    id: 'quality-check',
    name: 'Bi-Weekly Quality Loop',
    cron: '0 10 * * 3',   // Wednesday 10am
    pipelineId: 'quality-loop',
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  {
    id: 'api-cost-report',
    name: 'Daily API Spend Report',
    cron: '0 18 * * *',   // 6pm daily
    agentId: 'bookkeeping',
    taskTemplate: 'daily-api-spend',
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
  {
    id: 'whale-watch',
    name: 'Crypto Whale Scanner',
    cron: '0 */4 * * *',  // every 4 hours
    agentId: 'market-scanner',
    taskTemplate: 'crypto-whales',
    enabled: true,
    lastRun: null,
    nextRun: null,
  },
];

export async function GET() {
  try {
    await safeAuth();
    return NextResponse.json({
      schedules: SCHEDULES,
      pipelines: PIPELINES.map(p => ({ id: p.id, name: p.name, steps: p.steps.length })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Allow both auth and cron secret
    const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');
    const isAuthorizedCron = cronSecret === process.env.CRON_SECRET;

    if (!isAuthorizedCron) {
      await safeAuth();
    }

    const { scheduleId, action } = await req.json();

    if (action === 'toggle') {
      const schedule = SCHEDULES.find(s => s.id === scheduleId);
      if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      schedule.enabled = !schedule.enabled;
      return NextResponse.json({ schedule });
    }

    if (action === 'trigger' || action === 'cron') {
      const schedule = SCHEDULES.find(s => s.id === scheduleId);
      if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      if (!schedule.enabled && action === 'cron') {
        return NextResponse.json({ skipped: true, reason: 'Schedule disabled' });
      }

      await logAuditEvent({
        type: 'cron_trigger',
        agentId: schedule.agentId || 'pipeline-runner',
        action: `Scheduled run: ${schedule.name}`,
        details: { scheduleId, trigger: action },
      });

      if (schedule.pipelineId) {
        // Run pipeline
        runPipeline(schedule.pipelineId).catch(err => {
          console.error(`[Scheduled] Pipeline ${schedule.pipelineId} failed:`, err);
          addNotification({
            type: 'task_failed',
            title: `Scheduled ${schedule.name} Failed`,
            message: err.message,
            severity: 'error',
          });
        });
        schedule.lastRun = new Date().toISOString();
        return NextResponse.json({ triggered: true, type: 'pipeline', pipelineId: schedule.pipelineId });
      }

      if (schedule.agentId) {
        // Run single agent task
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

        // Seed the task
        await fetch(`${baseUrl}/api/admin/agents/${schedule.agentId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'seed' }),
        });

        schedule.lastRun = new Date().toISOString();
        return NextResponse.json({ triggered: true, type: 'agent', agentId: schedule.agentId });
      }

      return NextResponse.json({ error: 'Schedule has no pipeline or agent' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
