import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const EXEC_CACHE_TTL = 2 * 60 * 1000; // 2 min
let execCache: { data: any; ts: number } | null = null;

// ── Agent Registry ──────────────────────────────────────────────────────────

interface AgentDef {
  id: string;
  name: string;
  role: string;
  category: 'intelligence' | 'data' | 'social' | 'relay' | 'scanner';
  criticalDeps: string[];
  expectedIntervalMs: number; // how often it should run
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

const AGENTS: AgentDef[] = [
  {
    id: 'ORACLE',
    name: 'Oracle',
    role: 'Intelligence briefs & financial reports',
    category: 'intelligence',
    criticalDeps: ['ANTHROPIC_API_KEY'],
    expectedIntervalMs: 6 * 60 * 60 * 1000, // every 6h
    riskTier: 'MEDIUM',
  },
  {
    id: 'BROADCASTER',
    name: 'Broadcaster',
    role: 'Auto-schedule social posts to X',
    category: 'social',
    criticalDeps: ['TWITTER_API_KEY', 'TWITTER_API_SECRET'],
    expectedIntervalMs: 5 * 60 * 1000, // every 5 min cron
    riskTier: 'CRITICAL',
  },
  {
    id: 'SPECTRE',
    name: 'Spectre',
    role: 'Market anomaly scanner & momentum detection',
    category: 'scanner',
    criticalDeps: [],
    expectedIntervalMs: 15 * 60 * 1000, // every 15m
    riskTier: 'LOW',
  },
  {
    id: 'MOSAIC',
    name: 'Mosaic',
    role: 'Macro data enrichment (FRED, Finnhub, CoinGecko)',
    category: 'data',
    criticalDeps: ['FRED_API_KEY'],
    expectedIntervalMs: 30 * 60 * 1000, // every 30m
    riskTier: 'LOW',
  },
  {
    id: 'HAWKEYE',
    name: 'Hawkeye',
    role: 'TradingView webhook signal relay',
    category: 'relay',
    criticalDeps: [],
    expectedIntervalMs: 0, // event-driven, not scheduled
    riskTier: 'LOW',
  },
];

// ── Report Vector Types ─────────────────────────────────────────────────────

interface ReportVector {
  metric: string;
  value: number;       // 0-100 normalized score
  raw: string;         // human-readable raw value
  signal: 'green' | 'yellow' | 'red';
  detail: string;
}

interface AgentReport {
  id: string;
  name: string;
  role: string;
  category: string;
  riskTier: string;
  overallScore: number;
  status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'IDLE';
  vectors: ReportVector[];
  lastRun: string | null;
  runsLast24h: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
}

// ── Evaluate a single agent ─────────────────────────────────────────────────

async function evaluateAgent(
  agent: AgentDef,
  auditLogs: any[],
  now: number
): Promise<AgentReport> {
  const agentLogs = auditLogs.filter(l => l.agent_id === agent.id);
  const last24h = agentLogs.filter(l => now - new Date(l.created_at).getTime() < 86400000);
  const successLogs = last24h.filter(l => l.type !== 'error' && l.type !== 'failure');
  const errorLogs = last24h.filter(l => l.type === 'error' || l.type === 'failure');

  const lastLog = agentLogs[0]; // sorted desc
  const lastRunTs = lastLog ? new Date(lastLog.created_at).getTime() : 0;
  const timeSinceLastRun = lastRunTs ? now - lastRunTs : Infinity;

  // ── Vector 1: Availability (is it running on schedule?) ────────────────
  let availScore = 0;
  let availDetail = '';
  if (agent.expectedIntervalMs === 0) {
    // Event-driven agent — just check if it's been active recently
    availScore = last24h.length > 0 ? 90 : 40;
    availDetail = last24h.length > 0
      ? `${last24h.length} events processed in 24h`
      : 'No events in 24h (event-driven)';
  } else if (timeSinceLastRun <= agent.expectedIntervalMs * 1.5) {
    availScore = 95;
    availDetail = `On schedule — last ran ${formatAgo(timeSinceLastRun)}`;
  } else if (timeSinceLastRun <= agent.expectedIntervalMs * 3) {
    availScore = 60;
    availDetail = `Behind schedule — last ran ${formatAgo(timeSinceLastRun)}`;
  } else if (timeSinceLastRun <= agent.expectedIntervalMs * 10) {
    availScore = 25;
    availDetail = `Significantly delayed — ${formatAgo(timeSinceLastRun)}`;
  } else {
    availScore = 5;
    availDetail = lastRunTs ? `Stale — last ran ${formatAgo(timeSinceLastRun)}` : 'Never executed';
  }

  const availVector: ReportVector = {
    metric: 'Availability',
    value: availScore,
    raw: lastRunTs ? formatAgo(timeSinceLastRun) : 'Never',
    signal: availScore >= 70 ? 'green' : availScore >= 40 ? 'yellow' : 'red',
    detail: availDetail,
  };

  // ── Vector 2: Reliability (success rate) ───────────────────────────────
  const totalRuns = last24h.length;
  const successRate = totalRuns > 0 ? Math.round((successLogs.length / totalRuns) * 100) : 0;
  let reliabilityScore = totalRuns === 0 ? 30 : successRate;
  const reliabilityVector: ReportVector = {
    metric: 'Reliability',
    value: reliabilityScore,
    raw: totalRuns > 0 ? `${successRate}%` : 'No data',
    signal: reliabilityScore >= 90 ? 'green' : reliabilityScore >= 70 ? 'yellow' : 'red',
    detail: totalRuns > 0
      ? `${successLogs.length}/${totalRuns} successful (${errorLogs.length} errors)`
      : 'No runs recorded in 24h',
  };

  // ── Vector 3: Latency (avg response time) ──────────────────────────────
  const latencies = last24h
    .map(l => l.details?.latency_ms ?? l.latency_ms)
    .filter((v: any) => typeof v === 'number' && v > 0);
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length)
    : 0;
  let latencyScore: number;
  if (latencies.length === 0) latencyScore = 50; // no data
  else if (avgLatency < 500) latencyScore = 95;
  else if (avgLatency < 2000) latencyScore = 80;
  else if (avgLatency < 5000) latencyScore = 60;
  else if (avgLatency < 15000) latencyScore = 40;
  else latencyScore = 20;

  const latencyVector: ReportVector = {
    metric: 'Latency',
    value: latencyScore,
    raw: latencies.length > 0 ? `${avgLatency}ms` : 'N/A',
    signal: latencyScore >= 70 ? 'green' : latencyScore >= 40 ? 'yellow' : 'red',
    detail: latencies.length > 0
      ? `Avg ${avgLatency}ms over ${latencies.length} runs`
      : 'No latency data available',
  };

  // ── Vector 4: Cost Efficiency ──────────────────────────────────────────
  const costs = last24h
    .map(l => l.details?.cost_usd ?? l.cost_usd ?? 0)
    .filter((v: any) => typeof v === 'number');
  const totalCost = costs.reduce((a: number, b: number) => a + b, 0);
  const budgetLimits: Record<string, number> = {
    intelligence: 5, data: 2, social: 1, relay: 0.5, scanner: 1,
  };
  const dailyBudget = budgetLimits[agent.category] || 2;
  const costPct = dailyBudget > 0 ? (totalCost / dailyBudget) * 100 : 0;
  let costScore: number;
  if (totalCost === 0 && totalRuns > 0) costScore = 100; // free runs
  else if (totalCost === 0) costScore = 50; // no data
  else if (costPct < 50) costScore = 95;
  else if (costPct < 80) costScore = 75;
  else if (costPct < 100) costScore = 55;
  else costScore = 25; // over budget

  const costVector: ReportVector = {
    metric: 'Cost Efficiency',
    value: costScore,
    raw: totalCost > 0 ? `$${totalCost.toFixed(4)}` : '$0.00',
    signal: costScore >= 70 ? 'green' : costScore >= 40 ? 'yellow' : 'red',
    detail: totalCost > 0
      ? `$${totalCost.toFixed(4)} of $${dailyBudget}/day budget (${Math.round(costPct)}%)`
      : totalRuns > 0 ? 'Zero cost — free tier APIs' : 'No cost data',
  };

  // ── Vector 5: Output Quality (completeness of deliverables) ────────────
  const completedOutputs = last24h.filter(l =>
    l.action === 'complete' || l.action === 'publish' || l.action === 'generate' ||
    l.type === 'success' || l.type === 'complete'
  );
  let qualityScore: number;
  if (totalRuns === 0) qualityScore = 30;
  else if (completedOutputs.length >= totalRuns * 0.9) qualityScore = 92;
  else if (completedOutputs.length >= totalRuns * 0.7) qualityScore = 72;
  else if (completedOutputs.length >= totalRuns * 0.5) qualityScore = 50;
  else qualityScore = 25;

  const qualityVector: ReportVector = {
    metric: 'Output Quality',
    value: qualityScore,
    raw: totalRuns > 0 ? `${completedOutputs.length}/${totalRuns}` : 'No runs',
    signal: qualityScore >= 70 ? 'green' : qualityScore >= 40 ? 'yellow' : 'red',
    detail: totalRuns > 0
      ? `${completedOutputs.length} completed deliverables out of ${totalRuns} runs`
      : 'No output data available',
  };

  // ── Vector 6: Dependency Health ────────────────────────────────────────
  const missingDeps = agent.criticalDeps.filter(d => !process.env[d]);
  let depScore = agent.criticalDeps.length === 0
    ? 100
    : Math.round(((agent.criticalDeps.length - missingDeps.length) / agent.criticalDeps.length) * 100);
  const depVector: ReportVector = {
    metric: 'Dep Health',
    value: depScore,
    raw: missingDeps.length === 0 ? 'All present' : `${missingDeps.length} missing`,
    signal: depScore >= 90 ? 'green' : depScore >= 50 ? 'yellow' : 'red',
    detail: missingDeps.length === 0
      ? `All ${agent.criticalDeps.length || 0} dependencies available`
      : `Missing: ${missingDeps.join(', ')}`,
  };

  // ── Composite Score ────────────────────────────────────────────────────
  const vectors = [availVector, reliabilityVector, latencyVector, costVector, qualityVector, depVector];
  const overallScore = Math.round(
    availScore * 0.25 +
    reliabilityScore * 0.25 +
    latencyScore * 0.15 +
    costScore * 0.10 +
    qualityScore * 0.15 +
    depScore * 0.10
  );

  // Status
  let status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'IDLE';
  if (totalRuns === 0 && timeSinceLastRun > 86400000) status = 'IDLE';
  else if (overallScore >= 70) status = 'OPERATIONAL';
  else if (overallScore >= 40) status = 'DEGRADED';
  else status = 'DOWN';

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    category: agent.category,
    riskTier: agent.riskTier,
    overallScore,
    status,
    vectors,
    lastRun: lastLog ? lastLog.created_at : null,
    runsLast24h: totalRuns,
    successRate,
    avgLatencyMs: avgLatency,
    totalCostUsd: totalCost,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAgo(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

// ── Build full execution report ─────────────────────────────────────────────

async function buildExecutionReport() {
  const now = Date.now();
  let auditLogs: any[] = [];

  try {
    const supabase = createServerSupabase();
    const since = new Date(now - 7 * 86400000).toISOString(); // last 7 days
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (!error && data) auditLogs = data;
  } catch {
    // Supabase unavailable — reports will show "no data" gracefully
  }

  const agents = await Promise.all(
    AGENTS.map(agent => evaluateAgent(agent, auditLogs, now))
  );

  // Platform-wide summary
  const platformScore = Math.round(
    agents.reduce((sum, a) => sum + a.overallScore, 0) / agents.length
  );
  const operational = agents.filter(a => a.status === 'OPERATIONAL').length;
  const degraded = agents.filter(a => a.status === 'DEGRADED').length;
  const down = agents.filter(a => a.status === 'DOWN').length;
  const idle = agents.filter(a => a.status === 'IDLE').length;
  const totalCost24h = agents.reduce((sum, a) => sum + a.totalCostUsd, 0);
  const totalRuns24h = agents.reduce((sum, a) => sum + a.runsLast24h, 0);

  return {
    platformScore,
    summary: {
      operational,
      degraded,
      down,
      idle,
      totalAgents: agents.length,
      totalRuns24h,
      totalCost24h: Math.round(totalCost24h * 10000) / 10000,
      avgSuccessRate: Math.round(agents.reduce((s, a) => s + a.successRate, 0) / agents.length),
    },
    agents,
    evaluatedAt: new Date().toISOString(),
  };
}

// ── GET Handler ──────────────────────────────────────────────────────────────

export async function GET() {
  try {
    if (execCache && Date.now() - execCache.ts < EXEC_CACHE_TTL) {
      return NextResponse.json(execCache.data);
    }

    const data = await buildExecutionReport();
    execCache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Execution] Error:', err);
    if (execCache) {
      return NextResponse.json({ ...execCache.data, stale: true });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
