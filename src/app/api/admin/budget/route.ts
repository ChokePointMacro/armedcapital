import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getAllBudgets, getAgentBudget, updateBudget, getModelRoutes, getAvailableModels } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

// ── Budget & Model Routes API ───────────────────────────────────────────────
// GET: View all agent budgets and model assignments
// POST: Update an agent's budget limits or pause status

export async function GET() {
  try {
    await safeAuth();

    return NextResponse.json({
      budgets: getAllBudgets(),
      modelRoutes: getModelRoutes(),
      availableModels: getAvailableModels(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const { agentId, category, dailyLimitUsd, monthlyLimitUsd, paused } = await req.json();

    if (!agentId) {
      return NextResponse.json({ error: 'agentId required' }, { status: 400 });
    }

    const updated = updateBudget(agentId, category || 'operations', {
      ...(dailyLimitUsd !== undefined && { dailyLimitUsd }),
      ...(monthlyLimitUsd !== undefined && { monthlyLimitUsd }),
      ...(paused !== undefined && { paused }),
    });

    return NextResponse.json({ budget: updated, agentId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
