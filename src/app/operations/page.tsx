'use client';

import React, { useState, useEffect, useCallback, Component, type ErrorInfo, type ReactNode } from 'react';
import { Layout } from '@/components/Layout';
import { Usage } from '@/components/Usage';
import { Billing } from '@/components/Billing';
import { AuditLog } from '@/components/AuditLog';
import { Progress } from '@/components/Progress';
import { useUserData } from '@/hooks/useUserData';
import { apiFetch } from '@/lib/api';
import {
  BarChart3, DollarSign, FileText, Activity,
  GitBranch, Radio, Loader2, Play, Pause, RefreshCw,
  CheckCircle2, XCircle, ChevronRight, Clock, Shield, AlertTriangle,
} from 'lucide-react';

// ── Panel Error Boundary ────────────────────────────────────────────────────
// Catches render errors in individual panels so one broken tab doesn't nuke the page.

interface PanelErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Operations/${this.props.name}] Panel error:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-red-500/20 rounded-lg bg-red-950/10 p-6 text-center">
          <AlertTriangle className="w-5 h-5 text-red-400 mx-auto mb-2" />
          <p className="text-[10px] font-mono text-gray-400 mb-1">
            {this.props.name} failed to load
          </p>
          {this.state.error?.message && (
            <p className="text-[9px] font-mono text-red-400/60 mb-3 break-words">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded border border-btc-orange/30 bg-btc-orange/5 text-btc-orange text-[9px] font-mono uppercase tracking-wider hover:bg-btc-orange/10 transition-colors"
          >
            <RefreshCw size={10} />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Types for new panels ─────────────────────────────────────────────────────

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
}

interface TaskEvent {
  id: string;
  agentId: string;
  type: string;
  status: string;
  message: string;
  timestamp: string;
}

// ── Budget Panel ─────────────────────────────────────────────────────────────

function BudgetPanel() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/budget');
      if (res.ok) {
        const data = await res.json();
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
        <Shield className="w-5 h-5 text-gray-600 mx-auto mb-2" />
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
    <div className="space-y-3">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2">
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

      {/* Budget cards */}
      {budgets.map(budget => {
        const dailyPct = budget.dailyLimitUsd > 0 ? (budget.dailySpentUsd / budget.dailyLimitUsd) * 100 : 0;
        const monthlyPct = budget.monthlyLimitUsd > 0 ? (budget.monthlySpentUsd / budget.monthlyLimitUsd) * 100 : 0;
        return (
          <div key={budget.agentId} className={`border rounded-lg p-3 transition-all ${
            budget.paused ? 'border-yellow-900/30 bg-yellow-950/10' : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
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
                  budget.paused ? 'border-green-500/30 text-green-400 hover:bg-green-500/10' : 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10'
                }`}
              >
                {budget.paused ? <Play size={8} /> : <Pause size={8} />}
                {budget.paused ? 'Resume' : 'Pause'}
              </button>
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[8px] font-mono text-gray-600 w-10">Daily</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${dailyPct > 90 ? 'bg-red-500' : dailyPct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(dailyPct, 100)}%` }} />
              </div>
              <span className="text-[8px] font-mono text-gray-500 w-24 text-right">${budget.dailySpentUsd.toFixed(2)} / ${budget.dailyLimitUsd.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-gray-600 w-10">Month</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${monthlyPct > 90 ? 'bg-red-500' : monthlyPct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(monthlyPct, 100)}%` }} />
              </div>
              <span className="text-[8px] font-mono text-gray-500 w-24 text-right">${budget.monthlySpentUsd.toFixed(2)} / ${budget.monthlyLimitUsd.toFixed(2)}</span>
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
      await apiFetch('/api/admin/pipeline', { method: 'POST', body: JSON.stringify({ pipelineId }) });
      setTimeout(load, 2000);
    } catch { /* silent */ } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-900/60 border border-gray-800 rounded-lg animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-3">
      {pipelines.length === 0 ? (
        <div className="border border-gray-800 rounded-lg p-6 bg-gray-900/60 text-center">
          <GitBranch className="w-5 h-5 text-gray-600 mx-auto mb-2" />
          <p className="text-[10px] font-mono text-gray-600">No pipelines configured</p>
        </div>
      ) : pipelines.map(pipeline => (
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
          <div className="flex items-center gap-1 ml-5 flex-wrap">
            {pipeline.steps.map((step, i) => (
              <React.Fragment key={step.id}>
                <div className="flex items-center gap-1 px-2 py-1 rounded border border-gray-700/50 bg-gray-800/50">
                  <span className="text-[7px] font-mono text-gray-400">{i + 1}</span>
                  <span className="text-[8px] font-mono text-gray-500">{step.name}</span>
                </div>
                {i < pipeline.steps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-700 flex-shrink-0" />}
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
      ))}

      {runs.length > 0 && (
        <div>
          <h3 className="text-[9px] font-mono text-gray-600 uppercase tracking-widest mb-2">Recent Runs</h3>
          <div className="space-y-1">
            {runs.slice(0, 10).map((run, i) => (
              <div key={run.id || i} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800/50 bg-gray-900/40">
                {run.status === 'completed' ? <CheckCircle2 className="w-3 h-3 text-green-500" /> :
                 run.status === 'failed' ? <XCircle className="w-3 h-3 text-red-500" /> :
                 <Loader2 className="w-3 h-3 text-btc-orange animate-spin" />}
                <span className="text-[9px] font-mono text-gray-400 flex-1">{run.pipelineId}</span>
                <span className={`text-[8px] font-mono ${run.status === 'completed' ? 'text-green-400/60' : run.status === 'failed' ? 'text-red-400/60' : 'text-btc-orange/60'}`}>{run.status}</span>
                <span className="text-[8px] font-mono text-gray-600">{new Date(run.startedAt).toLocaleTimeString()}</span>
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
      es.onopen = () => { setConnected(true); setError(null); };
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setTasks(prev => [data, ...prev].slice(0, 50));
        } catch { /* skip */ }
      };
      es.onerror = () => { setConnected(false); setError('SSE connection lost — retrying...'); };
    } catch {
      setError('Failed to connect to task stream');
    }
    return () => { es?.close(); };
  }, []);

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 px-3 py-2 rounded border ${
        connected ? 'border-green-500/30 bg-green-500/5' : error ? 'border-red-500/30 bg-red-500/5' : 'border-gray-800 bg-gray-900/60'
      }`}>
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)] animate-pulse' : error ? 'bg-red-500' : 'bg-gray-600'}`} />
        <span className={`text-[9px] font-mono ${connected ? 'text-green-400' : error ? 'text-red-400' : 'text-gray-500'}`}>
          {connected ? 'Connected to task stream' : error || 'Connecting...'}
        </span>
        {connected && <span className="text-[8px] font-mono text-gray-600 ml-auto">{tasks.length} events</span>}
      </div>

      {tasks.length === 0 ? (
        <div className="border border-gray-800 rounded-lg p-6 bg-gray-900/60 text-center">
          <Activity className="w-5 h-5 text-gray-600 mx-auto mb-2" />
          <p className="text-[10px] font-mono text-gray-600">{connected ? 'Waiting for task events...' : 'Connect to see live tasks'}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {tasks.map((task, i) => (
            <div key={task.id || i} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800/50 bg-gray-900/40">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                task.status === 'completed' ? 'bg-green-500' : task.status === 'failed' ? 'bg-red-500' :
                task.status === 'running' ? 'bg-btc-orange animate-pulse' : 'bg-gray-500'
              }`} />
              <span className="text-[9px] font-mono text-btc-orange font-bold w-20 truncate">{task.agentId}</span>
              <span className="text-[9px] font-mono text-gray-400 flex-1 truncate">{task.message}</span>
              <span className="text-[8px] font-mono text-gray-600 flex-shrink-0">{new Date(task.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab definitions ──────────────────────────────────────────────────────────

const SUB_TABS = [
  { key: 'usage', label: 'Usage', icon: <BarChart3 size={12} /> },
  { key: 'billing', label: 'Billing', icon: <DollarSign size={12} /> },
  { key: 'audit', label: 'Audit', icon: <FileText size={12} /> },
  { key: 'progress', label: 'Progress', icon: <Activity size={12} /> },
  { key: 'budgets', label: 'Budgets', icon: <Shield size={12} /> },
  { key: 'pipelines', label: 'Pipelines', icon: <GitBranch size={12} /> },
  { key: 'tasks', label: 'Live Tasks', icon: <Radio size={12} /> },
] as const;

type SubTab = typeof SUB_TABS[number]['key'];

export default function OperationsPage() {
  const userData = useUserData();
  const [tab, setTab] = useState<SubTab>('usage');

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      {/* Sub-tab navigation */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 pb-px overflow-x-auto">
        {SUB_TABS.map(st => (
          <button
            key={st.key}
            onClick={() => setTab(st.key)}
            className={`flex items-center gap-1.5 text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors whitespace-nowrap ${
              tab === st.key
                ? 'border-btc-orange text-btc-orange'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {st.icon} {st.label}
            {st.key === 'tasks' && <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
          </button>
        ))}
      </div>

      {tab === 'usage' && <PanelErrorBoundary name="Usage"><Usage user={userData} /></PanelErrorBoundary>}
      {tab === 'billing' && <PanelErrorBoundary name="Billing"><Billing /></PanelErrorBoundary>}
      {tab === 'audit' && <PanelErrorBoundary name="Audit"><AuditLog /></PanelErrorBoundary>}
      {tab === 'progress' && <PanelErrorBoundary name="Progress"><Progress /></PanelErrorBoundary>}
      {tab === 'budgets' && <PanelErrorBoundary name="Budgets"><BudgetPanel /></PanelErrorBoundary>}
      {tab === 'pipelines' && <PanelErrorBoundary name="Pipelines"><PipelinePanel /></PanelErrorBoundary>}
      {tab === 'tasks' && <PanelErrorBoundary name="Live Tasks"><LiveTasksPanel /></PanelErrorBoundary>}
    </Layout>
  );
}
