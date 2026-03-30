import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Types ────────────────────────────────────────────────────────────────────

interface OpsTask {
  agent_id: string;
  agent_name: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_score: number;
  estimated_cost: string;
  category: string;
  prompt: string;
  run_endpoint: string;
}

interface OpsResult {
  agent_id: string;
  agent_name: string;
  task_title: string;
  status: 'completed' | 'failed' | 'skipped';
  priority: string;
  risk_level: string;
  risk_score: number;
  category: string;
  elapsed_ms: number;
  cost: string;
  summary: string;
  error?: string;
}

interface OpsSummary {
  id: string;
  type: 'daily' | 'weekly';
  started_at: string;
  completed_at: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  total_cost: string;
  total_elapsed_ms: number;
  risk_assessment: {
    highest_risk: string;
    critical_count: number;
    high_count: number;
    avg_risk_score: number;
    risk_summary: string;
  };
  priority_breakdown: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  agent_performance: {
    agent_id: string;
    agent_name: string;
    tasks_run: number;
    tasks_completed: number;
    tasks_failed: number;
    total_cost: string;
    avg_elapsed_ms: number;
    grade: string;
  }[];
  results: OpsResult[];
  recommendations: string[];
}

// ── Daily Task Definitions ───────────────────────────────────────────────────
// Tasks that should run every day — market monitoring, briefs, scans

const DAILY_OPS: OpsTask[] = [
  {
    agent_id: 'intelligence',
    agent_name: 'Intelligence (ORACLE)',
    title: 'Morning Macro Intelligence Brief',
    description: 'Generate comprehensive daily market intelligence covering yields, equities, crypto, macro indicators, sentiment, and key risks.',
    priority: 'high',
    risk_level: 'medium',
    risk_score: 5,
    estimated_cost: '$0.08',
    category: 'intelligence',
    prompt: 'Generate a comprehensive daily macro intelligence brief for Armed Capital. Cover: (1) Treasury yields and rate expectations \u2014 DGS2, DGS10, T10Y2Y, T5YIE, FEDFUNDS, (2) Equity market structure \u2014 SPX, QQQ, VIX positioning and key levels, (3) Crypto market \u2014 BTC dominance, ETH/SOL relative strength, DeFi TVL trends, (4) Macro indicators \u2014 latest CPI, employment (ICSA), CFTC positioning, TGA balance, (5) Sentiment \u2014 Fear & Greed index, put/call ratios, funding rates, (6) Key risks and catalysts for next 48 hours with probability ratings. Format as a structured intelligence brief with confidence ratings per section. Include a 3-sentence executive summary at the top.',
    run_endpoint: '/api/generate',
  },
  {
    agent_id: 'market-scanner',
    agent_name: 'Market Scanner (SPECTRE)',
    title: 'Daily Market Anomaly Scan',
    description: 'Scan equities, crypto, and macro data for anomalies, volume spikes, and momentum shifts.',
    priority: 'high',
    risk_level: 'low',
    risk_score: 2,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Run a full daily anomaly scan across all monitored assets.',
    run_endpoint: '/api/scanner',
  },
  {
    agent_id: 'data-enrichment',
    agent_name: 'Data Enrichment (MOSAIC)',
    title: 'Refresh All Data Sources',
    description: 'Force-refresh all enrichment data sources.',
    priority: 'medium',
    risk_level: 'low',
    risk_score: 2,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Refresh all data sources and report status.',
    run_endpoint: '/api/usage',
  },
  {
    agent_id: 'tradingview-relay',
    agent_name: 'TradingView Relay (HAWKEYE)',
    title: 'Daily Signal Digest',
    description: 'Compile TradingView signals from last 24h.',
    priority: 'medium',
    risk_level: 'low',
    risk_score: 1,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Compile TradingView webhook signals digest.',
    run_endpoint: '/api/tradingview',
  },
  {
    agent_id: 'auto-scheduler',
    agent_name: 'Auto-Schedule Pipeline (BROADCASTER)',
    title: 'Generate Daily Social Content',
    description: 'Create tweet-ready content from the morning brief.',
    priority: 'medium',
    risk_level: 'critical',
    risk_score: 9,
    estimated_cost: '$0.001',
    category: 'social',
    prompt: 'Generate social posts from today morning brief. Queue only, do not post.',
    run_endpoint: '/api/auto-schedule',
  },
];

const WEEKLY_OPS: OpsTask[] = [];

async function executeOpsTask(task: OpsTask, supabase: any): Promise<OpsResult> {
  const start = Date.now();
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(baseUrl + task.run_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: task.prompt, agentId: task.agent_id, opsMode: true }),
    });
    const elapsed = Date.now() - start;
    const cost = '$' + (elapsed * 0.00001).toFixed(4);
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { agent_id: task.agent_id, agent_name: task.agent_name, task_title: task.title, status: 'completed', priority: task.priority, risk_level: task.risk_level, risk_score: task.risk_score, category: task.category, elapsed_ms: elapsed, cost, summary: (result.summary || result.message || 'Completed in ' + elapsed + 'ms').slice(0, 1000) };
    }
    return { agent_id: task.agent_id, agent_name: task.agent_name, task_title: task.title, status: 'failed', priority: task.priority, risk_level: task.risk_level, risk_score: task.risk_score, category: task.category, elapsed_ms: elapsed, cost, summary: 'HTTP ' + res.status, error: await res.text().catch(() => '') };
  } catch (err) {
    return { agent_id: task.agent_id, agent_name: task.agent_name, task_title: task.title, status: 'failed', priority: task.priority, risk_level: task.risk_level, risk_score: task.risk_score, category: task.category, elapsed_ms: Date.now() - start, cost: '$0.00', summary: 'Error: ' + (err as Error).message, error: (err as Error).message };
  }
}

export async function GET(req: NextRequest) {
  try {
    await safeAuth();
    const type = new URL(req.url).searchParams.get('type') || 'daily';
    const tasks = type === 'weekly' ? WEEKLY_OPS : DAILY_OPS;
    return NextResponse.json({ type, tasks: tasks.map(t => ({ agent_id: t.agent_id, agent_name: t.agent_name, title: t.title, description: t.description, priority: t.priority, risk_level: t.risk_level, risk_score: t.risk_score, estimated_cost: t.estimated_cost, category: t.category })), total: tasks.length, estimated_total_cost: tasks.reduce((s, t) => s + parseFloat(t.estimated_cost.replace('$', '') || '0'), 0).toFixed(4) });
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
}

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const { type = 'daily' } = await req.json();
    const supabase = createServerSupabase();
    const startedAt = new Date().toISOString();
    const tasks = type === 'weekly' ? WEEKLY_OPS : DAILY_OPS;
    const results: OpsResult[] = [];
    for (const task of tasks) { results.push(await executeOpsTask(task, supabase)); }
    const completed = results.filter(r => r.status === 'completed');
    const failed = results.filter(r => r.status === 'failed');
    const totalCost = results.reduce((s, r) => s + parseFloat(r.cost.replace('$', '') || '0'), 0);
    const summary = { id: 'ops-' + type + '-' + Date.now(), type, started_at: startedAt, completed_at: new Date().toISOString(), total_tasks: results.length, completed_tasks: completed.length, failed_tasks: failed.length, skipped_tasks: 0, total_cost: '$' + totalCost.toFixed(4), total_elapsed_ms: results.reduce((s, r) => s + r.elapsed_ms, 0), results, recommendations: failed.length > 0 ? [failed.length + ' task(s) failed. Check logs.'] : ['All ops completed successfully.'] };
    return NextResponse.json(summary);
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
}
