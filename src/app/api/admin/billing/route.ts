import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { currentUser } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';
import { getAllBudgets, getAuditLog, getAvailableModels } from '@/lib/agentBus';
import { isAdmin } from '@/lib/adminConfig';

export const dynamic = 'force-dynamic';

// ── Billing API ─────────────────────────────────────────────────────────────
// GET: Returns full billing breakdown — real API spend per agent, model, day.
// Pulls from audit_log (execution events) + agent_tasks (actual_cost field)
// + in-memory budget tracker for live daily/monthly totals.

interface SpendEntry {
  agentId: string;
  model: string;
  costUsd: number;
  tokens: number;
  latencyMs: number;
  timestamp: string;
}

interface DailySpend {
  date: string;
  totalUsd: number;
  byAgent: Record<string, number>;
  byModel: Record<string, number>;
  taskCount: number;
}

export async function GET(req: NextRequest) {
  try {
    await safeAuth();

    // Admin-only: strict email check — no fallthrough
    let adminEmail: string | null = null;
    try {
      const user = await currentUser();
      adminEmail = user?.emailAddresses?.[0]?.emailAddress || null;
    } catch {
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    }
    if (!isAdmin(adminEmail)) {
      return NextResponse.json({ error: 'Admin access required. Contact your administrator.' }, { status: 403 });
    }

    const supabase = createServerSupabase();

    const period = req.nextUrl.searchParams.get('period') || '30d';
    const daysBack = period === '7d' ? 7 : period === '14d' ? 14 : period === '90d' ? 90 : 30;
    const since = new Date(Date.now() - daysBack * 86400000).toISOString();

    // ── Source 1: Audit log (in-memory) ─────────────────────────────────
    const auditEvents = getAuditLog({ type: 'task_execution', since, limit: 1000 });
    const errorEvents = getAuditLog({ type: 'agent_error', since, limit: 500 });

    // Build spend entries from audit
    const spendEntries: SpendEntry[] = auditEvents
      .filter(e => e.costUsd && e.costUsd > 0)
      .map(e => ({
        agentId: e.agentId,
        model: e.modelUsed || 'unknown',
        costUsd: e.costUsd || 0,
        tokens: e.tokensUsed || 0,
        latencyMs: e.latencyMs || 0,
        timestamp: e.timestamp,
      }));

    // ── Source 2: Supabase agent_tasks (actual_cost) ────────────────────
    // Gracefully handle missing table — Supabase returns error if table doesn't exist
    let taskSpend: SpendEntry[] = [];
    try {
      const { data: tasks, error: taskError } = await supabase
        .from('agent_tasks')
        .select('agent_id, actual_cost, estimated_cost, completed_at, updated_at, status')
        .gte('updated_at', since)
        .in('status', ['completed', 'failed'])
        .order('updated_at', { ascending: false })
        .limit(1000);

      if (!taskError && tasks) {
        taskSpend = tasks.map((t: any) => {
          const costStr = (t.actual_cost || t.estimated_cost || '$0').replace('$', '');
          const cost = parseFloat(costStr) || 0;
          return {
            agentId: t.agent_id,
            model: 'from-task',
            costUsd: cost,
            tokens: 0,
            latencyMs: 0,
            timestamp: t.completed_at || t.updated_at,
          };
        });
      }
    } catch {
      // Table may not exist yet — continue with in-memory data only
    }

    // Merge all spend data
    const allSpend = [...spendEntries, ...taskSpend];

    // ── Aggregate: by agent ─────────────────────────────────────────────
    const byAgent: Record<string, { totalUsd: number; taskCount: number; avgLatency: number; totalTokens: number }> = {};
    for (const entry of allSpend) {
      if (!byAgent[entry.agentId]) {
        byAgent[entry.agentId] = { totalUsd: 0, taskCount: 0, avgLatency: 0, totalTokens: 0 };
      }
      byAgent[entry.agentId].totalUsd += entry.costUsd;
      byAgent[entry.agentId].taskCount++;
      byAgent[entry.agentId].avgLatency += entry.latencyMs;
      byAgent[entry.agentId].totalTokens += entry.tokens;
    }
    for (const key of Object.keys(byAgent)) {
      if (byAgent[key].taskCount > 0) {
        byAgent[key].avgLatency = Math.round(byAgent[key].avgLatency / byAgent[key].taskCount);
      }
      byAgent[key].totalUsd = Math.round(byAgent[key].totalUsd * 10000) / 10000;
    }

    // ── Aggregate: by model ─────────────────────────────────────────────
    const byModel: Record<string, { totalUsd: number; taskCount: number; totalTokens: number }> = {};
    for (const entry of spendEntries) {
      if (!byModel[entry.model]) {
        byModel[entry.model] = { totalUsd: 0, taskCount: 0, totalTokens: 0 };
      }
      byModel[entry.model].totalUsd += entry.costUsd;
      byModel[entry.model].taskCount++;
      byModel[entry.model].totalTokens += entry.tokens;
    }

    // ── Aggregate: by day ───────────────────────────────────────────────
    const dailyMap: Record<string, DailySpend> = {};
    for (const entry of allSpend) {
      const date = entry.timestamp.split('T')[0];
      if (!dailyMap[date]) {
        dailyMap[date] = { date, totalUsd: 0, byAgent: {}, byModel: {}, taskCount: 0 };
      }
      dailyMap[date].totalUsd += entry.costUsd;
      dailyMap[date].taskCount++;
      dailyMap[date].byAgent[entry.agentId] = (dailyMap[date].byAgent[entry.agentId] || 0) + entry.costUsd;
      dailyMap[date].byModel[entry.model] = (dailyMap[date].byModel[entry.model] || 0) + entry.costUsd;
    }
    const daily = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

    // ── Totals ──────────────────────────────────────────────────────────
    const totalSpendUsd = Math.round(allSpend.reduce((sum, e) => sum + e.costUsd, 0) * 10000) / 10000;
    const totalTasks = allSpend.length;
    const totalTokens = allSpend.reduce((sum, e) => sum + e.tokens, 0);
    const totalErrors = errorEvents.length;

    // ── Budgets ─────────────────────────────────────────────────────────
    const budgets = getAllBudgets();

    // ── Projected monthly ───────────────────────────────────────────────
    const daysCounted = Math.max(daily.length, 1);
    const avgDailySpend = totalSpendUsd / daysCounted;
    const projectedMonthly = Math.round(avgDailySpend * 30 * 100) / 100;

    return NextResponse.json({
      admin: { email: adminEmail }, // admin who's viewing
      period: { days: daysBack, since },
      totals: {
        spendUsd: totalSpendUsd,
        tasks: totalTasks,
        tokens: totalTokens,
        errors: totalErrors,
        avgDailySpend: Math.round(avgDailySpend * 10000) / 10000,
        projectedMonthly,
      },
      byAgent,
      byModel,
      daily,
      budgets,
      availableModels: getAvailableModels(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
