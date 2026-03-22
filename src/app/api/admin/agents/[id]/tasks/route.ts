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
}

// ── GET: Fetch tasks for a specific agent ────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await safeAuth();
    const { id: agentId } = await params;
    const supabase = createServerSupabase();

    // Fetch tasks from Supabase — split by status
    const { data: tasks, error } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      // Table might not exist yet — return mock data
      return NextResponse.json({
        agentId,
        queued: generateDefaultTasks(agentId, 'queued'),
        completed: generateDefaultTasks(agentId, 'completed'),
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
      source: 'supabase',
    });
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
}

// ── POST: Create / update tasks ──────────────────────────────────────────────

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
        // Manual task creation
        const { title, description, priority = 'medium' } = body;
        if (!title) {
          return NextResponse.json({ error: 'Title is required' }, { status: 400 });
        }

        const { data, error } = await supabase
          .from('agent_tasks')
          .insert({
            agent_id: agentId,
            title,
            description: description || '',
            status: 'queued',
            priority,
            source: 'manual',
          })
          .select()
          .single();

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

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
        return NextResponse.json({ task: data, action: 'ignored' });
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

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// ── Default task suggestions per agent ──────────────────────────────────────

function generateDefaultTasks(agentId: string, type: 'queued' | 'completed'): TaskRow[] {
  const now = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  const AGENT_TASKS: Record<string, { queued: Partial<TaskRow>[]; completed: Partial<TaskRow>[] }> = {
    'it': {
      queued: [
        { title: 'Audit all API key expiration dates', description: 'Scan every configured key and flag those expiring within 30 days.', priority: 'high', estimated_cost: '$0.00' },
        { title: 'Validate FRED API key permissions', description: 'Test FRED endpoint access and confirm rate limits match expected tier.', priority: 'medium', estimated_cost: '$0.00' },
        { title: 'Check for orphaned credentials', description: 'Cross-reference env vars against active code imports to find unused keys.', priority: 'low', estimated_cost: '$0.00' },
        { title: 'Run full infrastructure health sweep', description: 'Check Vercel, Supabase, all external APIs, DNS, and credential status.', priority: 'high', estimated_cost: '$0.00' },
      ],
      completed: [
        { title: 'Initial key inventory scan', description: 'Scanned 18 environment variables across 5 categories.', result_summary: 'Found 18 keys configured. 2 missing (SUPABASE_SERVICE_ROLE_KEY, TV_WEBHOOK_SECRET). 16 healthy.', completed_at: hourAgo },
        { title: 'Key format validation', description: 'Verified key format patterns match expected provider schemas.', result_summary: 'All present keys match expected format patterns. No format anomalies detected.', completed_at: dayAgo },
      ],
    },
    'intelligence': {
      queued: [
        { title: 'Generate morning intelligence brief', description: 'Compile FRED, Finnhub, CoinGecko, and Fear & Greed data into a daily macro report.', priority: 'high', estimated_cost: '$0.08' },
        { title: 'Produce weekly portfolio risk summary', description: 'Aggregate 7-day market movements and generate risk assessment narrative.', priority: 'medium', estimated_cost: '$0.12' },
        { title: 'Create sector rotation analysis', description: 'Analyze cross-sector money flow using market data to identify rotation patterns.', priority: 'medium', estimated_cost: '$0.10' },
      ],
      completed: [
        { title: 'Daily intelligence brief — Mar 21', description: 'Full macro intelligence report covering rates, crypto, equities, and sentiment.', result_summary: 'Generated 2,400-word brief. Key findings: Fed holding steady, BTC testing $87k support, Fear & Greed at 42 (Fear). Published to dashboard.', files_modified: ['/api/report'], completed_at: hourAgo },
      ],
    },
    'market-scanner': {
      queued: [
        { title: 'Scan FRED for rate decision signals', description: 'Pull latest treasury yields, CPI, and employment data for Fed meeting prep.', priority: 'high', estimated_cost: '$0.00' },
        { title: 'Monitor crypto whale movements', description: 'Check CoinGecko and on-chain data for large BTC/ETH transfers.', priority: 'medium', estimated_cost: '$0.00' },
        { title: 'Update sector heatmap data', description: 'Refresh Finnhub sector performance data for dashboard visualization.', priority: 'low', estimated_cost: '$0.00' },
      ],
      completed: [
        { title: 'Morning data pull — all sources', description: 'Fetched latest data from FRED, Finnhub, CoinGecko, CNN Fear & Greed.', result_summary: 'All 4 data sources responded successfully. 47 data points refreshed. Latency: FRED 340ms, Finnhub 180ms, CoinGecko 420ms, CNN 290ms.', completed_at: hourAgo },
      ],
    },
    'auto-scheduler': {
      queued: [
        { title: 'Schedule next intelligence brief', description: 'Queue tomorrow\'s 6:30 AM EST auto-brief generation using latest data enrichment.', priority: 'high', estimated_cost: '$0.00' },
        { title: 'Optimize posting schedule', description: 'Analyze engagement data to find optimal X posting times for max reach.', priority: 'medium', estimated_cost: '$0.02' },
      ],
      completed: [
        { title: 'Scheduled 3 posts for today', description: 'Queued morning brief thread, midday update, and market close recap.', result_summary: 'Created 3 scheduled posts. Morning: 7:00 AM EST, Midday: 12:30 PM EST, Close: 4:15 PM EST. All drafts reviewed by WATCHDOG.', completed_at: dayAgo },
      ],
    },
    'data-enrichment': {
      queued: [
        { title: 'Enrich report with TradingView signals', description: 'Pull latest TradingView webhook signals and merge with enriched data pipeline.', priority: 'high', estimated_cost: '$0.00' },
        { title: 'Cross-reference FRED + Finnhub for divergences', description: 'Compare macro indicators against market price action to flag disconnects.', priority: 'medium', estimated_cost: '$0.00' },
      ],
      completed: [
        { title: 'Full enrichment cycle', description: 'Ran parallel fetch of all 5 data sources and merged into unified context.', result_summary: 'Enriched data package generated in 1.2s. Sources: FRED (12 series), Finnhub (8 quotes), CoinGecko (top 10), CNN F&G (1), TradingView (0 signals — webhook not configured yet).', completed_at: hourAgo },
      ],
    },
    'ares-hunter': {
      queued: [
        { title: 'Process incoming TradingView alerts', description: 'Monitor webhook endpoint for new signals from configured TradingView alerts.', priority: 'critical', estimated_cost: '$0.00' },
        { title: 'Generate signal confluence report', description: 'Cross-reference TradingView signals with FRED macro data and Finnhub prices for confluence scoring.', priority: 'high', estimated_cost: '$0.02' },
        { title: 'Update watchlist priority rankings', description: 'Re-rank watchlist tickers based on latest signal strength and macro alignment.', priority: 'medium', estimated_cost: '$0.01' },
      ],
      completed: [
        { title: 'Webhook endpoint initialized', description: 'TradingView webhook receiver configured and tested.', result_summary: 'Endpoint active at /api/webhooks/tradingview. Awaiting first signal from TradingView Premium alerts. Buffer initialized (0/200).', completed_at: hourAgo },
      ],
    },
  };

  const agentTasks = AGENT_TASKS[agentId];
  if (!agentTasks) {
    // Generic fallback tasks
    if (type === 'queued') {
      return [
        { id: `${agentId}-q1`, agent_id: agentId, title: 'Run diagnostic self-check', description: 'Verify all dependencies and capabilities are operational.', status: 'queued', priority: 'medium', source: 'system', result_summary: null, files_modified: null, created_at: now, updated_at: now, completed_at: null, estimated_cost: '$0.00', actual_cost: null },
        { id: `${agentId}-q2`, agent_id: agentId, title: 'Generate capability report', description: 'Produce a summary of current operational status and recent activity.', status: 'queued', priority: 'low', source: 'system', result_summary: null, files_modified: null, created_at: now, updated_at: now, completed_at: null, estimated_cost: '$0.00', actual_cost: null },
      ];
    }
    return [
      { id: `${agentId}-c1`, agent_id: agentId, title: 'System initialization', description: 'Agent registered and dependencies checked.', status: 'completed', priority: 'medium', source: 'system', result_summary: 'Agent operational. All configured dependencies validated.', files_modified: null, created_at: dayAgo, updated_at: dayAgo, completed_at: dayAgo, estimated_cost: '$0.00', actual_cost: '$0.00' },
    ];
  }

  const items = agentTasks[type] || [];
  return items.map((t, i) => ({
    id: `${agentId}-${type[0]}${i}`,
    agent_id: agentId,
    title: t.title || '',
    description: t.description || '',
    status: type === 'queued' ? 'queued' as const : 'completed' as const,
    priority: (t.priority as TaskRow['priority']) || 'medium',
    source: 'system' as const,
    result_summary: t.result_summary || null,
    files_modified: t.files_modified || null,
    created_at: type === 'completed' ? dayAgo : now,
    updated_at: type === 'completed' ? (t.completed_at || dayAgo) : now,
    completed_at: t.completed_at || null,
    estimated_cost: t.estimated_cost || null,
    actual_cost: t.actual_cost || null,
  }));
}
