import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  agent_id: string;
  title: string;
  description: string;
  status: 'queued' | 'approved' | 'running' | 'completed' | 'ignored' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  source: 'system' | 'manual';
  result_summary: string | null;
  files_modified: string[] | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  estimated_cost: string | null;
  actual_cost: string | null;
  prompt: string | null;
  run_endpoint: string | null;
  result_content: string | null;
}

export interface ProductivityScore {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  tasksIgnored: number;
  tasksQueued: number;
  completionRate: number;      // 0-100
  avgCompletionTimeMs: number; // avg time from approved → completed
  totalCostUsd: number;
  costEfficiency: number;      // tasks per dollar (higher = better)
  streak: number;              // consecutive successful tasks
  lastActive: string | null;
  score: number;               // 0-100 composite productivity score
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

function calculateProductivity(agentId: string, tasks: TaskRow[]): ProductivityScore {
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed');
  const ignored = tasks.filter(t => t.status === 'ignored');
  const queued = tasks.filter(t => ['queued', 'approved', 'running'].includes(t.status));

  const totalActioned = completed.length + failed.length + ignored.length;
  const completionRate = totalActioned > 0 ? Math.round((completed.length / totalActioned) * 100) : 0;

  // Average completion time
  const completionTimes = completed
    .filter(t => t.completed_at && t.created_at)
    .map(t => new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime())
    .filter(t => t > 0);
  const avgCompletionTimeMs = completionTimes.length > 0
    ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
    : 0;

  // Cost tracking
  const totalCostUsd = completed.reduce((sum, t) => {
    const cost = parseFloat((t.actual_cost || t.estimated_cost || '0').replace('$', ''));
    return sum + (isNaN(cost) ? 0 : cost);
  }, 0);
  const costEfficiency = totalCostUsd > 0 ? Math.round(completed.length / totalCostUsd) : completed.length > 0 ? 999 : 0;

  // Streak (consecutive completed from most recent)
  const sorted = [...tasks].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  let streak = 0;
  for (const t of sorted) {
    if (t.status === 'completed') streak++;
    else if (['failed', 'ignored'].includes(t.status)) break;
  }

  const lastActive = sorted[0]?.updated_at || null;

  // Composite score (0-100)
  // 40% completion rate + 20% volume + 20% efficiency + 20% streak
  const volumeScore = Math.min(completed.length * 5, 100);
  const effScore = Math.min(costEfficiency * 2, 100);
  const streakScore = Math.min(streak * 10, 100);
  const score = Math.round(completionRate * 0.4 + volumeScore * 0.2 + effScore * 0.2 + streakScore * 0.2);

  const grade: ProductivityScore['grade'] =
    score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';

  return {
    agentId,
    tasksCompleted: completed.length,
    tasksFailed: failed.length,
    tasksIgnored: ignored.length,
    tasksQueued: queued.length,
    completionRate,
    avgCompletionTimeMs,
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    costEfficiency,
    streak,
    lastActive,
    score,
    grade,
  };
}

// ── GET: Fetch tasks + productivity for a specific agent ─────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await safeAuth();
    const { id: agentId } = await params;
    const supabase = createServerSupabase();

    // Fetch tasks from Supabase
    const { data: tasks, error } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      // Table might not exist yet — return mock data
      const mockQueued = generateDefaultTasks(agentId, 'queued');
      const mockCompleted = generateDefaultTasks(agentId, 'completed');
      const allMock = [...mockQueued, ...mockCompleted];
      return NextResponse.json({
        agentId,
        queued: mockQueued,
        completed: mockCompleted,
        productivity: calculateProductivity(agentId, allMock as TaskRow[]),
        source: 'mock',
      });
    }

    const queued = (tasks || []).filter((t: TaskRow) =>
      ['queued', 'approved', 'running'].includes(t.status)
    );
    const completed = (tasks || []).filter((t: TaskRow) =>
      ['completed', 'failed', 'ignored'].includes(t.status)
    );

    return NextResponse.json({
      agentId,
      queued,
      completed,
      productivity: calculateProductivity(agentId, tasks as TaskRow[]),
      source: 'supabase',
    });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// ── POST: Create / update / execute tasks ────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await safeAuth();
    const { id: agentId } = await params;
    const body = await req.json();
    const { action } = body;
    const supabase = createServerSupabase();

    switch (action) {
      case 'add': {
        const { title, description, priority = 'medium', prompt, runEndpoint } = body;
        if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

        const { data, error } = await supabase
          .from('agent_tasks')
          .insert({
            agent_id: agentId,
            title,
            description: description || '',
            status: 'queued',
            priority,
            source: 'manual',
            prompt: prompt || null,
            run_endpoint: runEndpoint || null,
          })
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ task: data, action: 'added' });
      }

      case 'approve': {
        const { taskId } = body;
        const { data, error } = await supabase
          .from('agent_tasks')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', taskId)
          .eq('agent_id', agentId)
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ task: data, action: 'approved' });
      }

      case 'deny':
      case 'ignore': {
        const { taskId } = body;
        const { data, error } = await supabase
          .from('agent_tasks')
          .update({ status: 'ignored', updated_at: new Date().toISOString() })
          .eq('id', taskId)
          .eq('agent_id', agentId)
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ task: data, action: 'denied' });
      }

      case 'execute': {
        // Execute an approved task by calling its run endpoint
        const { taskId } = body;

        // Budget check before execution
        try {
          const { checkBudget, recordSpend, logAuditEvent, routeModel, addNotification } = await import('@/lib/agentBus');
          const estimatedCost = 0.01; // Default estimate per task
          const budgetCheck = checkBudget(agentId, 'operations', estimatedCost);
          if (!budgetCheck.allowed) {
            await logAuditEvent({
              type: 'budget_event',
              agentId,
              action: `Task ${taskId} blocked by budget: ${budgetCheck.reason}`,
              details: { taskId, reason: budgetCheck.reason },
            });
            addNotification({
              type: 'budget_exceeded',
              title: 'Task Blocked by Budget',
              message: `${agentId}: ${budgetCheck.reason}`,
              agentId,
              severity: 'error',
              actionUrl: `/agents/${agentId}`,
            });
            return NextResponse.json({ error: budgetCheck.reason, budgetBlocked: true }, { status: 429 });
          }
        } catch { /* budget module not critical */ }

        // Mark as running
        const { data: task, error: fetchErr } = await supabase
          .from('agent_tasks')
          .update({ status: 'running', updated_at: new Date().toISOString() })
          .eq('id', taskId)
          .eq('agent_id', agentId)
          .select()
          .single();

        if (fetchErr || !task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

        // Multi-model routing
        let selectedModel: string | undefined;
        try {
          const { routeModel } = await import('@/lib/agentBus');
          const route = routeModel(agentId);
          selectedModel = route.model;
        } catch { /* fallback to default */ }

        // Execute asynchronously (don't block the response)
        const runEndpoint = task.run_endpoint;
        const prompt = task.prompt;

        if (runEndpoint && prompt) {
          // Fire and forget — execution happens in background
          executeTask(supabase, task, runEndpoint, prompt, selectedModel).catch(err => {
            console.error(`[Agent ${agentId}] Task ${taskId} execution failed:`, err);
          });
        }

        // Log to audit
        try {
          const { logAuditEvent } = await import('@/lib/agentBus');
          await logAuditEvent({
            type: 'task_execution',
            agentId,
            action: `Executing task: ${task.title}`,
            details: { taskId, runEndpoint, model: selectedModel },
            modelUsed: selectedModel,
          });
        } catch { /* audit not critical */ }

        return NextResponse.json({ task, action: 'executing', model: selectedModel });
      }

      case 'complete': {
        const { taskId, resultSummary, filesModified, actualCost } = body;
        const { data, error } = await supabase
          .from('agent_tasks')
          .update({
            status: 'completed',
            result_summary: resultSummary || null,
            files_modified: filesModified || null,
            actual_cost: actualCost || null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', taskId)
          .eq('agent_id', agentId)
          .select()
          .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ task: data, action: 'completed' });
      }

      case 'seed': {
        // Seed default tasks for this agent into Supabase
        const mockTasks = generateDefaultTasks(agentId, 'queued');
        if (mockTasks.length === 0) return NextResponse.json({ seeded: 0 });

        const { data, error } = await supabase
          .from('agent_tasks')
          .insert(mockTasks.map(t => ({
            agent_id: agentId,
            title: t.title,
            description: t.description,
            status: 'queued',
            priority: t.priority,
            source: 'system',
            estimated_cost: t.estimated_cost,
            prompt: t.prompt,
            run_endpoint: t.run_endpoint,
          })))
          .select();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ seeded: data?.length || 0, tasks: data });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// ── Task Execution Engine ────────────────────────────────────────────────────

async function executeTask(supabase: any, task: any, runEndpoint: string, prompt: string, model?: string) {
  const startTime = Date.now();
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}${runEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, taskId: task.id, agentId: task.agent_id, model }),
    });

    const elapsed = Date.now() - startTime;
    const costEstimate = `$${(elapsed * 0.00001).toFixed(4)}`;

    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      const fullContent = result.content || result.text || result.report || result.output || result.summary || JSON.stringify(result, null, 2);
      await supabase
        .from('agent_tasks')
        .update({
          status: 'completed',
          result_summary: result.summary || result.message || `Task completed in ${elapsed}ms`,
          result_content: typeof fullContent === 'string' ? fullContent.slice(0, 50000) : JSON.stringify(fullContent).slice(0, 50000),
          actual_cost: costEstimate,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      // Record spend + audit
      try {
        const { recordSpend, logAuditEvent, addNotification } = await import('@/lib/agentBus');
        const costNum = elapsed * 0.00001;
        recordSpend(task.agent_id, 'operations', costNum);
        await logAuditEvent({
          type: 'task_execution',
          agentId: task.agent_id,
          action: `Task completed: ${task.title}`,
          details: { taskId: task.id, elapsed, model },
          latencyMs: elapsed,
          modelUsed: model,
          costUsd: costNum,
        });
        addNotification({
          type: 'task_completed',
          title: `Task Completed: ${task.title}`,
          message: result.summary || `Executed in ${elapsed}ms`,
          agentId: task.agent_id,
          severity: 'success',
          actionUrl: `/agents/${task.agent_id}`,
        });
      } catch { /* bus not critical */ }
    } else {
      const errBody = await res.text().catch(() => '');
      await supabase
        .from('agent_tasks')
        .update({
          status: 'failed',
          result_summary: `HTTP ${res.status}: ${res.statusText}. Elapsed: ${elapsed}ms`,
          result_content: errBody.slice(0, 10000) || null,
          actual_cost: costEstimate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      try {
        const { logAuditEvent, addNotification } = await import('@/lib/agentBus');
        await logAuditEvent({
          type: 'agent_error',
          agentId: task.agent_id,
          action: `Task failed: ${task.title} (HTTP ${res.status})`,
          details: { taskId: task.id, status: res.status, elapsed },
          latencyMs: elapsed,
        });
        addNotification({
          type: 'task_failed',
          title: `Task Failed: ${task.title}`,
          message: `HTTP ${res.status}: ${res.statusText}`,
          agentId: task.agent_id,
          severity: 'error',
          actionUrl: `/agents/${task.agent_id}`,
        });
      } catch { /* bus not critical */ }
    }
  } catch (err: any) {
    await supabase
      .from('agent_tasks')
      .update({
        status: 'failed',
        result_summary: `Execution error: ${err.message}`,
        result_content: err.stack || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    try {
      const { logAuditEvent, addNotification } = await import('@/lib/agentBus');
      await logAuditEvent({
        type: 'agent_error',
        agentId: task.agent_id,
        action: `Task error: ${err.message}`,
        details: { taskId: task.id, error: err.message },
      });
      addNotification({
        type: 'task_failed',
        title: `Task Error`,
        message: err.message,
        agentId: task.agent_id,
        severity: 'error',
      });
    } catch { /* bus not critical */ }
  }
}

// ── Domain-Specific Task Definitions with Prompts ───────────────────────────
// Each agent gets actionable tasks tied to their exact domain + AI prompts to execute

interface TaskTemplate {
  title: string;
  description: string;
  priority: TaskRow['priority'];
  estimated_cost: string;
  prompt: string;
  run_endpoint: string;
}

const AGENT_TASK_TEMPLATES: Record<string, TaskTemplate[]> = {

  // ── INTELLIGENCE (ORACLE) ──────────────────────────────────────────────────
  'intelligence': [
    {
      title: 'Generate morning macro intelligence brief',
      description: 'Compile FRED, BLS, CFTC, Treasury, Finnhub, CoinGecko, Fear & Greed, DefiLlama, and TradingView data into a comprehensive daily macro report.',
      priority: 'high',
      estimated_cost: '$0.08',
      prompt: 'Generate a comprehensive daily macro intelligence brief for Armed Capital. Cover: (1) Treasury yields and rate expectations, (2) Equity market structure — SPX, QQQ positioning, (3) Crypto market — BTC dominance, ETH/SOL relative strength, DeFi TVL trends, (4) Macro indicators — CPI, employment, CFTC positioning, TGA balance, (5) Sentiment — Fear & Greed index, put/call ratios, (6) Key risks and catalysts for next 48 hours. Use all enriched data sources. Format as a structured intelligence brief with confidence ratings per section.',
      run_endpoint: '/api/generate',
    },
    {
      title: 'Run R&D experiment: new data source evaluation',
      description: 'Test integration of a new alternative data source and benchmark its signal quality against existing enrichment pipeline.',
      priority: 'medium',
      estimated_cost: '$0.15',
      prompt: 'Evaluate potential new data sources for Armed Capital intelligence pipeline. For each candidate: (1) Test API accessibility and data freshness, (2) Measure signal-to-noise ratio vs existing sources, (3) Assess cost and rate limits, (4) Score correlation with BTC price action over last 30 days. Candidates to evaluate: Glassnode on-chain metrics, Santiment social volume, Alternative.me extended data. Produce a ship/kill recommendation for each.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Produce weekly portfolio risk summary',
      description: 'Aggregate 7-day market movements and generate risk assessment narrative with sector rotation analysis.',
      priority: 'medium',
      estimated_cost: '$0.12',
      prompt: 'Generate a weekly portfolio risk summary for Armed Capital. Analyze: (1) 7-day returns across BTC, ETH, SOL, SPX, QQQ, DXY, GOLD, US10Y, (2) Volatility regime — VIX trend, realized vs implied vol, (3) Sector rotation signals from CFTC COT data, (4) Yield curve shape and credit spreads, (5) DeFi protocol TVL changes by chain, (6) Net positioning changes for key futures. Assign an overall risk score 1-10 with directional bias.',
      run_endpoint: '/api/generate',
    },
    {
      title: 'Create BTC confluence signal report',
      description: 'Cross-reference on-chain, macro, technical, and sentiment signals for BTC to produce a confluence-scored directional thesis.',
      priority: 'high',
      estimated_cost: '$0.10',
      prompt: 'Produce a Bitcoin confluence signal report. Layer: (1) Technical — TradingView signals, support/resistance, trend structure, (2) Macro — real rates, dollar strength, liquidity conditions, (3) On-chain — exchange flows, miner behavior, whale accumulation, (4) Sentiment — Fear & Greed, social volume, funding rates, (5) Positioning — CFTC BTC futures, options skew. Score each layer 1-5 (bearish to bullish) and produce an overall confluence score with high-conviction vs low-conviction calls.',
      run_endpoint: '/api/generate',
    },
  ],

  // ── MARKET SCANNER (SPECTRE) ──────────────────────────────────────────────
  'market-scanner': [
    {
      title: 'Scan FRED for rate decision signals',
      description: 'Pull latest treasury yields, CPI, and employment data for Fed meeting prep.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Fetch and analyze the latest FRED data: DGS2, DGS5, DGS10, DGS30 (yield curve shape), T10Y2Y (spread), T5YIE/T10YIE (inflation breakevens), ICSA (jobless claims), FEDFUNDS. Flag any significant moves (>10bps) since last scan. Report yield curve inversion status and probability of next Fed action.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Monitor crypto whale movements',
      description: 'Check CoinGecko top 10 and DeFi TVL for large shifts indicating whale positioning.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Scan CoinGecko top 10 cryptocurrencies by market cap. Flag: (1) Any 24h volume spike >2x 7-day average, (2) Any price move >5% in 24h, (3) BTC dominance shift, (4) DeFi TVL changes >5% on any top-10 chain, (5) Stablecoin market cap changes. Report anomalies with severity rating.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Refresh all enrichment data sources',
      description: 'Force-refresh cached data across all 9+ sources and verify data freshness.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Force-refresh all data caches: FRED (yield curve, breakevens, claims), Finnhub (market quotes), CoinGecko (crypto top 10), CNN Fear & Greed, BLS (CPI, PPI, employment), CFTC COT (E-mini, 10Y, Gold, Euro FX, BTC), Treasury (TGA, debt, rates), DefiLlama (TVL, stablecoins). Report freshness timestamps and any sources that failed or returned stale data.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── DATA ENRICHMENT (MOSAIC) ──────────────────────────────────────────────
  'data-enrichment': [
    {
      title: 'Cross-reference macro vs price divergences',
      description: 'Compare FRED/BLS macro indicators against market price action to flag disconnects.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Analyze divergences between macro data and market prices: (1) Real rates vs GOLD price, (2) Yield curve shape vs SPX trend, (3) DXY strength vs BTC trend, (4) CFTC net positioning vs actual price direction, (5) Fear & Greed vs realized volatility. Flag any divergences that historically precede mean-reversion.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Build enriched context for AI reports',
      description: 'Run full parallel fetch of all 10 data sources and merge into unified prompt context block.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Execute fetchAllEnrichedData() and produce the full enrichedDataToPromptBlock(). Report: (1) All 10 sources status (available/unavailable), (2) Total data points collected, (3) Any sources returning stale data (>2h old), (4) Combined prompt block character count, (5) Data quality score 0-100 based on coverage.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── TRADINGVIEW RELAY (HAWKEYE) ───────────────────────────────────────────
  'tradingview-relay': [
    {
      title: 'Process incoming TradingView alerts',
      description: 'Monitor webhook endpoint for new signals and route to appropriate market charts.',
      priority: 'critical',
      estimated_cost: '$0.00',
      prompt: 'Check TradingView webhook buffer for unprocessed signals. For each: (1) Validate secret matches, (2) Normalize ticker to internal format, (3) Match to active chart symbol, (4) Store in signal buffer with price/action/timestamp, (5) Flag any confluence with other signals on same ticker within 4h window.',
      run_endpoint: '/api/webhooks/tradingview',
    },
    {
      title: 'Verify WebSocket connection health',
      description: 'Check TradingView WS connection status, session validity, and quote freshness.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Check TradingView WebSocket health: (1) Connection status (connected/disconnected), (2) Authentication status (Plus/Free), (3) Session validity, (4) Number of symbols streaming, (5) Quote freshness — flag any quotes older than 2 minutes. If session expired, flag for re-authentication.',
      run_endpoint: '/api/tradingview/session',
    },
  ],

  // ── REVOPS (VANGUARD) ─────────────────────────────────────────────────────
  'revops': [
    {
      title: 'Generate content from latest intelligence brief',
      description: 'Transform the most recent ORACLE intelligence report into social media content threads for X.',
      priority: 'high',
      estimated_cost: '$0.05',
      prompt: 'Take the latest intelligence report and produce: (1) A 5-7 tweet thread summarizing key findings — punchy, data-driven, Armed Capital voice, (2) A one-liner "macro take" for quick posting, (3) A newsletter intro paragraph (3-4 sentences), (4) 2-3 chart caption suggestions. Tone: authoritative but accessible, no financial advice disclaimers inline (add at thread end). Use $BTC, $ETH, $SPX formatting.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Analyze pipeline conversion metrics',
      description: 'Pull signup, engagement, and subscription data to produce conversion funnel analysis.',
      priority: 'medium',
      estimated_cost: '$0.01',
      prompt: 'Query user data to produce pipeline report: (1) Total signups this week, (2) Active users (visited in last 7 days), (3) Report generation count per user tier, (4) Conversion rate from free → generating reports, (5) Power user identification (>5 reports this week), (6) Churn risk — users with declining activity. Rank top 10 users by engagement.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Optimize X posting schedule',
      description: 'Analyze historical engagement data to find optimal posting times for maximum reach.',
      priority: 'low',
      estimated_cost: '$0.02',
      prompt: 'Analyze Armed Capital X posting history: (1) Best performing post times by day of week, (2) Engagement rate by content type (thread vs single tweet), (3) Optimal thread length (tweets per thread vs engagement), (4) Hashtag performance, (5) Follower growth correlation with posting frequency. Produce a recommended weekly schedule.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── AUTO-SCHEDULER (BROADCASTER) ──────────────────────────────────────────
  'auto-scheduler': [
    {
      title: 'Schedule next intelligence brief distribution',
      description: 'Queue tomorrow\'s 6:30 AM EST auto-brief generation and social distribution pipeline.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Configure the next scheduled intelligence brief: (1) Set generation time to 6:30 AM EST, (2) Queue enrichment data refresh for 6:25 AM, (3) Set social distribution for 7:00 AM (thread), 12:30 PM (midday update), 4:15 PM (close recap), (4) Enable auto-retry if generation fails, (5) Set webhook notification on completion.',
      run_endpoint: '/api/cron',
    },
    {
      title: 'Queue market event coverage',
      description: 'Pre-schedule content around upcoming known market events (FOMC, CPI release, earnings).',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Scan economic calendar for upcoming events this week. For each event: (1) Create pre-event analysis post (schedule 2h before), (2) Create real-time reaction post template (queue for manual trigger), (3) Create post-event summary post (schedule 1h after), (4) Set data refresh cadence to 5min during event window.',
      run_endpoint: '/api/cron',
    },
  ],

  // ── IT (BASTION) ──────────────────────────────────────────────────────────
  'it': [
    {
      title: 'Run full infrastructure health sweep',
      description: 'Check Vercel, Supabase, all external APIs, DNS, and credential status.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Execute comprehensive health check: (1) Vercel deployment status, (2) Supabase connectivity + row counts for key tables, (3) All API key validation (20+ keys), (4) External API endpoint latency (FRED, Finnhub, CoinGecko, BLS, CFTC, Treasury, DefiLlama), (5) TradingView WebSocket status, (6) DNS resolution, (7) SSL certificate expiry. Flag any degraded services.',
      run_endpoint: '/api/usage',
    },
    {
      title: 'Audit API key expiration and rotation',
      description: 'Scan every configured key and flag those needing rotation or nearing expiration.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Inventory all API keys: (1) List each key with masked value, (2) Test connectivity for each, (3) Check rate limit headers for usage %, (4) Flag any keys returning 401/403, (5) Identify keys not used in codebase (orphaned), (6) Report credential hygiene score 0-100.',
      run_endpoint: '/api/admin/keys',
    },
    {
      title: 'Verify database backup and integrity',
      description: 'Check Supabase backup status, table integrity, and storage usage.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Check Supabase database health: (1) Point-in-time recovery status, (2) Table row counts — reports, scheduled_posts, platform_tokens, users, agent_tasks, tradingview_signals, (3) Storage usage vs limits, (4) Index health, (5) Any failed migrations or schema drift. Report overall DB health score.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── ENGINEER (FORGE) ──────────────────────────────────────────────────────
  'engineer': [
    {
      title: 'Audit Next.js build health',
      description: 'Check for TypeScript errors, unused imports, bundle size, and deployment readiness.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Run platform health audit: (1) TypeScript compilation status, (2) ESLint error count, (3) Bundle size analysis — largest chunks, (4) API route count and cold start estimates, (5) Middleware configuration, (6) Environment variable completeness. Report deployment readiness score.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Review API rate limit usage across all services',
      description: 'Aggregate rate limit data from all external APIs to identify throttling risks.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Collect rate limit data from: Anthropic (messages), OpenAI (tokens), Gemini (RPM), FRED (daily limit), Finnhub (calls/min), X API (tweets/15min). For each: (1) Current usage vs limit, (2) Reset window, (3) Projected exhaustion time at current rate, (4) Recommended throttle settings. Flag any service above 70% usage.',
      run_endpoint: '/api/usage',
    },
  ],

  // ── DEV (ARCHITECT) ───────────────────────────────────────────────────────
  'dev': [
    {
      title: 'Generate API documentation snapshot',
      description: 'Catalog all API routes with their methods, parameters, and response formats.',
      priority: 'low',
      estimated_cost: '$0.02',
      prompt: 'Scan the Armed Capital codebase API routes under /api/. For each route: (1) HTTP methods supported, (2) Authentication required?, (3) Parameters and body schema, (4) Response format, (5) Rate limiting. Produce a Markdown API reference document.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Identify dead code and unused dependencies',
      description: 'Scan codebase for unused imports, unreferenced components, and unnecessary npm packages.',
      priority: 'low',
      estimated_cost: '$0.00',
      prompt: 'Analyze Armed Capital codebase: (1) Unused npm dependencies (in package.json but not imported), (2) Unreferenced React components, (3) Dead API routes (defined but not called from frontend), (4) Unused TypeScript interfaces/types, (5) Recommended cleanup actions with estimated bundle size savings.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── BOOKKEEPING (LEDGER) ──────────────────────────────────────────────────
  'bookkeeping': [
    {
      title: 'Calculate daily API spend',
      description: 'Aggregate all AI provider costs from today\'s report generation activity.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Calculate Armed Capital operational costs for today: (1) Anthropic API token usage and cost, (2) OpenAI fallback usage, (3) Gemini usage, (4) Total reports generated, (5) Average cost per report, (6) Projected monthly burn rate at current pace. Compare to yesterday and flag any anomalies.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Produce weekly P&L summary',
      description: 'Compile revenue (subscriptions), costs (API + infra), and net position for the week.',
      priority: 'high',
      estimated_cost: '$0.01',
      prompt: 'Generate Armed Capital weekly P&L: (1) Revenue — subscription count × tier pricing, (2) Costs — AI API calls, Vercel hosting, Supabase, domain, (3) Gross margin, (4) Cost per user, (5) Revenue per user, (6) Runway estimate at current burn. Format as a financial summary table.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── ASSET MANAGEMENT (VAULT) ──────────────────────────────────────────────
  'asset-management': [
    {
      title: 'Generate portfolio allocation snapshot',
      description: 'Produce current portfolio composition with performance attribution across asset classes.',
      priority: 'high',
      estimated_cost: '$0.05',
      prompt: 'Generate a portfolio allocation report: (1) Asset class weights — crypto, equities, fixed income, commodities, cash, (2) Top holdings by position size, (3) 7-day and 30-day attribution per asset, (4) Risk-adjusted returns (Sharpe, Sortino estimates), (5) Correlation matrix of top holdings, (6) Rebalancing recommendations if any position exceeds target weight by >5%.',
      run_endpoint: '/api/generate',
    },
    {
      title: 'Monitor watchlist price alerts',
      description: 'Check all watchlist tickers against alert thresholds and key technical levels.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Scan watchlist tickers: For each symbol check (1) Distance from 50-day MA, (2) RSI extremes (>70 or <30), (3) Volume anomalies (>2x average), (4) Proximity to pivot support/resistance levels, (5) TradingView signal status. Generate alert list sorted by urgency.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── PRIVATE EQUITY (APEX) ─────────────────────────────────────────────────
  'private-equity': [
    {
      title: 'Screen deal flow pipeline',
      description: 'Evaluate inbound deal opportunities against Armed Capital investment criteria.',
      priority: 'high',
      estimated_cost: '$0.05',
      prompt: 'Review deal pipeline: For each opportunity evaluate (1) Market size and growth rate, (2) Team background and track record, (3) Revenue model and unit economics, (4) Competitive landscape, (5) Alignment with Armed Capital thesis (fintech, crypto infrastructure, AI/ML tooling), (6) Valuation reasonableness. Score each deal 1-10 and rank.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Produce LP update report',
      description: 'Generate quarterly update for limited partners covering fund performance and portfolio activity.',
      priority: 'medium',
      estimated_cost: '$0.08',
      prompt: 'Draft LP quarterly update: (1) Fund performance vs benchmark, (2) Portfolio company updates — revenue, milestones, headcount, (3) New investments made this quarter, (4) Exits and distributions, (5) Market outlook and positioning, (6) Fund metrics — DPI, TVPI, IRR. Tone: professional, data-driven, cautiously optimistic.',
      run_endpoint: '/api/generate',
    },
  ],

  // ── PASSIVE PARTNER (ANCHOR) ──────────────────────────────────────────────
  'passive-partner': [
    {
      title: 'Generate investor relations digest',
      description: 'Compile fund performance, market outlook, and key updates for passive investors.',
      priority: 'medium',
      estimated_cost: '$0.03',
      prompt: 'Create a monthly investor relations digest: (1) Fund NAV and performance summary, (2) Market environment overview (macro + crypto), (3) Key portfolio events, (4) Upcoming catalysts, (5) Risk factors to monitor, (6) Next distribution date. Format for email distribution. Tone: clear, professional, reassuring.',
      run_endpoint: '/api/generate',
    },
  ],

  // ── ACTIVE PARTNER (COMMANDER) ────────────────────────────────────────────
  'active-partner': [
    {
      title: 'Generate executive dashboard briefing',
      description: 'Produce a C-suite overview of all agent activity, platform health, and key metrics.',
      priority: 'critical',
      estimated_cost: '$0.05',
      prompt: 'Generate an executive briefing for Armed Capital leadership: (1) Agent fleet status — operational/degraded/offline count, (2) Platform health score, (3) Content pipeline status — posts scheduled/published/failed, (4) Revenue metrics — MRR, subscriber count, churn rate, (5) Intelligence output — reports generated this week, (6) Key risks requiring attention, (7) Top priorities for next 48 hours. Format as a 1-page executive summary.',
      run_endpoint: '/api/generate',
    },
    {
      title: 'Review and approve pending agent tasks',
      description: 'Audit all queued tasks across the agent fleet and approve/deny based on priority and risk.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Review all pending tasks across the agent fleet: (1) List all queued tasks by agent, (2) Flag any tasks with critical priority, (3) Flag any tasks with estimated cost >$0.10, (4) Flag any tasks that publish externally, (5) Recommend approve/deny for each with reasoning. Sort by priority × risk.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── HR (GUARDIAN) ─────────────────────────────────────────────────────────
  'hr': [
    {
      title: 'Run agent fleet health assessment',
      description: 'Evaluate all 17 agents for dependency health, risk posture, and operational readiness.',
      priority: 'high',
      estimated_cost: '$0.00',
      prompt: 'Conduct agent fleet assessment: For each of the 17 agents evaluate (1) Dependency health (configured/total), (2) Last activity timestamp, (3) Task completion rate, (4) Error rate, (5) Risk score. Produce a fleet-wide health matrix with overall readiness score. Flag any agents in degraded state or with >24h inactivity.',
      run_endpoint: '/api/admin/agents',
    },
    {
      title: 'Generate agent performance rankings',
      description: 'Rank all agents by productivity score, completion rate, and cost efficiency.',
      priority: 'medium',
      estimated_cost: '$0.00',
      prompt: 'Produce agent performance leaderboard: Rank all 17 agents by (1) Productivity score (composite), (2) Task completion rate, (3) Cost efficiency (tasks per dollar), (4) Current streak, (5) Grade (S/A/B/C/D/F). Highlight top 3 performers and bottom 3 underperformers. Recommend improvement actions for underperformers.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── END USER DEPLOYMENT (BEACON) ──────────────────────────────────────────
  'end-user-deployment': [
    {
      title: 'Validate latest report quality',
      description: 'Run quality checks on the most recent intelligence report — accuracy, freshness, tone.',
      priority: 'high',
      estimated_cost: '$0.01',
      prompt: 'Quality-check the latest intelligence report: (1) Data freshness — are all cited data points from today?, (2) Accuracy — do numbers match source APIs?, (3) Tone compliance — matches Armed Capital editorial voice?, (4) Completeness — all required sections present?, (5) Length within target range (2000-6000 words)?, (6) No hallucinated data points? Produce a quality scorecard with pass/fail per criterion.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Analyze user engagement patterns',
      description: 'Track user journey from signup to report generation and identify drop-off points.',
      priority: 'medium',
      estimated_cost: '$0.01',
      prompt: 'Analyze user engagement: (1) New signups this week, (2) Time to first report generation (avg), (3) Reports per user per week distribution, (4) Feature usage breakdown — Markets, Reports, Terminal, Scanner, (5) Churn risk users (activity dropped >50% WoW), (6) Power user identification (top 10% by engagement). Recommend UX improvements for biggest drop-off point.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Run cross-agent output audit',
      description: 'Validate outputs from ORACLE, VANGUARD, and BROADCASTER for consistency and quality.',
      priority: 'medium',
      estimated_cost: '$0.02',
      prompt: 'Audit recent outputs across agents: (1) ORACLE — last 3 reports quality score, (2) VANGUARD — last 5 social posts engagement + brand compliance, (3) BROADCASTER — scheduled posts timing accuracy, (4) Cross-agent consistency — do social posts accurately reflect intelligence reports?, (5) Error rate across all agents this week. Flag any quality regressions.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],

  // ── ARES HUNTER (ARES) ────────────────────────────────────────────────────
  'ares-hunter': [
    {
      title: 'Process and score TradingView signals',
      description: 'Analyze incoming TV signals, cross-reference with macro data, and produce confluence scores.',
      priority: 'critical',
      estimated_cost: '$0.02',
      prompt: 'Process TradingView signal pipeline: (1) Fetch all unprocessed signals from buffer, (2) For each signal: cross-reference ticker against FRED macro regime (risk-on/risk-off), DXY trend, VIX level, CFTC positioning, (3) Score signal confluence 1-10 based on alignment count, (4) Flag high-confluence signals (>7) for immediate attention, (5) Update watchlist priority rankings based on signal density.',
      run_endpoint: '/api/admin/agents/run',
    },
    {
      title: 'Generate trade thesis validation',
      description: 'Take a directional thesis and stress-test it against all available data sources.',
      priority: 'high',
      estimated_cost: '$0.05',
      prompt: 'Validate the current macro thesis: "Risk assets positioned for relief rally on dovish Fed pivot expectation." Test against: (1) Yield curve signal, (2) Fed funds futures pricing, (3) Credit spreads, (4) CFTC positioning (crowded?), (5) DXY momentum, (6) BTC correlation regime, (7) Sentiment extremes. For each data point: confirm/deny thesis with confidence %. Produce overall thesis conviction score.',
      run_endpoint: '/api/generate',
    },
    {
      title: 'Update watchlist priority rankings',
      description: 'Re-rank all watchlist tickers based on signal strength, macro alignment, and technical setup.',
      priority: 'medium',
      estimated_cost: '$0.01',
      prompt: 'Re-rank watchlist priorities: For each watched ticker evaluate (1) TradingView signal recency and direction, (2) Macro alignment score (how well does this asset fit the current regime), (3) Technical setup quality (trend, momentum, volume), (4) Risk/reward ratio estimate, (5) Catalyst proximity. Produce ranked list with action recommendations: accumulate, hold, reduce, or watch.',
      run_endpoint: '/api/admin/agents/run',
    },
  ],
};

// ── Default Task Generator ──────────────────────────────────────────────────

function generateDefaultTasks(agentId: string, type: 'queued' | 'completed'): any[] {
  const now = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  if (type === 'queued') {
    const templates = AGENT_TASK_TEMPLATES[agentId];
    if (templates) {
      return templates.map((t, i) => ({
        id: `${agentId}-q${i}`,
        agent_id: agentId,
        title: t.title,
        description: t.description,
        status: 'queued',
        priority: t.priority,
        source: 'system',
        result_summary: null,
        files_modified: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
        estimated_cost: t.estimated_cost,
        actual_cost: null,
        prompt: t.prompt,
        run_endpoint: t.run_endpoint,
      }));
    }
    // Generic fallback
    return [
      { id: `${agentId}-q0`, agent_id: agentId, title: 'Run diagnostic self-check', description: 'Verify all dependencies and capabilities are operational.', status: 'queued', priority: 'medium', source: 'system', result_summary: null, files_modified: null, created_at: now, updated_at: now, completed_at: null, estimated_cost: '$0.00', actual_cost: null, prompt: 'Run a diagnostic self-check. Verify all dependencies, test connectivity to required services, and report operational status.', run_endpoint: '/api/admin/agents/run' },
    ];
  }

  // Completed tasks (mock history)
  return [
    { id: `${agentId}-c0`, agent_id: agentId, title: 'System initialization', description: 'Agent registered and dependencies checked.', status: 'completed', priority: 'medium', source: 'system', result_summary: 'Agent operational. All configured dependencies validated.', files_modified: null, created_at: dayAgo, updated_at: dayAgo, completed_at: hourAgo, estimated_cost: '$0.00', actual_cost: '$0.00', prompt: null, run_endpoint: null },
  ];
}
