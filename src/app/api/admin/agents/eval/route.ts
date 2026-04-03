/**
 * POST /api/admin/agents/eval
 *
 * Agent health evaluation endpoint.
 * Runs dependency, budget, status, risk, and error checks for a given agent.
 *
 * Body: { agentId: string }
 * Returns: EvalResult { agentId, agentName, timestamp, healthy, checks[], summary }
 *
 * DROP INTO: src/app/api/admin/agents/eval/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { evaluateAgent, logAuditEvent } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await safeAuth();

    const body = await req.json();
    const { agentId } = body;

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'Missing "agentId"' }, { status: 400 });
    }

    const result = evaluateAgent(agentId);

    // Audit the eval
    await logAuditEvent({
      type: 'agent_eval',
      agentId,
      action: `[EVAL] ${result.healthy ? 'PASS' : 'FAIL'}: ${result.summary}`,
      details: {
        healthy: result.healthy,
        checksTotal: result.checks.length,
        checksFailed: result.checks.filter((c) => !c.passed).length,
      },
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
