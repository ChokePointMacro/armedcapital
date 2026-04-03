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
    prompt: 'Generate a comprehensive daily macro intelligence brief for Armed Capital. Cover: (1) Treasury yields and rate expectations — DGS2, DGS10, T10Y2Y, T5YIE, FEDFUNDS, (2) Equity market structure — SPX, QQQ, VIX positioning and key levels, (3) Crypto market — BTC dominance, ETH/SOL relative strength, DeFi TVL trends, (4) Macro indicators — latest CPI, employment (ICSA), CFTC positioning, TGA balance, (5) Sentiment — Fear & Greed index, put/call ratios, funding rates, (6) Key risks and catalysts for next 48 hours with probability ratings. Format as a structured intelligence brief with confidence ratings per section. Include a 3-sentence executive summary at the top.',
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
    prompt: 'Run a full daily anomaly scan across all monitored assets. Check: (1) Volume spikes >2x 7-day average on any watchlist equity or crypto, (2) Price moves >3% in 24h on any top-20 crypto, (3) BTC dominance shift >1% from yesterday, (4) DeFi TVL changes >5% on any top-10 chain, (5) Stablecoin market cap changes >1%, (6) FRED yield curve — any inversion changes, (7) Fear & Greed index move >10 points. Flag all anomalies with severity (low/medium/high/critical) and potential impact assessment.',
    run_endpoint: '/api/scanner',
  },
  {
    agent_id: 'data-enrichment',
    agent_name: 'Data Enrichment (MOSAIC)',
    title: 'Refresh All Data Sources',
    description: 'Force-refresh all 9+ enrichment data sources and verify freshness timestamps.',
    priority: 'medium',
    risk_level: 'low',
    risk_score: 2,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Force-refresh all enrichment data sources and report status: (1) FRED — yield curve, breakevens, jobless claims, fed funds, (2) Finnhub — market quotes, earnings calendar, (3) CoinGecko — top 10 crypto, BTC dominance, (4) CNN Fear & Greed — current reading and trend, (5) BLS — CPI, PPI, employment if new data, (6) CFTC COT — E-mini, 10Y, Gold, Euro FX, BTC positioning, (7) Treasury — TGA balance, debt, auction schedule, (8) DefiLlama — chain TVL, stablecoin flows. Report freshness timestamps and flag any stale (>24h) or failed sources.',
    run_endpoint: '/api/usage',
  },
  {
    agent_id: 'tradingview-relay',
    agent_name: 'TradingView Relay (HAWKEYE)',
    title: 'Daily Signal Digest',
    description: 'Compile and analyze all TradingView signals received in the last 24 hours.',
    priority: 'medium',
    risk_level: 'low',
    risk_score: 1,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Compile a digest of all TradingView webhook signals received in the last 24 hours. Group by: (1) Signal type — buy, sell, alert, indicator trigger, (2) Asset — which symbols fired the most signals, (3) Timeframe — intraday vs daily signals, (4) Confluence — any assets with 3+ signals in same direction. Summarize the overall signal landscape and highlight the highest-conviction setups.',
    run_endpoint: '/api/tradingview',
  },
  {
    agent_id: 'auto-scheduler',
    agent_name: 'Auto-Schedule Pipeline (BROADCASTER)',
    title: 'Generate Daily Social Content',
    description: 'Create tweet-ready content from the morning brief for scheduled posting.',
    priority: 'medium',
    risk_level: 'critical',
    risk_score: 9,
    estimated_cost: '$0.001',
    category: 'social',
    prompt: 'Using today\'s macro intelligence brief, generate 3-5 tweet-ready posts for @ChokepointMacro. Requirements: (1) Each tweet must be <280 chars, (2) Lead with the most impactful data point, (3) Include relevant $TICKER or #hashtags, (4) Mix of insight tweets, data callouts, and risk warnings, (5) Stagger content for posting throughout the day. Queue all posts as pending for approval before posting. Do NOT post directly — queue only.',
    run_endpoint: '/api/auto-schedule',
  },
];

// ── Weekly Task Definitions ──────────────────────────────────────────────────
// Deeper analysis, portfolio reviews, system health checks

const WEEKLY_OPS: OpsTask[] = [
  {
    agent_id: 'intelligence',
    agent_name: 'Intelligence (ORACLE)',
    title: 'Weekly Portfolio Risk Assessment',
    description: 'Comprehensive 7-day risk analysis with sector rotation, volatility regime, and positioning review.',
    priority: 'critical',
    risk_level: 'medium',
    risk_score: 5,
    estimated_cost: '$0.15',
    category: 'intelligence',
    prompt: 'Generate the weekly Armed Capital risk assessment. Deep analysis of: (1) 7-day returns and drawdowns across BTC, ETH, SOL, SPX, QQQ, DXY, GOLD, US10Y with context vs 30-day and 90-day trends, (2) Volatility regime classification — VIX level and term structure, realized vs implied vol divergence, crypto IV percentile, (3) Sector rotation from CFTC COT — which sectors are institutions rotating into/out of, (4) Yield curve evolution — shape changes, credit spread widening/tightening, (5) DeFi protocol health — TVL changes by chain, top protocol inflows/outflows, (6) Net positioning changes for key CME futures. Assign an overall portfolio risk score 1-10 with directional bias (risk-on / risk-off / neutral) and confidence level. Include a "What could go wrong" section with 3 tail risk scenarios.',
    run_endpoint: '/api/generate',
  },
  {
    agent_id: 'intelligence',
    agent_name: 'Intelligence (ORACLE)',
    title: 'Weekly BTC Confluence Signal Report',
    description: 'Cross-reference on-chain, macro, technical, and sentiment for a scored BTC directional thesis.',
    priority: 'high',
    risk_level: 'medium',
    risk_score: 5,
    estimated_cost: '$0.12',
    category: 'intelligence',
    prompt: 'Produce the weekly Bitcoin confluence signal report. Layer analysis: (1) Technical — weekly chart structure, key support/resistance, 200-week MA position, weekly RSI/MACD, (2) Macro — real rates trend, DXY weekly close, global M2 trajectory, (3) On-chain — exchange reserve trend, miner outflow behavior, long-term holder supply, MVRV ratio, (4) Sentiment — weekly Fear & Greed average, social volume trend, perpetual funding rate average, (5) Positioning — CFTC BTC futures net positioning, options max pain and put/call ratio, ETF flows. Score each layer 1-5 (bearish to bullish). Produce an overall confluence score, identify high-conviction vs low-conviction calls, and compare with last week\'s report for trend changes.',
    run_endpoint: '/api/generate',
  },
  {
    agent_id: 'market-scanner',
    agent_name: 'Market Scanner (SPECTRE)',
    title: 'Weekly FRED Rate Decision Analysis',
    description: 'Deep analysis of Fed-relevant data for rate path projections.',
    priority: 'high',
    risk_level: 'low',
    risk_score: 2,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Comprehensive weekly Fed rate analysis: (1) Full yield curve — DGS1M through DGS30 with week-over-week changes, (2) Inflation — T5YIE/T10YIE breakevens vs realized CPI, PCE, (3) Labor — ICSA claims trend, UNRATE, payrolls, (4) Financial conditions — DGS10 vs FEDFUNDS spread, (5) Fed funds futures implied probabilities for next 3 meetings, (6) Historical comparison — current curve shape vs prior hiking/cutting cycles. Produce a Fed rate path forecast with probability weightings for next 3 meetings.',
    run_endpoint: '/api/admin/agents/run',
  },
  {
    agent_id: 'data-enrichment',
    agent_name: 'Data Enrichment (MOSAIC)',
    title: 'Weekly Data Quality Audit',
    description: 'Audit all data source reliability, freshness, and accuracy over the past 7 days.',
    priority: 'medium',
    risk_level: 'low',
    risk_score: 2,
    estimated_cost: '$0.00',
    category: 'data',
    prompt: 'Audit all data enrichment sources for the past week: (1) Uptime — how many API calls succeeded vs failed per source, (2) Freshness — average data lag per source, any sources consistently stale, (3) Accuracy — any known data discrepancies or corrections, (4) Rate limits — how close to limits per source (FRED 120/min, Finnhub 60/min, CoinGecko 10-30/min), (5) Cost — any sources approaching paid tier thresholds, (6) Recommendations — sources to add, remove, or replace. Produce a data infrastructure health score 1-10.',
    run_endpoint: '/api/usage',
  },
  {
    agent_id: 'auto-scheduler',
    agent_name: 'Auto-Schedule Pipeline (BROADCASTER)',
    title: 'Weekly Social Performance Review',
    description: 'Analyze posting performance, engagement patterns, and content effectiveness over the past week.',
    priority: 'medium',
    risk_level: 'critical',
    risk_score: 9,
    estimated_cost: '$0.001',
    category: 'social',
    prompt: 'Review the past week\'s social posting performance for @ChokepointMacro: (1) Posts scheduled vs posted vs failed — success rate, (2) Posting cadence — gaps, bunching, optimal time analysis, (3) Content type performance — which topics/formats got the most engagement, (4) Error analysis — what caused failures, are they systemic, (5) Queue health — any stale pending posts, any orphaned content, (6) Recommendations — optimal posting schedule for next week, content themes to focus on. Produce actionable social ops plan for the coming week.',
    run_endpoint: '/api/auto-schedule',
  },
  {
    agent_id: 'intelligence',
    agent_name: 'Intelligence (ORACLE)',
    title: 'R&D Pipeline Review',
    description: 'Evaluate experimental data sources and models from the past week — ship/kill decisions.',
    priority: 'low',
    risk_level: 'medium',
    risk_score: 5,
    estimated_cost: '$0.15',
    category: 'intelligence',
    prompt: 'Review the R&D pipeline for Armed Capital: (1) Active experiments — what alternative data sources or analytical models are being tested, (2) Signal quality — which experiments are producing actionable signals vs noise, (3) Cost-benefit — cost of running each experiment vs value of insights generated, (4) Integration readiness — which experiments are ready to ship to production, (5) Kill list — experiments to terminate due to low ROI or data quality issues. Produce ship/continue/kill recommendation for each active experiment with justification.',
    run_endpoint: '/api/generate',
  },
];

// ── Execution Engine ─────────────────────────────────────────────────────────

async function executeOpsTask(
  task: OpsTask,
  supabase: any
): Promise<OpsResult> {
  const start = Date.now();
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const res = await fetch(`${baseUrl}${task.run_endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: task.prompt,
        agentId: task.agent_id,
        opsMode: true,
      }),
    });

    const elapsed = Date.now() - start;
    const costNum = elapsed * 0.00001;
    const cost = `$${costNum.toFixed(4)}`;

    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      const summary = result.summary || result.message || result.text?.slice(0, 500) || `Completed in ${elapsed}ms`;

      // Persist as agent_task in Supabase
      try {
        await supabase.from('agent_tasks').insert({
          agent_id: task.agent_id,
          title: task.title,
          description: task.description,
          status: 'completed',
          priority: task.priority,
          source: 'system',
          estimated_cost: task.estimated_cost,
          actual_cost: cost,
          prompt: task.prompt,
          run_endpoint: task.run_endpoint,
          result_summary: typeof summary === 'string' ? summary.slice(0, 2000) : JSON.stringify(summary).slice(0, 2000),
          result_content: JSON.stringify(result).slice(0, 50000),
          completed_at: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      return {
        agent_id: task.agent_id,
        agent_name: task.agent_name,
        task_title: task.title,
        status: 'completed',
        priority: task.priority,
        risk_level: task.risk_level,
        risk_score: task.risk_score,
        category: task.category,
        elapsed_ms: elapsed,
        cost,
        summary: typeof summary === 'string' ? summary.slice(0, 1000) : JSON.stringify(summary).slice(0, 1000),
      };
    } else {
      const errText = await res.text().catch(() => '');
      // Persist failure
      try {
        await supabase.from('agent_tasks').insert({
          agent_id: task.agent_id,
          title: task.title,
          description: task.description,
          status: 'failed',
          priority: task.priority,
          source: 'system',
          estimated_cost: task.estimated_cost,
          actual_cost: cost,
          prompt: task.prompt,
          run_endpoint: task.run_endpoint,
          result_summary: `HTTP ${res.status}: ${res.statusText}`,
          result_content: errText.slice(0, 10000),
        });
      } catch { /* non-critical */ }

      return {
        agent_id: task.agent_id,
        agent_name: task.agent_name,
        task_title: task.title,
        status: 'failed',
        priority: task.priority,
        risk_level: task.risk_level,
        risk_score: task.risk_score,
        category: task.category,
        elapsed_ms: elapsed,
        cost,
        summary: `HTTP ${res.status}: ${res.statusText}`,
        error: errText.slice(0, 500),
      };
    }
  } catch (err: any) {
    const elapsed = Date.now() - start;
    return {
      agent_id: task.agent_id,
      agent_name: task.agent_name,
      task_title: task.title,
      status: 'failed',
      priority: task.priority,
      risk_level: task.risk_level,
      risk_score: task.risk_score,
      category: task.category,
      elapsed_ms: elapsed,
      cost: '$0.00',
      summary: `Error: ${err.message}`,
      error: err.message,
    };
  }
}

function generateRecommendations(results: OpsResult[], type: 'daily' | 'weekly'): string[] {
  const recs: string[] = [];
  const failed = results.filter(r => r.status === 'failed');
  const criticalFailed = failed.filter(r => r.priority === 'critical' || r.risk_level === 'critical');
  const highRiskCompleted = results.filter(r => r.status === 'completed' && r.risk_score >= 7);
  const totalCost = results.reduce((sum, r) => sum + parseFloat(r.cost.replace('$', '')), 0);

  if (criticalFailed.length > 0) {
    recs.push(`URGENT: ${criticalFailed.length} critical task(s) failed — ${criticalFailed.map(f => f.agent_name).join(', ')}. Investigate immediately.`);
  }
  if (failed.length > 0 && failed.length <= 2) {
    recs.push(`${failed.length} task(s) failed. Check agent dependencies and API key status for: ${failed.map(f => f.agent_name).join(', ')}.`);
  }
  if (failed.length > 2) {
    recs.push(`${failed.length} tasks failed — possible systemic issue. Check Vercel function logs and API key rotation schedule.`);
  }
  if (highRiskCompleted.length > 0) {
    recs.push(`${highRiskCompleted.length} high-risk task(s) completed successfully. Review output of: ${highRiskCompleted.map(r => r.task_title).join(', ')}.`);
  }
  if (totalCost > 1.0) {
    recs.push(`Total ops cost $${totalCost.toFixed(2)} is elevated. Consider reducing report frequency or switching to lighter AI models for non-critical tasks.`);
  }
  if (results.every(r => r.status === 'completed')) {
    recs.push(`All ${type} ops completed successfully. System is running at full capacity.`);
  }
  if (type === 'weekly') {
    recs.push('Review the R&D pipeline report for ship/kill decisions on experimental data sources.');
    recs.push('Check social performance metrics and adjust posting cadence for the coming week.');
  }
  if (type === 'daily') {
    recs.push('Review queued social posts before they auto-publish on the next cron tick.');
  }

  return recs;
}

function buildSummary(type: 'daily' | 'weekly', results: OpsResult[], startedAt: string): OpsSummary {
  const completed = results.filter(r => r.status === 'completed');
  const failed = results.filter(r => r.status === 'failed');
  const skipped = results.filter(r => r.status === 'skipped');
  const totalCost = results.reduce((sum, r) => sum + parseFloat(r.cost.replace('$', '') || '0'), 0);
  const totalElapsed = results.reduce((sum, r) => sum + r.elapsed_ms, 0);

  // Risk assessment
  const riskScores = results.map(r => r.risk_score);
  const avgRisk = riskScores.length > 0 ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length : 0;
  const criticalRisk = results.filter(r => r.risk_level === 'critical').length;
  const highRisk = results.filter(r => r.risk_level === 'high').length;
  const highestRisk = criticalRisk > 0 ? 'critical' : highRisk > 0 ? 'high' : avgRisk > 5 ? 'medium' : 'low';

  let riskSummary = '';
  if (criticalRisk > 0) riskSummary = `${criticalRisk} critical-risk operations executed. External-facing agents (social posting) require manual review of queued content.`;
  else if (highRisk > 0) riskSummary = `${highRisk} high-risk operations completed. No critical risk agents triggered.`;
  else riskSummary = `All operations within acceptable risk parameters. Average risk score: ${avgRisk.toFixed(1)}/10.`;

  // Priority breakdown
  const priorities = { critical: 0, high: 0, medium: 0, low: 0 };
  results.forEach(r => { priorities[r.priority as keyof typeof priorities]++; });

  // Agent performance
  const agentMap = new Map<string, OpsResult[]>();
  results.forEach(r => {
    if (!agentMap.has(r.agent_id)) agentMap.set(r.agent_id, []);
    agentMap.get(r.agent_id)!.push(r);
  });

  const agentPerformance = Array.from(agentMap.entries()).map(([agentId, tasks]) => {
    const agentCompleted = tasks.filter(t => t.status === 'completed').length;
    const agentFailed = tasks.filter(t => t.status === 'failed').length;
    const agentCost = tasks.reduce((sum, t) => sum + parseFloat(t.cost.replace('$', '') || '0'), 0);
    const avgElapsed = tasks.reduce((sum, t) => sum + t.elapsed_ms, 0) / tasks.length;
    const rate = tasks.length > 0 ? agentCompleted / tasks.length : 0;
    const grade = rate >= 1.0 ? 'A' : rate >= 0.75 ? 'B' : rate >= 0.5 ? 'C' : rate > 0 ? 'D' : 'F';

    return {
      agent_id: agentId,
      agent_name: tasks[0].agent_name,
      tasks_run: tasks.length,
      tasks_completed: agentCompleted,
      tasks_failed: agentFailed,
      total_cost: `$${agentCost.toFixed(4)}`,
      avg_elapsed_ms: Math.round(avgElapsed),
      grade,
    };
  });

  return {
    id: `ops-${type}-${Date.now()}`,
    type,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    total_tasks: results.length,
    completed_tasks: completed.length,
    failed_tasks: failed.length,
    skipped_tasks: skipped.length,
    total_cost: `$${totalCost.toFixed(4)}`,
    total_elapsed_ms: totalElapsed,
    risk_assessment: {
      highest_risk: highestRisk,
      critical_count: criticalRisk,
      high_count: highRisk,
      avg_risk_score: Math.round(avgRisk * 10) / 10,
      risk_summary: riskSummary,
    },
    priority_breakdown: priorities,
    agent_performance: agentPerformance,
    results,
    recommendations: generateRecommendations(results, type),
  };
}

// ── GET: Return ops task definitions (preview before running) ────────────────

export async function GET(req: NextRequest) {
  try {
    await safeAuth();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'daily';

    const tasks = type === 'weekly' ? WEEKLY_OPS : DAILY_OPS;

    return NextResponse.json({
      type,
      tasks: tasks.map(t => ({
        agent_id: t.agent_id,
        agent_name: t.agent_name,
        title: t.title,
        description: t.description,
        priority: t.priority,
        risk_level: t.risk_level,
        risk_score: t.risk_score,
        estimated_cost: t.estimated_cost,
        category: t.category,
      })),
      total: tasks.length,
      estimated_total_cost: tasks.reduce((sum, t) => {
        const cost = parseFloat(t.estimated_cost.replace('$', ''));
        return sum + (isNaN(cost) ? 0 : cost);
      }, 0).toFixed(4),
    });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// ── POST: Execute daily or weekly ops ────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const body = await req.json();
    const { type = 'daily', taskIndex } = body;
    const supabase = createServerSupabase();
    const startedAt = new Date().toISOString();
    const allTasks = type === 'weekly' ? WEEKLY_OPS : DAILY_OPS;

    // Single task mode: run one task by index and return its result directly
    if (taskIndex !== undefined && taskIndex !== null) {
      const idx = Number(taskIndex);
      if (idx < 0 || idx >= allTasks.length) {
        return NextResponse.json({ error: `Invalid taskIndex ${idx}. Must be 0-${allTasks.length - 1}` }, { status: 400 });
      }
      const task = allTasks[idx];
      const result = await executeOpsTask(task, supabase);

      // Record spend
      try {
        const { recordSpend, logAuditEvent } = await import('@/lib/agentBus');
        const costNum = parseFloat(result.cost.replace('$', '') || '0');
        if (costNum > 0) recordSpend(task.agent_id, 'operations', costNum);
        await logAuditEvent({
          type: 'task_execution',
          agentId: task.agent_id,
          action: `[SINGLE TASK] ${result.status}: ${task.title}`,
          details: { opsType: type, priority: task.priority, status: result.status },
        });
      } catch { /* non-critical */ }

      // Persist to Supabase
      try {
        await supabase.from('agent_tasks').insert({
          agent_id: task.agent_id,
          title: task.title,
          description: task.description,
          status: result.status,
          priority: task.priority,
          source: 'manual',
          estimated_cost: task.estimated_cost,
          actual_cost: result.cost,
          result_summary: result.summary?.slice(0, 2000),
          completed_at: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      return NextResponse.json({ single: true, result });
    }

    const tasks = allTasks;

    // Execute tasks sequentially (respect rate limits, budget)
    // Sort by priority: critical > high > medium > low
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...tasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const results: OpsResult[] = [];
    for (const task of sorted) {
      // Log to audit
      try {
        const { logAuditEvent, checkBudget } = await import('@/lib/agentBus');
        const budgetCheck = checkBudget(task.agent_id, 'operations', 0.01);
        if (!budgetCheck.allowed) {
          results.push({
            agent_id: task.agent_id,
            agent_name: task.agent_name,
            task_title: task.title,
            status: 'skipped',
            priority: task.priority,
            risk_level: task.risk_level,
            risk_score: task.risk_score,
            category: task.category,
            elapsed_ms: 0,
            cost: '$0.00',
            summary: `Skipped — budget limit: ${budgetCheck.reason}`,
          });
          continue;
        }
        await logAuditEvent({
          type: 'task_execution',
          agentId: task.agent_id,
          action: `[${type.toUpperCase()} OPS] Starting: ${task.title}`,
          details: { opsType: type, priority: task.priority },
        });
      } catch { /* audit non-critical */ }

      const result = await executeOpsTask(task, supabase);
      results.push(result);

      // Record spend
      try {
        const { recordSpend } = await import('@/lib/agentBus');
        const costNum = parseFloat(result.cost.replace('$', '') || '0');
        if (costNum > 0) recordSpend(task.agent_id, 'operations', costNum);
      } catch { /* non-critical */ }
    }

    // Build summary report
    const summary = buildSummary(type, results, startedAt);

    // Persist summary to Supabase
    try {
      await supabase.from('ops_reports').insert({
        id: summary.id,
        type: summary.type,
        started_at: summary.started_at,
        completed_at: summary.completed_at,
        total_tasks: summary.total_tasks,
        completed_tasks: summary.completed_tasks,
        failed_tasks: summary.failed_tasks,
        total_cost: summary.total_cost,
        risk_summary: summary.risk_assessment.risk_summary,
        report_json: JSON.stringify(summary),
      });
    } catch { /* table may not exist — non-critical */ }

    // Notify
    try {
      const { addNotification } = await import('@/lib/agentBus');
      addNotification({
        type: summary.failed_tasks > 0 ? 'task_failed' : 'task_completed',
        title: `${type === 'weekly' ? 'Weekly' : 'Daily'} Ops Complete`,
        message: `${summary.completed_tasks}/${summary.total_tasks} tasks completed. Cost: ${summary.total_cost}`,
        agentId: 'system',
        severity: summary.failed_tasks > 0 ? 'warning' : 'success',
        actionUrl: '/agents',
      });
    } catch { /* non-critical */ }

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
