'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Loader2, Play, AlertTriangle, CheckCircle2, XCircle,
  ScrollText, DollarSign, GitBranch, Radio, Pause, ChevronDown, ChevronRight,
  Clock, Activity, Shield, Zap,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  agentId: string;
  type: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface Budget {
  agentId: string;
  category: string;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  dailySpentUsd: number;
  monthlySpentUsd: number;
  paused: boolean;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  steps: { id: string; name: string; type: string }[];
  schedule?: string;
}

interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  steps: { id: string; status: string; duration?: number }[];
}

interface TaskEvent {
  id: string;
  agentId: string;
  type: string;
  status: string;
  message: string;
  timestamp: string;
}

type Tab = 'audit' | 'budgets' | 'pipelines' | 'tasks';

// ── Audit Log Panel ──────────────────────────────────────────────────────────

function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter) params.set('agentId', filter);
      const res = await apiFetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter by agent ID..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 px-3 py-1.5 rounded border border-gray-800 bg-gray-900/60 text-[10px] font-mono text-gray-300 placeholder-gray-600 focus:border-btc-orange/50 focus:outline-none"
        />
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1.5 rounded border border-gray-800 bg-gray-900 text-[9px] font-mono text-gray-400 hover:text-btc-orange transition-colors"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        </button>
      </div>

      {/* Events list */}
      {loading && events.length === 0 ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-12 bg-gray-900/60 border border-gray-800 rounded animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="border border-gray-800 rounded-lg p-6 bg-gray-900/60 text-center">
          <ScrollText className="w-5 h-5 text-gray-600 mx-auto mb-2" />
          <p className="text-[10px] font-mono text-gray-600">No audit events found</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map((event, i) => (
            <div key={event.id || i} className="border border-gray-800 rounded p-2.5 bg-gray-900/60 hover:border-gray-700 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    event.type === 'error' ? 'bg-red-500' :
                    event.type === 'warning' ? 'bg-yellow-500' :
                    event.type === 'security' ? 'bg-orange-500' : 'bg-green-500'
                  }`} />
                  <span className="text-[9px] font-mono text-btc-orange font-bold uppercase tracking-wider">
                    {event.agentId}
                  </span>
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-gray-700/50 bg-gray-800/50 text-gray-500">
                    {event.type}
                  </span>
                </div>
                <span className="text-[8px] font-mono text-gray-600">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[9px] font-mono text-gray-400 leading-relaxed">{event.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Budget Panel ─────────────────────────────────────────────────────────────

function BudgetPanel() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [consumption, setConsumption] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch both budget and usage data in parallel
      const [budgetRes, usageRes] = await Promise.all([
        apiFetch('/api/admin/budget'),
        apiFetch('/api/usage'),
      ]);

      if (budgetRes.ok) {
        const data = await budgetRes.json();
        const raw = data.budgets;
        const modelRoutes = data.modelRoutes || {};
        if (Array.isArray(raw)) {
          setBudgets(raw);
        } else if (raw && typeof raw === 'object') {
          setBudgets(Object.entries(raw).map(([id, b]: [string, any]) => ({
            ...b,
            agentId: id,
            category: modelRoutes[id]?.tier || 'operations',
          })));
        } else {
          setBudgets([]);
        }
        setModels(data.availableModels || []);
      }

      if (usageRes.ok) {
        const usageData = await usageRes.json();
        setConsumption(usageData.consumption);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const togglePause = async (agentId: string, currentPaused: boolean) => {
    try {
      await apiFetch('/api/admin/budget', {
        method: 'POST',
        body: JSON.stringify({ agentId, paused: !currentPaused }),
      });
      load();
    } catch { /* silent */ }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1,2,3,4].map(i => (
          <div key={i} className="h-20 bg-gray-900/60 border border-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (budgets.length === 0) {
    return (
      <div className="border border-gray-800 rounded-lg p-6 bg-gray-900/60 text-center">
        <DollarSign className="w-5 h-5 text-gray-600 mx-auto mb-2" />
        <p className="text-[10px] font-mono text-gray-600">No budgets configured</p>
        {models.length > 0 && (
          <p className="text-[8px] font-mono text-gray-700 mt-1">
            Available models: {models.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="border border-gray-800 rounded-lg p-2.5 bg-gray-900/60">
          <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider">Total Agents</div>
          <div className="text-lg font-mono text-gray-200 mt-0.5">{budgets.length}</div>
        </div>
        <div className="border border-gray-800 rounded-lg p-2.5 bg-gray-900/60">
          <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider">Active</div>
          <div className="text-lg font-mono text-green-400 mt-0.5">{budgets.filter(b => !b.paused).length}</div>
        </div>
        <div className="border border-gray-800 rounded-lg p-2.5 bg-gray-900/60">
          <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider">Paused</div>
          <div className="text-lg font-mono text-yellow-400 mt-0.5">{budgets.filter(b => b.paused).length}</div>
        </div>
      </div>

      {/* Consumption data from /api/usage */}
      {consumption && (
        <div className="grid grid-cols-4 gap-2 mb-3 border-t border-gray-800 pt-3">
          <div className="border border-gray-800/50 rounded-lg p-2 bg-gray-900/30">
            <div className="text-[7px] font-mono text-gray-600 uppercase tracking-wider">Reports</div>
            <div className="text-sm font-mono text-btc-orange mt-0.5">{consumption.reports?.total || 0}</div>
            <div className="text-[7px] font-mono text-gray-600 mt-1">Today: {consumption.reports?.today || 0}</div>
          </div>
          <div className="border border-gray-800/50 rounded-lg p-2 bg-gray-900/30">
            <div className="text-[7px] font-mono text-gray-600 uppercase tracking-wider">Posts</div>
            <div className="text-sm font-mono text-green-400 mt-0.5">{consumption.posts?.posted || 0}</div>
            <div className="text-[7px] font-mono text-gray-600 mt-1">Pending: {consumption.posts?.pending || 0}</div>
          </div>
          <div className="border border-gray-800/50 rounded-lg p-2 bg-gray-900/30">
            <div className="text-[7px] font-mono text-gray-600 uppercase tracking-wider">Schedules</div>
            <div className="text-sm font-mono text-yellow-400 mt-0.5">{consumption.scheduledReports?.active || 0}</div>
            <div className="text-[7px] font-mono text-gray-600 mt-1">Total: {consumption.scheduledReports?.total || 0}</div>
          </div>
          <div className="border border-gray-800/50 rounded-lg p-2 bg-gray-900/30">
            <div className="text-[7px] font-mono text-gray-600 uppercase tracking-wider">Platforms</div>
            <div className="text-sm font-mono text-blue-400 mt-0.5">{consumption.connectedPlatforms?.length || 0}</div>
            <div className="text-[7px] font-mono text-gray-600 mt-1 truncate">{consumption.connectedPlatforms?.join(', ') || 'None'}</div>
          </div>
        </div>
      )}

      {/* Budget cards */}
      {budgets.map(budget => {
        const dailyPct = budget.dailyLimitUsd > 0 ? (budget.dailySpentUsd / budget.dailyLimitUsd) * 100 : 0;
        const monthlyPct = budget.monthlyLimitUsd > 0 ? (budget.monthlySpentUsd / budget.monthlyLimitUsd) * 100 : 0;

        return (
          <div key={budget.agentId} className={`border rounded-lg p-3 transition-all ${
            budget.paused
              ? 'border-yellow-900/30 bg-yellow-950/10'
              : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${budget.paused ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <span className="text-[10px] font-mono text-gray-200 font-bold">{budget.agentId}</span>
                <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-gray-700/50 text-gray-500">{budget.category}</span>
              </div>
              <button
                onClick={() => togglePause(budget.agentId, budget.paused)}
                className={`flex items-center gap-1 px-2 py-1 rounded border text-[8px] font-mono transition-colors ${
                  budget.paused
                    ? 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                    : 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10'
                }`}
              >
                {budget.paused ? <Play size={8} /> : <Pause size={8} />}
                {budget.paused ? 'Resume' : 'Pause'}
              </button>
            </div>

            {/* Daily budget bar */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[8px] font-mono text-gray-600 w-10">Daily</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    dailyPct > 90 ? 'bg-red-500' : dailyPct > 70 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(dailyPct, 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-mono text-gray-500 w-24 text-right">
                ${budget.dailySpentUsd.toFixed(2)} / ${budget.dailyLimitUsd.toFixed(2)}
              </span>
            </div>

            {/* Monthly budget bar */}
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-gray-600 w-10">Month</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    monthlyPct > 90 ? 'bg-red-500' : monthlyPct > 70 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(monthlyPct, 100)}%` }}
                />
              </div>
              <span className="text-[8px] font-mono text-gray-500 w-24 text-right">
                ${budget.monthlySpentUsd.toFixed(2)} / ${budget.monthlyLimitUsd.toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Pipeline Panel ───────────────────────────────────────────────────────────

function PipelinePanel() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/pipeline');
      if (res.ok) {
        const data = await res.json();
        setPipelines(data.pipelines || []);
        setRuns(data.runs || []);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const trigger = async (pipelineId: string) => {
    setRunning(pipelineId);
    try {
      const res = await apiFetch('/api/admin/pipeline', {
        method: 'POST',
        body: JSON.stringify({ pipelineId }),
      });
      if (res.ok) {
        setTimeout(load, 2000); // Reload after 2s to pick up the new run
      }
    } catch { /* silent */ } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1,2,3].map(i => (
          <div key={i} className="h-24 bg-gray-900/60 border border-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Pipelines */}
      {pipelines.length === 0 ? (
        <div className="border border-gray-800 rounded-lg p-6 bg-gray-900/60 text-center">
          <GitBranch className="w-5 h-5 text-gray-600 mx-auto mb-2" />
          <p className="text-[10px] font-mono text-gray-600">No pipelines configured</p>
        </div>
      ) : (
        pipelines.map(pipeline => (
          <div key={pipeline.id} className="border border-gray-800 rounded-lg p-3 bg-gray-900/60 hover:border-gray-700 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <GitBranch className="w-3 h-3 text-btc-orange" />
                  <span className="text-[10px] font-mono text-gray-200 font-bold">{pipeline.name}</span>
                </div>
                <p className="text-[9px] font-mono text-gray-500 mt-0.5 ml-5">{pipeline.description}</p>
              </div>
              <button
                onClick={() => trigger(pipeline.id)}
                disabled={running === pipeline.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-btc-orange/30 bg-btc-orange/5 text-btc-orange text-[9px] font-mono uppercase tracking-wider hover:bg-btc-orange/10 transition-all disabled:opacity-40"
              >
                {running === pipeline.id ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                {running === pipeline.id ? 'Running...' : 'Execute'}
              </button>
            </div>

            {/* Steps visualization */}
            <div className="flex items-center gap-1 ml-5">
              {pipeline.steps.map((step, i) => (
                <React.Fragment key={step.id}>
                  <div className="flex items-center gap-1 px-2 py-1 rounded border border-gray-700/50 bg-gray-800/50">
                    <span className="text-[7px] font-mono text-gray-400">{i + 1}</span>
                    <span className="text-[8px] font-mono text-gray-500">{step.name}</span>
                  </div>
                  {i < pipeline.steps.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-gray-700 flex-shrink-0" />
                  )}
                </React.Fragment>
              ))}
            </div>

            {pipeline.schedule && (
              <div className="flex items-center gap-1 mt-2 ml-5">
                <Clock size={8} className="text-gray-600" />
                <span className="text-[8px] font-mono text-gray-600">{pipeline.schedule}</span>
              </div>
            )}
          </div>
        ))
      )}

      {/* Recent runs */}
      {runs.length > 0 && (
        <div>
          <h3 className="text-[9px] font-mono text-gray-600 uppercase tracking-widest mb-2">Recent Runs</h3>
          <div className="space-y-1">
            {runs.slice(0, 10).map((run, i) => (
              <div key={run.id || i} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800/50 bg-gray-900/40">
                {run.status === 'completed' ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                ) : run.status === 'failed' ? (
                  <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                ) : (
                  <Loader2 className="w-3 h-3 text-btc-orange animate-spin flex-shrink-0" />
                )}
                <span className="text-[9px] font-mono text-gray-400 flex-1">{run.pipelineId}</span>
                <span className={`text-[8px] font-mono ${
                  run.status === 'completed' ? 'text-green-400/60' :
                  run.status === 'failed' ? 'text-red-400/60' : 'text-btc-orange/60'
                }`}>{run.status}</span>
                <span className="text-[8px] font-mono text-gray-600">
                  {new Date(run.startedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live Tasks Panel (SSE) ───────────────────────────────────────────────────

function LiveTasksPanel() {
  const [tasks, setTasks] = useState<TaskEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;

    try {
      es = new EventSource('/api/sse/tasks');

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setTasks(prev => [data, ...prev].slice(0, 50));
        } catch { /* skip malformed */ }
      };

      es.onerror = () => {
        setConnected(false);
        setError('SSE connection lost — retrying...');
      };
    } catch (err) {
      setError('Failed to connect to task stream');
    }

    return () => {
      es?.close();
    };
  }, []);

  return (
    <div className="space-y-3">
      {/* Connection status */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded border ${
        connected
          ? 'border-green-500/30 bg-green-500/5'
          : error
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-gray-800 bg-gray-900/60'
      }`}>
        <div className={`w-2 h-2 rounded-full ${
          connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)] animate-pulse' :
          error ? 'bg-red-500' : 'bg-gray-600'
        }`} />
        <span className={`text-[9px] font-mono ${
          connected ? 'text-green-400' : error ? 'text-red-400' : 'text-gray-500'
        }`}>
          {connected ? 'Connected to task stream' : error || 'Connecting...'}
        </span>
        {connected && (
          <span className="text-[8px] font-mono text-gray-600 ml-auto">
            {tasks.length} events received
          </span>
        )}
      </div>

      {/* Task events */}
      {tasks.length === 0 ? (
        <div className="border border-gray-800 rounded-lg p-6 bg-gray-900/60 text-center">
          <Activity className="w-5 h-5 text-gray-600 mx-auto mb-2" />
          <p className="text-[10px] font-mono text-gray-600">
            {connected ? 'Waiting for task events...' : 'Connect to see live tasks'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {tasks.map((task, i) => (
            <div key={task.id || i} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800/50 bg-gray-900/40 hover:border-gray-700/50 transition-colors">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                task.status === 'completed' ? 'bg-green-500' :
                task.status === 'failed' ? 'bg-red-500' :
                task.status === 'running' ? 'bg-btc-orange animate-pulse' : 'bg-gray-500'
              }`} />
              <span className="text-[9px] font-mono text-btc-orange font-bold w-20 truncate">{task.agentId}</span>
              <span className="text-[9px] font-mono text-gray-400 flex-1 truncate">{task.message}</span>
              <span className="text-[8px] font-mono text-gray-600 flex-shrink-0">
                {new Date(task.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'audit', label: 'Audit Log', icon: <ScrollText size={12} /> },
  { id: 'budgets', label: 'Budgets', icon: <DollarSign size={12} /> },
  { id: 'pipelines', label: 'Pipelines', icon: <GitBranch size={12} /> },
  { id: 'tasks', label: 'Live Tasks', icon: <Radio size={12} /> },
];

export function OperationsHub() {
  const [activeTab, setActiveTab] = useState<Tab>('audit');

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-mono text-gray-200 tracking-tight flex items-center gap-2">
            <Shield className="w-4 h-4 text-btc-orange" />
            Operations Hub
          </h1>
          <p className="text-[10px] font-mono text-gray-600 mt-1">
            Audit logs, agent budgets, pipeline execution, and live task monitoring
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-800 pb-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t text-[10px] font-mono transition-all ${
              activeTab === tab.id
                ? 'text-btc-orange border-b-2 border-btc-orange bg-btc-orange/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'tasks' && (
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'audit' && <AuditPanel />}
      {activeTab === 'budgets' && <BudgetPanel />}
      {activeTab === 'pipelines' && <PipelinePanel />}
      {activeTab === 'tasks' && <LiveTasksPanel />}
    </div>
  );
}
