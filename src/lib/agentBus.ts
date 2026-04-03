// ── Agent Communication Bus + DAG Pipeline + Budget Guardrails ──────────────
// Lightweight pub/sub system for inter-agent messaging, pipeline orchestration,
// cost budget tracking, and multi-model routing.

import { createServerSupabase } from '@/lib/supabase';

// ══════════════════════════════════════════════════════════════════════════════
// § 1. Agent Communication Bus (Pub/Sub)
// ══════════════════════════════════════════════════════════════════════════════

interface BusMessage {
  id: string;
  from: string;       // source agent ID
  channel: string;    // e.g. 'briefs', 'alerts', 'market-data'
  payload: any;
  timestamp: number;
}

type Subscriber = (msg: BusMessage) => void | Promise<void>;

class AgentBus {
  private channels: Map<string, Set<Subscriber>> = new Map();
  private history: BusMessage[] = [];
  private maxHistory = 200;

  subscribe(channel: string, handler: Subscriber): () => void {
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel)!.add(handler);
    return () => this.channels.get(channel)?.delete(handler);
  }

  async publish(from: string, channel: string, payload: any): Promise<void> {
    const msg: BusMessage = {
      id: `${from}-${channel}-${Date.now()}`,
      from,
      channel,
      payload,
      timestamp: Date.now(),
    };

    this.history.push(msg);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);

    // Also persist to Supabase for cross-instance delivery
    try {
      const supabase = createServerSupabase();
      await supabase.from('agent_bus_messages').insert({
        id: msg.id,
        from_agent: from,
        channel,
        payload: JSON.stringify(payload),
        created_at: new Date(msg.timestamp).toISOString(),
      });
    } catch { /* table might not exist yet */ }

    // Deliver to in-memory subscribers
    const subs = this.channels.get(channel);
    if (subs) {
      for (const handler of subs) {
        try { await handler(msg); } catch (err) {
          console.error(`[AgentBus] Handler error on ${channel}:`, err);
        }
      }
    }

    // Also deliver to wildcard subscribers
    const wildcardSubs = this.channels.get('*');
    if (wildcardSubs) {
      for (const handler of wildcardSubs) {
        try { await handler(msg); } catch { /* ignore */ }
      }
    }
  }

  getHistory(channel?: string, limit = 50): BusMessage[] {
    const msgs = channel ? this.history.filter(m => m.channel === channel) : this.history;
    return msgs.slice(-limit);
  }

  getChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

// Singleton
export const agentBus = new AgentBus();

// ── Agent Task Persistence ──────────────────────────────────────────────────────

async function persistTaskToSupabase(task: any) {
  try {
    const supabase = createServerSupabase();
    if (!supabase) return;

    await supabase.from('agent_tasks').upsert(
      {
        id: task.id,
        agent_id: task.agentId || task.from,
        status: task.status,
        type: task.type || task.channel,
        payload: task.payload || task.data ? JSON.stringify(task.payload || task.data) : null,
        result: task.result ? JSON.stringify(task.result) : null,
        created_at: task.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  } catch (err) {
    console.error('[AgentBus] Failed to persist task:', err);
  }
}

export async function loadTaskHistoryFromSupabase(agentId?: string, limit = 50): Promise<any[]> {
  try {
    const supabase = createServerSupabase();
    if (!supabase) return [];

    let query = supabase.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(limit);

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[AgentBus] Failed to load task history:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[AgentBus] Exception loading task history:', err);
    return [];
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// § 2. DAG Pipeline Runner
// ══════════════════════════════════════════════════════════════════════════════

export interface PipelineStep {
  agentId: string;
  taskTemplate: string;     // task template key from AGENT_TASK_TEMPLATES
  dependsOn?: string[];     // agentIds that must complete first
  model?: string;           // override model for this step
}

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  stepResults: Record<string, { status: string; result?: any; error?: string; startedAt: string; completedAt?: string }>;
  totalCost: number;
}

// Pre-defined pipelines
export const PIPELINES: PipelineDefinition[] = [
  {
    id: 'morning-pipeline',
    name: 'Morning Intelligence Pipeline',
    description: 'Full morning brief → content generation → scheduling chain',
    steps: [
      { agentId: 'market-scanner', taskTemplate: 'fred-scan' },
      { agentId: 'data-enrichment', taskTemplate: 'divergence-analysis', dependsOn: ['market-scanner'] },
      { agentId: 'intelligence', taskTemplate: 'morning-brief', dependsOn: ['data-enrichment'] },
      { agentId: 'revops', taskTemplate: 'content-from-intelligence', dependsOn: ['intelligence'] },
      { agentId: 'auto-scheduler', taskTemplate: 'schedule-distribution', dependsOn: ['revops'] },
    ],
  },
  {
    id: 'risk-assessment',
    name: 'Risk Assessment Pipeline',
    description: 'Market scan → risk analysis → portfolio check → executive report',
    steps: [
      { agentId: 'market-scanner', taskTemplate: 'crypto-whales' },
      { agentId: 'intelligence', taskTemplate: 'weekly-risk' },
      { agentId: 'asset-management', taskTemplate: 'portfolio-allocation', dependsOn: ['intelligence'] },
      { agentId: 'active-partner', taskTemplate: 'executive-dashboard', dependsOn: ['asset-management'] },
    ],
  },
  {
    id: 'infra-health',
    name: 'Infrastructure Health Check',
    description: 'Full system health → API audit → build check',
    steps: [
      { agentId: 'it', taskTemplate: 'infra-health-sweep' },
      { agentId: 'it', taskTemplate: 'api-key-audit' },
      { agentId: 'engineer', taskTemplate: 'build-health', dependsOn: ['it'] },
      { agentId: 'end-user-deployment', taskTemplate: 'cross-agent-audit', dependsOn: ['engineer'] },
    ],
  },
  {
    id: 'quality-loop',
    name: 'Quality Assurance Loop',
    description: 'Generate report → validate quality → check engagement → rank performance',
    steps: [
      { agentId: 'intelligence', taskTemplate: 'morning-brief' },
      { agentId: 'end-user-deployment', taskTemplate: 'report-quality-validation', dependsOn: ['intelligence'] },
      { agentId: 'end-user-deployment', taskTemplate: 'user-engagement', dependsOn: ['end-user-deployment'] },
      { agentId: 'hr', taskTemplate: 'performance-rankings', dependsOn: ['end-user-deployment'] },
    ],
  },
];

// In-memory pipeline run tracker
const activeRuns: Map<string, PipelineRun> = new Map();

export async function runPipeline(pipelineId: string): Promise<PipelineRun> {
  const pipeline = PIPELINES.find(p => p.id === pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  const runId = `${pipelineId}-${Date.now()}`;
  const run: PipelineRun = {
    id: runId,
    pipelineId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    stepResults: {},
    totalCost: 0,
  };
  activeRuns.set(runId, run);

  // Publish pipeline start event
  agentBus.publish('pipeline-runner', 'pipeline-events', { type: 'started', runId, pipelineId });

  // Execute DAG
  try {
    await executePipelineDAG(pipeline, run);
    run.status = 'completed';
  } catch (err) {
    run.status = 'failed';
  }

  run.completedAt = new Date().toISOString();
  agentBus.publish('pipeline-runner', 'pipeline-events', { type: run.status, runId, pipelineId });

  // Log to audit
  await logAuditEvent({
    type: 'pipeline_run',
    agentId: 'pipeline-runner',
    action: `Pipeline ${pipelineId} ${run.status}`,
    details: { runId, steps: Object.keys(run.stepResults).length, totalCost: run.totalCost },
  });

  return run;
}

async function executePipelineDAG(pipeline: PipelineDefinition, run: PipelineRun): Promise<void> {
  const completed = new Set<string>();
  const steps = [...pipeline.steps];

  while (steps.length > 0) {
    // Find steps whose dependencies are satisfied
    const ready = steps.filter(s =>
      !s.dependsOn || s.dependsOn.every(dep => completed.has(dep))
    );

    if (ready.length === 0) {
      throw new Error('Pipeline deadlock: no runnable steps but steps remain');
    }

    // Execute ready steps in parallel
    await Promise.all(ready.map(async (step) => {
      const stepKey = `${step.agentId}:${step.taskTemplate}`;
      const taskId = `${run.pipelineId}-${step.agentId}-${Date.now()}`;
      run.stepResults[stepKey] = { status: 'running', startedAt: new Date().toISOString() };

      // Persist task startup
      await persistTaskToSupabase({
        id: taskId,
        agentId: step.agentId,
        status: 'running',
        type: step.taskTemplate,
        createdAt: run.stepResults[stepKey].startedAt,
      });

      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

        // Seed + auto-approve + execute the task
        const seedRes = await fetch(`${baseUrl}/api/admin/agents/${step.agentId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'seed' }),
        });
        const seedData = await seedRes.json().catch(() => ({}));

        // Find the seeded task matching our template
        const seededTask = seedData.seeded?.find((t: any) =>
          t.title.toLowerCase().includes(step.taskTemplate.replace(/-/g, ' '))
        ) || seedData.seeded?.[0];

        if (seededTask) {
          // Auto-approve
          await fetch(`${baseUrl}/api/admin/agents/${step.agentId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', taskId: seededTask.id }),
          });

          // Execute
          const execRes = await fetch(`${baseUrl}/api/admin/agents/${step.agentId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'execute', taskId: seededTask.id }),
          });
          const execData = await execRes.json().catch(() => ({}));

          // Publish result to bus so downstream agents can consume
          agentBus.publish(step.agentId, 'task-results', {
            agentId: step.agentId,
            taskTemplate: step.taskTemplate,
            result: execData,
          });

          const completedResult = {
            status: 'completed',
            result: execData,
            startedAt: run.stepResults[stepKey].startedAt,
            completedAt: new Date().toISOString(),
          };
          run.stepResults[stepKey] = completedResult;

          // Persist task completion
          await persistTaskToSupabase({
            id: taskId,
            agentId: step.agentId,
            status: 'completed',
            type: step.taskTemplate,
            result: execData,
            createdAt: run.stepResults[stepKey].startedAt,
            completedAt: completedResult.completedAt,
          });
        } else {
          const failedResult = {
            status: 'failed',
            error: 'No matching task template found after seeding',
            startedAt: run.stepResults[stepKey].startedAt,
            completedAt: new Date().toISOString(),
          };
          run.stepResults[stepKey] = failedResult;

          // Persist task failure
          await persistTaskToSupabase({
            id: taskId,
            agentId: step.agentId,
            status: 'failed',
            type: step.taskTemplate,
            result: { error: 'No matching task template found after seeding' },
            createdAt: run.stepResults[stepKey].startedAt,
            completedAt: failedResult.completedAt,
          });
        }

        completed.add(step.agentId);
      } catch (err) {
        const failedResult = {
          status: 'failed',
          error: (err as Error).message,
          startedAt: run.stepResults[stepKey].startedAt,
          completedAt: new Date().toISOString(),
        };
        run.stepResults[stepKey] = failedResult;

        // Persist task exception
        await persistTaskToSupabase({
          id: taskId,
          agentId: step.agentId,
          status: 'failed',
          type: step.taskTemplate,
          result: { error: (err as Error).message },
          createdAt: run.stepResults[stepKey].startedAt,
          completedAt: failedResult.completedAt,
        });
        // Don't throw — let other parallel steps continue
      }
    }));

    // Remove completed steps
    for (const step of ready) {
      const idx = steps.indexOf(step);
      if (idx >= 0) steps.splice(idx, 1);
    }
  }
}

export function getPipelineRun(runId: string): PipelineRun | undefined {
  return activeRuns.get(runId);
}

export function listPipelineRuns(): PipelineRun[] {
  return Array.from(activeRuns.values()).sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// § 3. Cost Budget Guardrails
// ══════════════════════════════════════════════════════════════════════════════

interface AgentBudget {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  dailySpentUsd: number;
  monthlySpentUsd: number;
  lastResetDaily: string;
  lastResetMonthly: string;
  paused: boolean;
}

// Default budgets per agent category
const DEFAULT_BUDGETS: Record<string, { daily: number; monthly: number }> = {
  intelligence: { daily: 5.0, monthly: 100.0 },
  data: { daily: 2.0, monthly: 50.0 },
  social: { daily: 1.0, monthly: 25.0 },
  infra: { daily: 0.5, monthly: 15.0 },
  operations: { daily: 1.0, monthly: 30.0 },
  finance: { daily: 2.0, monthly: 60.0 },
  leadership: { daily: 3.0, monthly: 80.0 },
  engineering: { daily: 1.0, monthly: 25.0 },
};

// In-memory budget tracker (persists to Supabase on changes)
const budgets: Map<string, AgentBudget> = new Map();

export function getAgentBudget(agentId: string, category: string): AgentBudget {
  if (!budgets.has(agentId)) {
    const defaults = DEFAULT_BUDGETS[category] || { daily: 1.0, monthly: 25.0 };
    budgets.set(agentId, {
      dailyLimitUsd: defaults.daily,
      monthlyLimitUsd: defaults.monthly,
      dailySpentUsd: 0,
      monthlySpentUsd: 0,
      lastResetDaily: new Date().toISOString().split('T')[0],
      lastResetMonthly: new Date().toISOString().slice(0, 7),
      paused: false,
    });
  }

  const budget = budgets.get(agentId)!;
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().toISOString().slice(0, 7);

  // Auto-reset daily
  if (budget.lastResetDaily !== today) {
    budget.dailySpentUsd = 0;
    budget.lastResetDaily = today;
  }

  // Auto-reset monthly
  if (budget.lastResetMonthly !== thisMonth) {
    budget.monthlySpentUsd = 0;
    budget.lastResetMonthly = thisMonth;
    budget.paused = false; // unpause on new month
  }

  return budget;
}

export interface BudgetCheckResult { allowed: boolean; reason?: string; remaining: number }

export function checkBudget(agentId: string, category: string, estimatedCostUsd: number): BudgetCheckResult {
  const budget = getAgentBudget(agentId, category);
  const remaining = Math.max(0, budget.dailyLimitUsd - budget.dailySpentUsd);

  if (budget.paused) {
    return { allowed: false, reason: `Agent ${agentId} is paused due to budget cap`, remaining: 0 };
  }

  if (budget.dailySpentUsd + estimatedCostUsd > budget.dailyLimitUsd) {
    return { allowed: false, reason: `Daily budget exceeded: $${budget.dailySpentUsd.toFixed(2)}/$${budget.dailyLimitUsd.toFixed(2)}`, remaining };
  }

  if (budget.monthlySpentUsd + estimatedCostUsd > budget.monthlyLimitUsd) {
    return { allowed: false, reason: `Monthly budget exceeded: $${budget.monthlySpentUsd.toFixed(2)}/$${budget.monthlyLimitUsd.toFixed(2)}`, remaining };
  }

  return { allowed: true, remaining };
}

export function recordSpend(agentId: string, category: string, costUsd: number): void {
  const budget = getAgentBudget(agentId, category);
  budget.dailySpentUsd += costUsd;
  budget.monthlySpentUsd += costUsd;

  // Auto-pause if over 90% of daily limit
  if (budget.dailySpentUsd >= budget.dailyLimitUsd * 0.9) {
    agentBus.publish('budget-guardian', 'alerts', {
      type: 'budget_warning',
      agentId,
      message: `Agent ${agentId} at ${Math.round((budget.dailySpentUsd / budget.dailyLimitUsd) * 100)}% of daily budget`,
      spent: budget.dailySpentUsd,
      limit: budget.dailyLimitUsd,
    });
  }

  if (budget.dailySpentUsd >= budget.dailyLimitUsd) {
    budget.paused = true;
    agentBus.publish('budget-guardian', 'alerts', {
      type: 'budget_exceeded',
      agentId,
      message: `Agent ${agentId} paused — daily budget exceeded ($${budget.dailySpentUsd.toFixed(2)}/$${budget.dailyLimitUsd.toFixed(2)})`,
    });
  }
}

export function updateBudget(agentId: string, category: string, updates: Partial<Pick<AgentBudget, 'dailyLimitUsd' | 'monthlyLimitUsd' | 'paused'>>): AgentBudget {
  const budget = getAgentBudget(agentId, category);
  if (updates.dailyLimitUsd !== undefined) budget.dailyLimitUsd = updates.dailyLimitUsd;
  if (updates.monthlyLimitUsd !== undefined) budget.monthlyLimitUsd = updates.monthlyLimitUsd;
  if (updates.paused !== undefined) budget.paused = updates.paused;
  return budget;
}

export function getAllBudgets(): Record<string, AgentBudget> {
  const result: Record<string, AgentBudget> = {};
  for (const [id, budget] of budgets) {
    result[id] = budget;
  }
  return result;
}

// Core operational agents to auto-seed budgets for
const CORE_AGENTS: Array<{ id: string; category: string }> = [
  // Testing budget — low limits for safe experimentation
  { id: 'testing', category: 'infra' },
  // Intelligence & Leadership
  { id: 'intelligence', category: 'intelligence' },
  { id: 'ares-hunter', category: 'leadership' },
  { id: 'active-partner', category: 'leadership' },
  { id: 'passive-partner', category: 'leadership' },
  // Finance
  { id: 'bookkeeping', category: 'finance' },
  { id: 'asset-management', category: 'finance' },
  { id: 'private-equity', category: 'finance' },
  // Operations
  { id: 'revops', category: 'operations' },
  { id: 'hr', category: 'operations' },
  { id: 'end-user-deployment', category: 'operations' },
  // Data
  { id: 'market-scanner', category: 'data' },
  { id: 'data-enrichment', category: 'data' },
  { id: 'tradingview-relay', category: 'data' },
  // Engineering
  { id: 'engineer', category: 'engineering' },
  { id: 'dev', category: 'engineering' },
  { id: 'it', category: 'engineering' },
  // Social / Content
  { id: 'auto-scheduler', category: 'social' },
];

/** Ensure core agents have budgets initialized. Safe to call repeatedly. */
export function seedBudgets(): void {
  for (const { id, category } of CORE_AGENTS) {
    getAgentBudget(id, category); // creates if missing, no-op if exists
  }
  // Give the testing budget intentionally low limits
  const testBudget = budgets.get('testing');
  if (testBudget && testBudget.dailyLimitUsd === DEFAULT_BUDGETS['infra'].daily) {
    testBudget.dailyLimitUsd = 0.25;
    testBudget.monthlyLimitUsd = 5.0;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// § 4. Audit Log
// ══════════════════════════════════════════════════════════════════════════════

export interface AuditEvent {
  id: string;
  type: string;
  agentId: string;
  action: string;
  details?: Record<string, any>;
  timestamp: string;
  tokensUsed?: number;
  latencyMs?: number;
  modelUsed?: string;
  costUsd?: number;
}

// In-memory audit log with overflow to Supabase
const auditLog: AuditEvent[] = [];
const MAX_MEMORY_EVENTS = 500;

export async function logAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> {
  const full: AuditEvent = {
    ...event,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };

  auditLog.push(full);
  if (auditLog.length > MAX_MEMORY_EVENTS) auditLog.splice(0, auditLog.length - MAX_MEMORY_EVENTS);

  // Persist to Supabase
  try {
    const supabase = createServerSupabase();
    await supabase.from('audit_log').insert({
      id: full.id,
      type: full.type,
      agent_id: full.agentId,
      action: full.action,
      details: JSON.stringify(full.details),
      tokens_used: full.tokensUsed || null,
      latency_ms: full.latencyMs || null,
      model_used: full.modelUsed || null,
      cost_usd: full.costUsd || null,
      created_at: full.timestamp,
    });
  } catch { /* table might not exist */ }

  return full;
}

export function getAuditLog(options: { agentId?: string; type?: string; limit?: number; since?: string } = {}): AuditEvent[] {
  let events = [...auditLog];
  if (options.agentId) events = events.filter(e => e.agentId === options.agentId);
  if (options.type) events = events.filter(e => e.type === options.type);
  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
  }
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events.slice(0, options.limit || 100);
}


// ══════════════════════════════════════════════════════════════════════════════
// § 5. Multi-Model Routing
// ══════════════════════════════════════════════════════════════════════════════

export interface ModelRoute {
  model: string;
  provider: 'claude' | 'gemini' | 'openai';
  costPer1kTokens: number;  // USD
  maxTokens: number;
  tier: 'fast' | 'balanced' | 'deep';
}

const AVAILABLE_MODELS: ModelRoute[] = [
  { model: 'claude-3-5-haiku-20241022', provider: 'claude', costPer1kTokens: 0.001, maxTokens: 8192, tier: 'fast' },
  { model: 'claude-sonnet-4-20250514', provider: 'claude', costPer1kTokens: 0.003, maxTokens: 8192, tier: 'balanced' },
  { model: 'claude-opus-4-20250514', provider: 'claude', costPer1kTokens: 0.015, maxTokens: 4096, tier: 'deep' },
  { model: 'gemini-2.0-flash', provider: 'gemini', costPer1kTokens: 0.0004, maxTokens: 8192, tier: 'fast' },
  { model: 'gpt-4o-mini', provider: 'openai', costPer1kTokens: 0.00015, maxTokens: 16384, tier: 'fast' },
  { model: 'gpt-4o', provider: 'openai', costPer1kTokens: 0.005, maxTokens: 16384, tier: 'balanced' },
];

// Agent → preferred tier mapping
const AGENT_MODEL_TIER: Record<string, 'fast' | 'balanced' | 'deep'> = {
  'intelligence': 'deep',
  'ares-hunter': 'deep',
  'active-partner': 'deep',
  'private-equity': 'balanced',
  'asset-management': 'balanced',
  'revops': 'balanced',
  'market-scanner': 'fast',
  'data-enrichment': 'fast',
  'tradingview-relay': 'fast',
  'auto-scheduler': 'fast',
  'it': 'fast',
  'engineer': 'fast',
  'dev': 'fast',
  'bookkeeping': 'fast',
  'passive-partner': 'balanced',
  'hr': 'fast',
  'end-user-deployment': 'balanced',
};

export function routeModel(agentId: string, override?: string): ModelRoute {
  // If explicit override, find it
  if (override) {
    const found = AVAILABLE_MODELS.find(m => m.model === override);
    if (found) return found;
  }

  const tier = AGENT_MODEL_TIER[agentId] || 'balanced';

  // Find cheapest model in the right tier, preferring Claude
  const candidates = AVAILABLE_MODELS.filter(m => m.tier === tier);
  const claudeOption = candidates.find(m => m.provider === 'claude');
  return claudeOption || candidates[0] || AVAILABLE_MODELS[1]; // fallback to sonnet
}

export function getModelRoutes(): Record<string, ModelRoute> {
  const routes: Record<string, ModelRoute> = {};
  for (const agentId of Object.keys(AGENT_MODEL_TIER)) {
    routes[agentId] = routeModel(agentId);
  }
  return routes;
}

export function getAvailableModels(): ModelRoute[] {
  return AVAILABLE_MODELS;
}


// ══════════════════════════════════════════════════════════════════════════════
// § 6. Notification System
// ══════════════════════════════════════════════════════════════════════════════

export interface Notification {
  id: string;
  type: 'task_completed' | 'task_failed' | 'budget_warning' | 'budget_exceeded' | 'session_expired' | 'pipeline_completed' | 'market_alert' | 'system';
  title: string;
  message: string;
  agentId?: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  read: boolean;
  actionUrl?: string;
  timestamp: string;
}

const notifications: Notification[] = [];
const MAX_NOTIFICATIONS = 200;

export function addNotification(n: Omit<Notification, 'id' | 'read' | 'timestamp'>): Notification {
  const full: Notification = {
    ...n,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    read: false,
    timestamp: new Date().toISOString(),
  };
  notifications.unshift(full);
  if (notifications.length > MAX_NOTIFICATIONS) notifications.pop();
  return full;
}

export function getNotifications(options: { unreadOnly?: boolean; limit?: number } = {}): Notification[] {
  let list = [...notifications];
  if (options.unreadOnly) list = list.filter(n => !n.read);
  return list.slice(0, options.limit || 50);
}

export function markNotificationRead(id: string): void {
  const n = notifications.find(n => n.id === id);
  if (n) n.read = true;
}

export function markAllRead(): void {
  for (const n of notifications) n.read = true;
}

export function getUnreadCount(): number {
  return notifications.filter(n => !n.read).length;
}

// ── Agent Definition type + registry stubs ───────────────────────────────────
// Re-exported so taskQueue and eval routes can import from agentBus.

export interface AgentDefinition {
  id: string;
  name: string;
  codename: string;
  category: string;
  status: 'active' | 'draft' | 'disabled';
  dependencies: string[];
  runEndpoint: string;
  evalEndpoint: string;
  description: string;
  version: string;
  capabilities: string[];
  lastRun: string | null;
  profile: Record<string, any>;
  risk: Record<string, any>;
  [key: string]: any;
}

// In-memory registry — populated at runtime by admin/agents route
const agentRegistry = new Map<string, AgentDefinition>();

export function registerAgent(agent: AgentDefinition): void {
  agentRegistry.set(agent.id, agent);
}

export function getAgent(agentId: string): AgentDefinition | undefined {
  return agentRegistry.get(agentId);
}

export function getAgents(): AgentDefinition[] {
  return Array.from(agentRegistry.values());
}

export function checkDependencies(agent: AgentDefinition): { healthy: boolean; missing: string[] } {
  const missing = (agent.dependencies ?? []).filter((dep) => !agentRegistry.has(dep));
  return { healthy: missing.length === 0, missing };
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface EvalResult {
  agentId: string;
  agentName: string;
  timestamp: string;
  healthy: boolean;
  checks: EvalCheck[];
  summary: string;
}

export function evaluateAgent(agentId: string): EvalResult {
  const agent = agentRegistry.get(agentId);
  const checks: EvalCheck[] = [];
  const ts = new Date().toISOString();

  if (!agent) {
    return {
      agentId,
      agentName: 'unknown',
      timestamp: ts,
      healthy: false,
      checks: [{ name: 'exists', passed: false, detail: 'Agent not found in registry' }],
      summary: 'Agent not found',
    };
  }

  // Dependency check
  const deps = checkDependencies(agent);
  checks.push({ name: 'dependencies', passed: deps.healthy, detail: deps.missing.length ? `Missing: ${deps.missing.join(', ')}` : 'All OK' });

  // Budget check
  const budget = checkBudget(agent.id, agent.category, 0);
  checks.push({ name: 'budget', passed: budget.allowed, detail: budget.reason ?? 'Within limits' });

  // Status check
  checks.push({ name: 'status', passed: agent.status === 'active', detail: `Status: ${agent.status}` });

  const healthy = checks.every((c) => c.passed);
  return {
    agentId: agent.id,
    agentName: agent.name,
    timestamp: ts,
    healthy,
    checks,
    summary: healthy ? 'All checks passed' : `${checks.filter((c) => !c.passed).length} check(s) failed`,
  };
}

// ── Auto-wire: Bus events → Notifications ───────────────────────────────────

agentBus.subscribe('alerts', (msg) => {
  const payload = msg.payload;
  if (payload.type === 'budget_warning') {
    addNotification({
      type: 'budget_warning',
      title: 'Budget Warning',
      message: payload.message,
      agentId: payload.agentId,
      severity: 'warning',
    });
  } else if (payload.type === 'budget_exceeded') {
    addNotification({
      type: 'budget_exceeded',
      title: 'Budget Exceeded — Agent Paused',
      message: payload.message,
      agentId: payload.agentId,
      severity: 'error',
      actionUrl: `/agents/${payload.agentId}`,
    });
  }
});

agentBus.subscribe('pipeline-events', (msg) => {
  const payload = msg.payload;
  if (payload.type === 'completed') {
    addNotification({
      type: 'pipeline_completed',
      title: 'Pipeline Completed',
      message: `Pipeline ${payload.pipelineId} finished successfully`,
      severity: 'success',
    });
  } else if (payload.type === 'failed') {
    addNotification({
      type: 'pipeline_completed',
      title: 'Pipeline Failed',
      message: `Pipeline ${payload.pipelineId} failed`,
      severity: 'error',
    });
  }
});
