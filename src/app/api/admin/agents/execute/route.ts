/**
 * POST /api/admin/agents/execute
 *
 * Central execution engine for all agents. Each agent has a real workflow:
 *   1. Fetch live data (APIs, Supabase, env checks)
 *   2. Send through AI (Claude → Gemini → GPT fallback)
 *   3. Return structured AgentReport
 *
 * Body: { agentId: string, prompt?: string }
 * Returns: AgentReport
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── Report Type ──────────────────────────────────────────────────────────────

interface AgentReport {
  agentId: string;
  codename: string;
  status: 'completed' | 'failed' | 'partial';
  report: {
    title: string;
    summary: string;
    sections: { heading: string; body: string }[];
    metrics: Record<string, string | number>;
    recommendations: string[];
    warnings: string[];
  };
  dataSources: string[];
  ai: { provider: string; model: string; tokensUsed: number } | null;
  timestamp: string;
  elapsed_ms: number;
}

// ── AI Caller (Claude → Gemini → GPT) ───────────────────────────────────────

async function callAI(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; provider: string; model: string; tokens: number }> {
  // Claude
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt + '\n\nReturn your report as JSON with this exact structure: { "summary": "...", "sections": [{"heading":"...","body":"..."}], "recommendations": ["..."], "warnings": ["..."] }',
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        return {
          text: json.content?.[0]?.text || '',
          provider: 'claude',
          model: 'claude-sonnet-4',
          tokens: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
        };
      }
    } catch { /* fall through */ }
  }

  // Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt + '\n\nReturn JSON: { "summary": "...", "sections": [{"heading":"...","body":"..."}], "recommendations": ["..."], "warnings": ["..."] }' }] },
            contents: [{ parts: [{ text: userPrompt }] }],
          }),
        }
      );
      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { text, provider: 'gemini', model: 'gemini-2.0-flash', tokens: Math.round(text.length / 4) };
      }
    } catch { /* fall through */ }
  }

  // GPT
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt + '\n\nReturn ONLY JSON: { "summary": "...", "sections": [{"heading":"...","body":"..."}], "recommendations": ["..."], "warnings": ["..."] }' },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        return {
          text: json.choices?.[0]?.message?.content || '',
          provider: 'gpt',
          model: 'gpt-4o',
          tokens: json.usage?.total_tokens || 0,
        };
      }
    } catch { /* fall through */ }
  }

  throw new Error('All AI providers failed — check ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY');
}

// ── JSON Parser (robust) ─────────────────────────────────────────────────────

function parseAIReport(text: string): {
  summary: string;
  sections: { heading: string; body: string }[];
  recommendations: string[];
  warnings: string[];
} {
  try {
    let cleaned = text.trim().replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) cleaned = cleaned.substring(start, end + 1);
    // Fix trailing commas
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || '',
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch {
    // Fallback: treat as plain text
    return {
      summary: text.slice(0, 500),
      sections: [{ heading: 'Full Report', body: text }],
      recommendations: [],
      warnings: ['AI returned non-JSON — raw text preserved'],
    };
  }
}

// ── Data Fetchers ────────────────────────────────────────────────────────────

async function fetchYahooQuotes(symbols: string[]): Promise<any[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&fields=symbol,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,averageDailyVolume3Month`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.quoteResponse?.result ?? [];
  } catch {
    return [];
  }
}

async function fetchCoinGecko(): Promise<any[]> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&sparkline=false');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function fetchFearGreed(): Promise<any> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchFRED(seriesIds: string[]): Promise<Record<string, any>> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return {};
  const results: Record<string, any> = {};
  await Promise.all(
    seriesIds.map(async (id) => {
      try {
        const res = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`
        );
        if (res.ok) {
          const json = await res.json();
          results[id] = json?.observations?.[0] ?? null;
        }
      } catch { /* partial OK */ }
    })
  );
  return results;
}

async function fetchFinnhubEarnings(): Promise<any[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return [];
  try {
    const from = new Date().toISOString().split('T')[0];
    const to = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.earningsCalendar ?? [];
  } catch {
    return [];
  }
}

// ── Workflow Type ─────────────────────────────────────────────────────────────

interface WorkflowResult {
  dataSources: string[];
  metrics: Record<string, string | number>;
  title: string;
  systemPrompt: string;
  userPrompt: string;
}

// ── Agent Workflows ──────────────────────────────────────────────────────────

async function workflowSPECTRE(): Promise<WorkflowResult> {
  const symbols = [
    'SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'AMZN', 'GOOGL', 'AMD',
    'BTC-USD', 'ETH-USD', 'SOL-USD', '^VIX', '^TNX', 'GC=F', 'DX-Y.NYB',
  ];

  const [quotes, crypto, fearGreed] = await Promise.all([
    fetchYahooQuotes(symbols),
    fetchCoinGecko(),
    fetchFearGreed(),
  ]);

  const anomalies = quotes.filter((q: any) => {
    const pct = Math.abs(q.regularMarketChangePercent || 0);
    const volRatio =
      q.regularMarketVolume && q.averageDailyVolume3Month
        ? q.regularMarketVolume / q.averageDailyVolume3Month
        : 0;
    return pct > 3 || volRatio > 2;
  });

  const quoteTxt = quotes
    .map((q: any) => `${q.symbol}: $${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%) Vol:${(q.regularMarketVolume / 1e6)?.toFixed(1)}M`)
    .join('\n');
  const cryptoTxt = crypto
    .slice(0, 5)
    .map((c: any) => `${c.symbol.toUpperCase()}: $${c.current_price} (${c.price_change_percentage_24h?.toFixed(2)}%) MCap:$${(c.market_cap / 1e9).toFixed(1)}B`)
    .join('\n');

  return {
    dataSources: ['Yahoo Finance', 'CoinGecko', 'Fear & Greed Index'],
    metrics: {
      'Symbols Scanned': quotes.length,
      'Anomalies Detected': anomalies.length,
      'Fear & Greed': fearGreed?.value_classification || 'N/A',
      'Crypto Assets': crypto.length,
    },
    title: `Market Scan Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are SPECTRE, Market Surveillance Analyst at Armed Capital. Produce a concise, actionable market scan report. Flag anomalies prominently. Cover: Executive Summary, Equity Snapshot, Crypto Snapshot, Anomaly Alerts, Risk Flags.',
    userPrompt: `Live data:\n\n--- EQUITY & MACRO ---\n${quoteTxt}\n\n--- CRYPTO TOP 5 ---\n${cryptoTxt}\n\n--- FEAR & GREED ---\n${fearGreed?.value || 'N/A'} (${fearGreed?.value_classification || 'N/A'})\n\n--- ANOMALIES (>3% or >2x vol) ---\n${anomalies.length ? anomalies.map((a: any) => `${a.symbol}: ${a.regularMarketChangePercent?.toFixed(2)}%`).join(', ') : 'None'}`,
  };
}

async function workflowMOSAIC(): Promise<WorkflowResult> {
  const fredSeries = ['DGS10', 'DGS2', 'T10Y2Y', 'T10YIE', 'FEDFUNDS', 'ICSA', 'UNRATE'];

  const [fredData, earnings, crypto, fearGreed] = await Promise.all([
    fetchFRED(fredSeries),
    fetchFinnhubEarnings(),
    fetchCoinGecko(),
    fetchFearGreed(),
  ]);

  const fredTxt = Object.entries(fredData)
    .map(([id, obs]: [string, any]) => `${id}: ${obs?.value ?? 'N/A'} (${obs?.date ?? 'N/A'})`)
    .join('\n');
  const earningsTxt = earnings
    .slice(0, 8)
    .map((e: any) => `${e.symbol}: ${e.date} (est EPS: ${e.epsEstimate})`)
    .join('\n');
  const cryptoTxt = crypto
    .slice(0, 10)
    .map((c: any) => `${c.symbol}: $${c.current_price} (${c.price_change_percentage_24h?.toFixed(2)}%)`)
    .join('\n');

  return {
    dataSources: ['FRED', 'Finnhub', 'CoinGecko', 'Fear & Greed'],
    metrics: {
      'FRED Series': Object.keys(fredData).length,
      'Upcoming Earnings': earnings.length,
      'Crypto Assets': crypto.length,
      '10Y Yield': fredData['DGS10']?.value || 'N/A',
      '2Y Yield': fredData['DGS2']?.value || 'N/A',
      'Fed Funds': fredData['FEDFUNDS']?.value || 'N/A',
    },
    title: `Macro Enrichment Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are MOSAIC, Macro Intelligence Aggregator at Armed Capital. Synthesize FRED, Finnhub, CoinGecko, and sentiment data. Cover: Yield Curve & Rates, Labor Market, Sentiment, Crypto Landscape, Upcoming Catalysts.',
    userPrompt: `Macro data:\n\n--- FRED ---\n${fredTxt}\n\n--- EARNINGS ---\n${earningsTxt || 'None this week'}\n\n--- FEAR & GREED ---\n${fearGreed?.value || 'N/A'} (${fearGreed?.value_classification || 'N/A'})\n\n--- CRYPTO TOP 10 ---\n${cryptoTxt}`,
  };
}

async function workflowLEDGER(): Promise<WorkflowResult> {
  const supabase = createServerSupabase();
  const [tasksRes, auditRes] = await Promise.all([
    supabase.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100),
  ]);

  const tasks = tasksRes.data || [];
  const audits = auditRes.data || [];
  const tasksByAgent: Record<string, number> = {};
  const tasksByStatus: Record<string, number> = {};
  for (const t of tasks) {
    tasksByAgent[t.agent_id] = (tasksByAgent[t.agent_id] || 0) + 1;
    tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
  }

  return {
    dataSources: ['Supabase:agent_tasks', 'Supabase:audit_log'],
    metrics: {
      'Total Tasks': tasks.length,
      'Completed': tasksByStatus['completed'] || 0,
      'Failed': tasksByStatus['failed'] || 0,
      'Audit Events': audits.length,
      'Active Agents': Object.keys(tasksByAgent).length,
    },
    title: `Financial Operations Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are LEDGER, Chief Financial Controller at Armed Capital. Track platform costs and efficiency. Cover: Cost Summary, Agent Spend Breakdown, Task Completion Rate, Burn Rate Estimate, Budget Recommendations.',
    userPrompt: `Data:\n\n--- TASKS BY AGENT ---\n${JSON.stringify(tasksByAgent)}\n\n--- TASKS BY STATUS ---\n${JSON.stringify(tasksByStatus)}\n\n--- RECENT AUDIT (last 10) ---\n${audits.slice(0, 10).map((a: any) => `[${a.type}] ${a.agent_id}: ${a.action}`).join('\n')}\n\nEstimate costs and recommend budget actions.`,
  };
}

async function workflowFORGE(): Promise<WorkflowResult> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const endpoints = [
    '/api/generate',
    '/api/admin/agents',
    '/api/admin/agents/tasks',
    '/api/terminal',
    '/api/tradingview/session',
    '/api/admin/tokens',
  ];

  const healthResults = await Promise.all(
    endpoints.map(async (ep) => {
      const start = Date.now();
      try {
        const res = await fetch(`${baseUrl}${ep}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        return { endpoint: ep, status: res.status, latency: Date.now() - start, ok: res.ok };
      } catch (err: any) {
        return { endpoint: ep, status: 0, latency: Date.now() - start, ok: false, error: err.message };
      }
    })
  );

  let supabaseHealth = 'unknown';
  try {
    const supabase = createServerSupabase();
    const { error } = await supabase.from('users').select('id').limit(1);
    supabaseHealth = error ? `error: ${error.message}` : 'healthy';
  } catch {
    supabaseHealth = 'unreachable';
  }

  const healthyCount = healthResults.filter((h) => h.ok).length;
  const avgLatency = Math.round(healthResults.reduce((s, h) => s + h.latency, 0) / healthResults.length);

  return {
    dataSources: ['API Health Checks', 'Supabase Connection'],
    metrics: {
      'Endpoints Checked': endpoints.length,
      Healthy: healthyCount,
      Degraded: endpoints.length - healthyCount,
      'Avg Latency (ms)': avgLatency,
      Supabase: supabaseHealth,
    },
    title: `Platform Health Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are FORGE, Chief Systems Architect at Armed Capital. Monitor API reliability and infrastructure. Cover: System Status, Endpoint Health Matrix, Database Status, Performance Metrics, Action Items.',
    userPrompt: `Health data:\n\n--- ENDPOINTS ---\n${healthResults.map((h) => `${h.endpoint}: ${h.ok ? '✓' : '✗'} HTTP ${h.status} (${h.latency}ms)${(h as any).error ? ' — ' + (h as any).error : ''}`).join('\n')}\n\n--- SUPABASE ---\n${supabaseHealth}`,
  };
}

async function workflowBASTION(): Promise<WorkflowResult> {
  const keyCategories: Record<string, string[]> = {
    'AI Providers': ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'],
    'Data Sources': ['FRED_API_KEY', 'FINNHUB_API_KEY'],
    'Social/Publishing': ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
    Infrastructure: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'],
    Trading: ['PUBLIC_SECRET_KEY', 'PUBLIC_API_TOKEN', 'PUBLIC_ACCOUNT_ID'],
  };

  let totalKeys = 0;
  let setKeys = 0;
  const inventoryTxt: string[] = [];

  for (const [cat, keys] of Object.entries(keyCategories)) {
    const lines = keys.map((k) => {
      totalKeys++;
      const val = process.env[k];
      const isSet = !!val && val.length > 0;
      if (isSet) setKeys++;
      return `  ${k}: ${isSet ? '✓ SET' : '✗ MISSING'} ${isSet ? val!.slice(0, 4) + '...' + val!.slice(-4) : ''}`;
    });
    inventoryTxt.push(`${cat}:\n${lines.join('\n')}`);
  }

  // Live validation on Anthropic + FRED
  const validations: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      });
      validations.push(`ANTHROPIC_API_KEY: ${res.ok ? 'valid' : 'HTTP ' + res.status}`);
    } catch {
      validations.push('ANTHROPIC_API_KEY: unreachable');
    }
  }
  if (process.env.FRED_API_KEY) {
    try {
      const res = await fetch(`https://api.stlouisfed.org/fred/series?series_id=DGS10&api_key=${process.env.FRED_API_KEY}&file_type=json`);
      validations.push(`FRED_API_KEY: ${res.ok ? 'valid' : 'HTTP ' + res.status}`);
    } catch {
      validations.push('FRED_API_KEY: unreachable');
    }
  }

  return {
    dataSources: ['Environment Variables', 'API Key Validation'],
    metrics: {
      'Total Keys': totalKeys,
      'Keys Set': setKeys,
      'Keys Missing': totalKeys - setKeys,
      'Keys Validated': validations.length,
    },
    title: `IT Security & Credential Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are BASTION, Chief Information & Security Officer at Armed Capital. Audit API key health and security posture. Cover: Credential Inventory, Key Health, Validation Results, Security Posture Score (1-10), Remediation Actions. Never expose full key values.',
    userPrompt: `Credential data:\n\n--- KEY INVENTORY ---\n${inventoryTxt.join('\n\n')}\n\n--- LIVE VALIDATION ---\n${validations.join('\n') || 'No validations run'}`,
  };
}

async function workflowVAULT(): Promise<WorkflowResult> {
  const symbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'AMZN', 'GOOGL', 'AMD', 'BTC-USD', 'ETH-USD', 'SOL-USD', 'GC=F', '^TNX'];

  const [quotes, fearGreed] = await Promise.all([fetchYahooQuotes(symbols), fetchFearGreed()]);

  const equities = quotes.filter((q: any) => !q.symbol.includes('-USD') && !q.symbol.startsWith('^') && !q.symbol.includes('='));
  const crypto = quotes.filter((q: any) => q.symbol.includes('-USD'));
  const macro = quotes.filter((q: any) => q.symbol.startsWith('^') || q.symbol.includes('='));

  return {
    dataSources: ['Yahoo Finance', 'Fear & Greed'],
    metrics: { Equities: equities.length, Crypto: crypto.length, Macro: macro.length, 'Fear & Greed': fearGreed?.value_classification || 'N/A' },
    title: `Asset Management Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are VAULT, Chief Investment Officer at Armed Capital. Analyze portfolio allocation and recommend rebalancing. Cover: Portfolio Snapshot, Sector Exposure, Risk Metrics, Correlation Insights, Rebalancing Recommendations.',
    userPrompt: `Portfolio data:\n\n--- EQUITIES ---\n${equities.map((q: any) => `${q.symbol}: $${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`).join('\n')}\n\n--- CRYPTO ---\n${crypto.map((q: any) => `${q.symbol}: $${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`).join('\n')}\n\n--- MACRO ---\n${macro.map((q: any) => `${q.symbol}: ${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`).join('\n')}\n\nSentiment: ${fearGreed?.value || 'N/A'} (${fearGreed?.value_classification || 'N/A'})`,
  };
}

async function workflowVANGUARD(): Promise<WorkflowResult> {
  const supabase = createServerSupabase();
  const [postsRes, reportsRes] = await Promise.all([
    supabase.from('scheduled_posts').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(5),
  ]);

  const posts = postsRes.data || [];
  const reports = reportsRes.data || [];
  const postsByStatus: Record<string, number> = {};
  for (const p of posts) postsByStatus[p.status] = (postsByStatus[p.status] || 0) + 1;

  return {
    dataSources: ['Supabase:scheduled_posts', 'Supabase:reports'],
    metrics: { 'Total Posts': posts.length, Posted: postsByStatus['posted'] || 0, Pending: postsByStatus['pending'] || 0, Failed: postsByStatus['failed'] || 0, Reports: reports.length },
    title: `Revenue Operations Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are VANGUARD, Chief Revenue Officer at Armed Capital. Drive content strategy and audience growth. Cover: Content Pipeline Status, Publishing Metrics, Content Strategy Recommendations, Growth Opportunities.',
    userPrompt: `Data:\n\nPosts by status: ${JSON.stringify(postsByStatus)}\nRecent posts:\n${posts.slice(0, 5).map((p: any) => `[${p.status}] ${p.content?.slice(0, 80) || 'No content'}`).join('\n')}\n\n${reports.length} intelligence reports generated.\n\nRecommend content strategy.`,
  };
}

async function workflowGUARDIAN(): Promise<WorkflowResult> {
  const supabase = createServerSupabase();
  const [tasksRes, auditRes] = await Promise.all([
    supabase.from('agent_tasks').select('agent_id, status, created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('audit_log').select('agent_id, type, created_at').order('created_at', { ascending: false }).limit(200),
  ]);

  const tasks = tasksRes.data || [];
  const audits = auditRes.data || [];
  const agentActivity: Record<string, { tasks: number; errors: number; lastSeen: string }> = {};
  for (const t of tasks) {
    if (!agentActivity[t.agent_id]) agentActivity[t.agent_id] = { tasks: 0, errors: 0, lastSeen: t.created_at };
    agentActivity[t.agent_id].tasks++;
  }
  for (const a of audits) {
    if (!agentActivity[a.agent_id]) agentActivity[a.agent_id] = { tasks: 0, errors: 0, lastSeen: a.created_at };
    if (a.type === 'error') agentActivity[a.agent_id].errors++;
  }

  return {
    dataSources: ['Supabase:agent_tasks', 'Supabase:audit_log'],
    metrics: { 'Active Agents': Object.keys(agentActivity).length, 'Total Tasks': tasks.length, Errors: audits.filter((a: any) => a.type === 'error').length },
    title: `Agent Workforce Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are GUARDIAN, Chief People Officer at Armed Capital. Manage the AI agent workforce. Cover: Fleet Composition, Agent Performance Rankings, Error Analysis, Inactive Agent Flags, Workforce Recommendations.',
    userPrompt: `Agent activity:\n\n${Object.entries(agentActivity).map(([id, d]) => `${id}: ${d.tasks} tasks, ${d.errors} errors, last: ${d.lastSeen}`).join('\n')}\n\nAnalyze workforce health.`,
  };
}

async function workflowBEACON(): Promise<WorkflowResult> {
  const supabase = createServerSupabase();
  const [tasksRes, reportsRes, postsRes] = await Promise.all([
    supabase.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('scheduled_posts').select('*').order('created_at', { ascending: false }).limit(10),
  ]);

  return {
    dataSources: ['Supabase:agent_tasks', 'Supabase:reports', 'Supabase:scheduled_posts'],
    metrics: { 'Tasks Reviewed': (tasksRes.data || []).length, 'Reports Validated': (reportsRes.data || []).length, 'Posts Checked': (postsRes.data || []).length },
    title: `Quality Assurance Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are BEACON, Chief Deployment & Experience Officer at Armed Capital. Validate agent outputs and ensure quality. Cover: Output Quality Assessment, Data Freshness, Brand Compliance, Quality Scorecard (1-10 per category), Improvement Actions.',
    userPrompt: `Data:\n\n--- TASKS ---\n${(tasksRes.data || []).slice(0, 10).map((t: any) => `[${t.status}] ${t.agent_id}: ${t.title || t.description?.slice(0, 60)}`).join('\n')}\n\n--- REPORTS ---\n${(reportsRes.data || []).map((r: any) => `${r.title || 'Untitled'}: ${r.created_at}`).join('\n') || 'None'}\n\n--- POSTS ---\n${(postsRes.data || []).slice(0, 5).map((p: any) => `[${p.status}] ${p.content?.slice(0, 60)}`).join('\n') || 'None'}\n\nAssess quality and provide scorecard.`,
  };
}

async function workflowCOMMANDER(): Promise<WorkflowResult> {
  const supabase = createServerSupabase();
  const [tasksRes, auditRes, postsRes] = await Promise.all([
    supabase.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('scheduled_posts').select('status').order('created_at', { ascending: false }).limit(20),
  ]);

  const tasks = tasksRes.data || [];
  const audits = auditRes.data || [];
  const posts = postsRes.data || [];
  const quotes = await fetchYahooQuotes(['SPY', 'BTC-USD', '^VIX']);

  const tasksByAgent: Record<string, number> = {};
  for (const t of tasks) tasksByAgent[t.agent_id] = (tasksByAgent[t.agent_id] || 0) + 1;
  const errors = audits.filter((a: any) => a.type === 'error');

  return {
    dataSources: ['Supabase:agent_tasks', 'Supabase:audit_log', 'Yahoo Finance'],
    metrics: {
      'Active Agents': Object.keys(tasksByAgent).length,
      Tasks: tasks.length,
      Errors: errors.length,
      'Post Pipeline': posts.length,
      SPY: quotes.find((q: any) => q.symbol === 'SPY')?.regularMarketPrice?.toFixed(2) || 'N/A',
      BTC: quotes.find((q: any) => q.symbol === 'BTC-USD')?.regularMarketPrice?.toFixed(0) || 'N/A',
      VIX: quotes.find((q: any) => q.symbol === '^VIX')?.regularMarketPrice?.toFixed(2) || 'N/A',
    },
    title: `Operational Command Brief — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are COMMANDER, Chief Operating Partner at Armed Capital. Orchestrate all agents and provide strategic direction. Cover: Executive Summary, Agent Fleet Status, Operational Metrics, Market Context, Priority Actions, Strategic Recommendations.',
    userPrompt: `Ops data:\n\n--- FLEET ---\n${Object.entries(tasksByAgent).map(([id, c]) => `${id}: ${c} tasks`).join('\n')}\n\n--- ERRORS ---\n${errors.slice(0, 5).map((e: any) => `${e.agent_id}: ${e.action}`).join('\n') || 'None'}\n\n--- MARKET ---\n${quotes.map((q: any) => `${q.symbol}: $${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`).join('\n')}\n\n--- CONTENT ---\n${posts.length} posts queued\n\nProvide strategic direction.`,
  };
}

async function workflowANCHOR(): Promise<WorkflowResult> {
  const quotes = await fetchYahooQuotes(['SPY', 'BTC-USD', 'ETH-USD', '^TNX', 'GC=F']);

  return {
    dataSources: ['Yahoo Finance'],
    metrics: {
      SPY: quotes.find((q: any) => q.symbol === 'SPY')?.regularMarketPrice?.toFixed(2) || 'N/A',
      BTC: quotes.find((q: any) => q.symbol === 'BTC-USD')?.regularMarketPrice?.toFixed(0) || 'N/A',
      '10Y': quotes.find((q: any) => q.symbol === '^TNX')?.regularMarketPrice?.toFixed(2) || 'N/A',
      Gold: quotes.find((q: any) => q.symbol === 'GC=F')?.regularMarketPrice?.toFixed(2) || 'N/A',
    },
    title: `LP Relations Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are ANCHOR, LP Relations Director at Armed Capital. Produce investor communications. Cover: Fund Performance Summary, Market Environment, Portfolio Positioning, Risk Management, Outlook. Professional investor-relations tone.',
    userPrompt: `Benchmarks:\n\n${quotes.map((q: any) => `${q.symbol}: $${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`).join('\n')}\n\nProduce an LP update.`,
  };
}

async function workflowARCHITECT(): Promise<WorkflowResult> {
  const supabase = createServerSupabase();
  const [tasksRes, auditRes] = await Promise.all([
    supabase.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(50),
  ]);

  const tasks = tasksRes.data || [];
  const audits = auditRes.data || [];

  return {
    dataSources: ['Supabase:agent_tasks', 'Supabase:audit_log'],
    metrics: { 'Recent Tasks': tasks.length, Completed: tasks.filter((t: any) => t.status === 'completed').length, Failed: tasks.filter((t: any) => t.status === 'failed').length },
    title: `Development Operations Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are ARCHITECT, Chief Development Officer at Armed Capital. Manage sprint planning and release quality. Cover: Sprint Status, Task Completion Analysis, Error Trends, Tech Debt Indicators, Next Sprint Recommendations.',
    userPrompt: `Data:\n\n--- TASKS ---\n${tasks.slice(0, 15).map((t: any) => `[${t.status}] ${t.agent_id}: ${t.title || t.description?.slice(0, 60)}`).join('\n')}\n\n--- ERRORS ---\n${audits.filter((a: any) => a.type === 'error').slice(0, 10).map((a: any) => `${a.agent_id}: ${a.action}`).join('\n') || 'None'}\n\nAnalyze dev velocity and recommend priorities.`,
  };
}

async function workflowAPEX(): Promise<WorkflowResult> {
  const quotes = await fetchYahooQuotes(['SPY', 'QQQ', '^VIX', '^TNX', 'BTC-USD']);

  return {
    dataSources: ['Yahoo Finance'],
    metrics: {
      SPY: quotes.find((q: any) => q.symbol === 'SPY')?.regularMarketPrice?.toFixed(2) || 'N/A',
      VIX: quotes.find((q: any) => q.symbol === '^VIX')?.regularMarketPrice?.toFixed(2) || 'N/A',
    },
    title: `Private Equity Pipeline Report — ${new Date().toLocaleDateString()}`,
    systemPrompt: 'You are APEX, Chief Deal Officer at Armed Capital. Analyze deal pipeline and market conditions for PE activity. Cover: Market Conditions for Dealmaking, Valuation Environment, Sector Opportunities, Risk Factors, Deal Pipeline Recommendations.',
    userPrompt: `Market data:\n\n${quotes.map((q: any) => `${q.symbol}: $${q.regularMarketPrice?.toFixed(2)} (${q.regularMarketChangePercent?.toFixed(2)}%)`).join('\n')}\n\nAssess PE dealmaking environment.`,
  };
}

// ── Workflow Registry ────────────────────────────────────────────────────────

const WORKFLOWS: Record<string, () => Promise<WorkflowResult>> = {
  'market-scanner': workflowSPECTRE,
  'data-enrichment': workflowMOSAIC,
  bookkeeping: workflowLEDGER,
  engineer: workflowFORGE,
  it: workflowBASTION,
  'asset-management': workflowVAULT,
  revops: workflowVANGUARD,
  hr: workflowGUARDIAN,
  'end-user-deployment': workflowBEACON,
  'active-partner': workflowCOMMANDER,
  'passive-partner': workflowANCHOR,
  dev: workflowARCHITECT,
  'private-equity': workflowAPEX,
};

// Agent codename map
const CODENAMES: Record<string, string> = {
  'market-scanner': 'SPECTRE',
  'data-enrichment': 'MOSAIC',
  bookkeeping: 'LEDGER',
  engineer: 'FORGE',
  it: 'BASTION',
  'asset-management': 'VAULT',
  revops: 'VANGUARD',
  hr: 'GUARDIAN',
  'end-user-deployment': 'BEACON',
  'active-partner': 'COMMANDER',
  'passive-partner': 'ANCHOR',
  dev: 'ARCHITECT',
  'private-equity': 'APEX',
};

// ── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const start = Date.now();

  try {
    await safeAuth();

    const body = await req.json();
    const { agentId } = body;

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'Missing "agentId"' }, { status: 400 });
    }

    const workflow = WORKFLOWS[agentId];
    if (!workflow) {
      return NextResponse.json(
        { error: `No workflow defined for agent "${agentId}". Available: ${Object.keys(WORKFLOWS).join(', ')}` },
        { status: 404 }
      );
    }

    // 1. Run workflow — fetch real data
    let wf: WorkflowResult;
    try {
      wf = await workflow();
    } catch (err: any) {
      return NextResponse.json(
        {
          agentId,
          codename: CODENAMES[agentId] || agentId.toUpperCase(),
          status: 'failed',
          report: {
            title: `${CODENAMES[agentId] || agentId} — Data Fetch Failed`,
            summary: `Workflow data collection failed: ${err.message}`,
            sections: [],
            metrics: {},
            recommendations: ['Check API keys and network connectivity'],
            warnings: [err.message],
          },
          dataSources: [],
          ai: null,
          timestamp: new Date().toISOString(),
          elapsed_ms: Date.now() - start,
        } as AgentReport,
        { status: 502 }
      );
    }

    // 2. Call AI for analysis
    let aiResult: { text: string; provider: string; model: string; tokens: number } | null = null;
    let parsed: ReturnType<typeof parseAIReport>;

    try {
      aiResult = await callAI(wf.systemPrompt, wf.userPrompt);
      parsed = parseAIReport(aiResult.text);
    } catch (err: any) {
      // AI failed — return data-only report
      parsed = {
        summary: `Data collected from ${wf.dataSources.join(', ')} but AI analysis unavailable: ${err.message}`,
        sections: [{ heading: 'Raw Data Context', body: wf.userPrompt.slice(0, 2000) }],
        recommendations: ['Verify AI provider API keys (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY)'],
        warnings: [`AI analysis failed: ${err.message}`],
      };
    }

    // 3. Persist to Supabase
    try {
      const supabase = createServerSupabase();
      await supabase.from('agent_tasks').insert({
        agent_id: agentId,
        title: wf.title,
        description: parsed.summary.slice(0, 200),
        status: 'completed',
        priority: 'high',
        source: 'system',
        result_summary: parsed.summary.slice(0, 2000),
        result_content: JSON.stringify(parsed).slice(0, 50000),
        completed_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }

    // 4. Audit log
    try {
      const supabase = createServerSupabase();
      await supabase.from('audit_log').insert({
        agent_id: agentId,
        type: 'task_execution',
        action: `[EXECUTE] ${CODENAMES[agentId] || agentId} completed in ${Date.now() - start}ms via ${aiResult?.provider || 'data-only'}`,
        details: JSON.stringify({ elapsed: Date.now() - start, provider: aiResult?.provider, tokens: aiResult?.tokens }),
      });
    } catch { /* non-critical */ }

    const report: AgentReport = {
      agentId,
      codename: CODENAMES[agentId] || agentId.toUpperCase(),
      status: aiResult ? 'completed' : 'partial',
      report: {
        title: wf.title,
        summary: parsed.summary,
        sections: parsed.sections,
        metrics: wf.metrics,
        recommendations: parsed.recommendations,
        warnings: parsed.warnings,
      },
      dataSources: wf.dataSources,
      ai: aiResult
        ? { provider: aiResult.provider, model: aiResult.model, tokensUsed: aiResult.tokens }
        : null,
      timestamp: new Date().toISOString(),
      elapsed_ms: Date.now() - start,
    };

    return NextResponse.json(report);
  } catch (err: any) {
    console.error('[POST /api/admin/agents/execute]', err);
    return NextResponse.json({ error: 'Agent execution failed', message: err.message }, { status: 500 });
  }
}
