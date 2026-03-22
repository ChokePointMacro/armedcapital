'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Brain, Share2, BarChart3, Server, Target, DollarSign, Zap, Crosshair,
  Plus, ChevronDown, ChevronRight, Send,
  Activity, TrendingUp, Eye, FileText, Cpu, Gauge,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────────────────────

interface RiskProfile {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  apiCostPerRun: string;
  rateLimitImpact: string;
  dataExposure: string;
  canPublish: boolean;
  canSpend: boolean;
  failureImpact: string;
  cooldown: string;
}

interface AgentProfile {
  codename: string;
  role: string;
  strengths: string[];
  weaknesses: string[];
  tendencies: string[];
  dataFlow: string;
  costProfile: string;
}

interface AgentDef {
  id: string;
  name: string;
  description: string;
  category: string;
  status: string;
  version: string;
  profile: AgentProfile;
  risk: RiskProfile;
  capabilities: string[];
  dependencies: string[];
  missingDeps: string[];
  depsHealthy: boolean;
  depsTotal: number;
  depsConfigured: number;
  lastRun: string | null;
}

interface Task {
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

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  intelligence: <Brain size={14} />,
  social: <Share2 size={14} />,
  data: <BarChart3 size={14} />,
  infra: <Server size={14} />,
  operations: <Target size={14} />,
  finance: <DollarSign size={14} />,
  leadership: <Zap size={14} />,
  engineering: <Crosshair size={14} />,
};

const CATEGORY_COLORS: Record<string, string> = {
  intelligence: 'text-btc-orange border-btc-orange/30 bg-btc-orange/10',
  social: 'text-sky-400 border-sky-400/30 bg-sky-400/10',
  data: 'text-green-400 border-green-400/30 bg-green-400/10',
  infra: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
  operations: 'text-teal-400 border-teal-400/30 bg-teal-400/10',
  finance: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  leadership: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  engineering: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10',
};

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-red-400',
};

const RISK_BG: Record<string, string> = {
  low: 'bg-green-400/10 border-green-400/20',
  medium: 'bg-yellow-400/10 border-yellow-400/20',
  high: 'bg-orange-400/10 border-orange-400/20',
  critical: 'bg-red-400/10 border-red-400/20',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400 bg-gray-400/10',
  medium: 'text-blue-400 bg-blue-400/10',
  high: 'text-orange-400 bg-orange-400/10',
  critical: 'text-red-400 bg-red-400/10',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-blue-400 bg-blue-400/10',
  approved: 'text-green-400 bg-green-400/10',
  running: 'text-amber-400 bg-amber-400/10',
  completed: 'text-green-400 bg-green-400/10',
  ignored: 'text-gray-500 bg-gray-500/10',
  failed: 'text-red-400 bg-red-400/10',
};

// ── Risk Score Bar ───────────────────────────────────────────────────────────

function RiskBar({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }, (_, i) => {
        const active = i < score;
        let color = 'bg-gray-800';
        if (active) {
          if (i < 3) color = 'bg-green-500';
          else if (i < 5) color = 'bg-yellow-500';
          else if (i < 7) color = 'bg-orange-500';
          else color = 'bg-red-500';
        }
        return <div key={i} className={`h-2 w-3 rounded-sm ${color}`} />;
      })}
    </div>
  );
}

// ── Relative time ────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Quadrant: Availability & Cost ────────────────────────────────────────────

function AvailabilityQuadrant({ agent }: { agent: AgentDef }) {
  const risk = agent.risk;
  const statusColor = agent.depsHealthy ? 'text-green-400' : 'text-red-400';
  const statusLabel = agent.depsHealthy ? 'OPERATIONAL' : 'DEGRADED';
  const statusDot = agent.depsHealthy ? 'bg-green-400' : 'bg-red-400';

  return (
    <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Gauge size={16} className="text-gray-500" />
        <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500">Availability & Cost</h3>
      </div>

      {/* Status beacon */}
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-3 h-3 rounded-full ${statusDot} animate-pulse`} />
        <span className={`text-sm font-mono font-bold ${statusColor}`}>{statusLabel}</span>
        <span className="text-xs text-gray-600 ml-auto">v{agent.version}</span>
      </div>

      {/* Dependency health */}
      <div className="mb-4">
        <div className="text-[10px] font-mono text-gray-600 uppercase mb-2">Dependencies</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${agent.depsHealthy ? 'bg-green-500' : 'bg-orange-500'}`}
              style={{ width: `${(agent.depsConfigured / Math.max(agent.depsTotal, 1)) * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono text-gray-400">{agent.depsConfigured}/{agent.depsTotal}</span>
        </div>
        {agent.missingDeps.length > 0 && (
          <div className="mt-2 space-y-1">
            {agent.missingDeps.map(dep => (
              <div key={dep} className="text-[10px] font-mono text-red-400/80 flex items-center gap-1.5">
                <XCircle size={10} /> {dep}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cost & risk grid */}
      <div className="grid grid-cols-2 gap-3 flex-1">
        <div className="bg-gray-900/60 rounded-lg p-3">
          <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Cost / Run</div>
          <div className="text-sm font-mono text-green-400">{risk.apiCostPerRun}</div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-3">
          <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Risk Level</div>
          <div className={`text-sm font-mono ${RISK_COLORS[risk.level]}`}>{risk.level.toUpperCase()}</div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-3">
          <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Rate Impact</div>
          <div className="text-sm font-mono text-gray-300">{risk.rateLimitImpact}</div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-3">
          <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Cooldown</div>
          <div className="text-xs font-mono text-gray-300 leading-tight">{risk.cooldown}</div>
        </div>
      </div>

      {/* Risk score */}
      <div className="mt-4 pt-3 border-t border-gray-800/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono text-gray-600 uppercase">Risk Score</span>
          <span className={`text-xs font-mono font-bold ${RISK_COLORS[risk.level]}`}>{risk.score}/10</span>
        </div>
        <RiskBar score={risk.score} />
      </div>

      {/* Permission flags */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {risk.canPublish && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 border border-red-400/20">PUBLISHES</span>
        )}
        {risk.canSpend && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">SPENDS</span>
        )}
        {risk.dataExposure === 'external' && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-400/10 text-purple-400 border border-purple-400/20">EXTERNAL DATA</span>
        )}
        {!risk.canPublish && !risk.canSpend && risk.dataExposure !== 'external' && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 border border-green-400/20">READ-ONLY</span>
        )}
      </div>
    </div>
  );
}

// ── Quadrant: Task Queue ─────────────────────────────────────────────────────

function TaskQueueQuadrant({
  tasks,
  onApprove,
  onIgnore,
  onAddTask,
  loading,
}: {
  tasks: Task[];
  onApprove: (id: string) => void;
  onIgnore: (id: string) => void;
  onAddTask: (title: string, description: string, priority: Task['priority']) => void;
  loading: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium');

  const handleSubmit = () => {
    if (!newTitle.trim()) return;
    onAddTask(newTitle.trim(), newDesc.trim(), newPriority);
    setNewTitle('');
    setNewDesc('');
    setNewPriority('medium');
    setShowAdd(false);
  };

  return (
    <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={16} className="text-gray-500" />
        <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500">Task Queue</h3>
        <span className="text-[10px] font-mono text-gray-600 ml-auto">{tasks.length} pending</span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-btc-orange transition-colors"
          title="Add task"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Add task form */}
      {showAdd && (
        <div className="mb-4 p-3 bg-gray-900/80 border border-gray-700 rounded-lg space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Task title..."
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-btc-orange/50 focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
          <textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)..."
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-btc-orange/50 focus:outline-none resize-none"
          />
          <div className="flex items-center gap-2">
            <select
              value={newPriority}
              onChange={e => setNewPriority(e.target.value as Task['priority'])}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <div className="flex-1" />
            <button
              onClick={() => setShowAdd(false)}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!newTitle.trim()}
              className="flex items-center gap-1.5 text-xs bg-btc-orange/20 text-btc-orange border border-btc-orange/30 rounded px-3 py-1 hover:bg-btc-orange/30 transition-colors disabled:opacity-30"
            >
              <Send size={10} /> Add
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0" style={{ maxHeight: '320px' }}>
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-600">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-xs font-mono">No tasks in queue</div>
        )}
        {!loading && tasks.map(task => (
          <div
            key={task.id}
            className="group bg-gray-900/60 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${PRIORITY_COLORS[task.priority]}`}>
                    {task.priority.toUpperCase()}
                  </span>
                  {task.source === 'manual' && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-btc-orange/10 text-btc-orange">MANUAL</span>
                  )}
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${STATUS_COLORS[task.status]}`}>
                    {task.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-sm text-gray-200 font-medium mb-0.5">{task.title}</div>
                <div className="text-xs text-gray-500 leading-relaxed">{task.description}</div>
                {task.estimated_cost && (
                  <div className="text-[10px] font-mono text-gray-600 mt-1">Est. cost: {task.estimated_cost}</div>
                )}
              </div>
            </div>
            {task.status === 'queued' && (
              <div className="flex gap-2 mt-2.5 pt-2 border-t border-gray-800/50">
                <button
                  onClick={() => onApprove(task.id)}
                  className="flex items-center gap-1 text-[10px] font-mono text-green-400 bg-green-400/10 border border-green-400/20 rounded px-2.5 py-1 hover:bg-green-400/20 transition-colors"
                >
                  <CheckCircle2 size={10} /> Approve
                </button>
                <button
                  onClick={() => onIgnore(task.id)}
                  className="flex items-center gap-1 text-[10px] font-mono text-gray-500 bg-gray-500/10 border border-gray-500/20 rounded px-2.5 py-1 hover:bg-gray-500/20 transition-colors"
                >
                  <XCircle size={10} /> Ignore
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Quadrant: Recently Completed ─────────────────────────────────────────────

function CompletedQuadrant({ tasks }: { tasks: Task[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 size={16} className="text-gray-500" />
        <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500">Recently Completed</h3>
        <span className="text-[10px] font-mono text-gray-600 ml-auto">{tasks.length} tasks</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0" style={{ maxHeight: '320px' }}>
        {tasks.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-xs font-mono">No completed tasks yet</div>
        )}
        {tasks.map(task => {
          const expanded = expandedId === task.id;
          return (
            <div
              key={task.id}
              className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden hover:border-gray-700 transition-colors"
            >
              <button
                onClick={() => setExpandedId(expanded ? null : task.id)}
                className="w-full text-left p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${STATUS_COLORS[task.status]}`}>
                    {task.status === 'completed' ? 'DONE' : task.status.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-mono text-gray-600">{relativeTime(task.completed_at)}</span>
                  {expanded ? <ChevronDown size={12} className="text-gray-600 ml-auto" /> : <ChevronRight size={12} className="text-gray-600 ml-auto" />}
                </div>
                <div className="text-sm text-gray-300">{task.title}</div>
              </button>

              {expanded && (
                <div className="px-3 pb-3 space-y-2">
                  {task.result_summary && (
                    <div className="bg-gray-800/60 rounded-lg p-2.5">
                      <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Result Summary</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{task.result_summary}</div>
                    </div>
                  )}
                  {task.files_modified && task.files_modified.length > 0 && (
                    <div className="bg-gray-800/60 rounded-lg p-2.5">
                      <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Files Modified</div>
                      {task.files_modified.map((f, i) => (
                        <div key={i} className="text-xs font-mono text-btc-orange/80">{f}</div>
                      ))}
                    </div>
                  )}
                  {task.actual_cost && (
                    <div className="text-[10px] font-mono text-gray-600">
                      Actual cost: <span className="text-green-400">{task.actual_cost}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Quadrant: Agent Intelligence ─────────────────────────────────────────────
// Shows: data flow diagram, dependencies, capabilities, and live signals

function IntelligenceQuadrant({ agent }: { agent: AgentDef }) {
  const [showCapabilities, setShowCapabilities] = useState(true);
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={16} className="text-gray-500" />
        <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500">Agent Intelligence</h3>
      </div>

      {/* Data Flow */}
      <div className="mb-4 bg-gray-900/60 border border-gray-800 rounded-lg p-3">
        <div className="text-[10px] font-mono text-gray-600 uppercase mb-1.5">Data Flow</div>
        <div className="text-xs text-gray-300 leading-relaxed font-mono">{agent.profile.dataFlow}</div>
      </div>

      {/* Capabilities */}
      <button
        onClick={() => setShowCapabilities(!showCapabilities)}
        className="flex items-center gap-2 mb-2 text-left"
      >
        {showCapabilities ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
        <span className="text-[10px] font-mono text-gray-600 uppercase">Capabilities ({agent.capabilities.length})</span>
      </button>
      {showCapabilities && (
        <div className="mb-4 space-y-1">
          {agent.capabilities.map((cap, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
              <div className="w-1 h-1 rounded-full bg-btc-orange/60 mt-1.5 flex-shrink-0" />
              {cap}
            </div>
          ))}
        </div>
      )}

      {/* Profile intel toggle */}
      <button
        onClick={() => setShowProfile(!showProfile)}
        className="flex items-center gap-2 mb-2 text-left"
      >
        {showProfile ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
        <span className="text-[10px] font-mono text-gray-600 uppercase">Behavioral Profile</span>
      </button>
      {showProfile && (
        <div className="space-y-3">
          {/* Strengths */}
          <div>
            <div className="text-[10px] font-mono text-green-500/80 uppercase mb-1">Strengths</div>
            {agent.profile.strengths.map((s, i) => (
              <div key={i} className="text-xs text-gray-400 leading-relaxed flex items-start gap-1.5 mb-0.5">
                <TrendingUp size={10} className="text-green-500/50 mt-0.5 flex-shrink-0" /> {s}
              </div>
            ))}
          </div>
          {/* Weaknesses */}
          <div>
            <div className="text-[10px] font-mono text-red-400/80 uppercase mb-1">Weaknesses</div>
            {agent.profile.weaknesses.map((w, i) => (
              <div key={i} className="text-xs text-gray-400 leading-relaxed flex items-start gap-1.5 mb-0.5">
                <AlertTriangle size={10} className="text-red-400/50 mt-0.5 flex-shrink-0" /> {w}
              </div>
            ))}
          </div>
          {/* Tendencies */}
          <div>
            <div className="text-[10px] font-mono text-blue-400/80 uppercase mb-1">Tendencies</div>
            {agent.profile.tendencies.map((t, i) => (
              <div key={i} className="text-xs text-gray-400 leading-relaxed flex items-start gap-1.5 mb-0.5">
                <Eye size={10} className="text-blue-400/50 mt-0.5 flex-shrink-0" /> {t}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failure impact */}
      <div className="mt-auto pt-3 border-t border-gray-800/50">
        <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Failure Impact</div>
        <div className="text-xs text-red-400/70 leading-relaxed">{agent.risk.failureImpact}</div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AgentDetail({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<AgentDef | null>(null);
  const [queuedTasks, setQueuedTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch agent data
  const fetchAgent = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      const found = data.agents?.find((a: AgentDef) => a.id === agentId);
      if (found) {
        setAgent(found);
        setError(null);
      } else {
        setError(`Agent "${agentId}" not found`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      setTasksLoading(true);
      const res = await apiFetch(`/api/admin/agents/${agentId}/tasks`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      setQueuedTasks(data.queued || []);
      setCompletedTasks(data.completed || []);
    } catch {
      // Silently fail — tasks will just be empty
    } finally {
      setTasksLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAgent();
    fetchTasks();
  }, [fetchAgent, fetchTasks]);

  // Task actions
  const handleApprove = async (taskId: string) => {
    try {
      await apiFetch(`/api/admin/agents/${agentId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve', taskId }),
      });
      // Optimistic update
      setQueuedTasks(prev =>
        prev.map(t => t.id === taskId ? { ...t, status: 'approved' as const } : t)
      );
    } catch { /* ignore */ }
  };

  const handleIgnore = async (taskId: string) => {
    try {
      await apiFetch(`/api/admin/agents/${agentId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ action: 'ignore', taskId }),
      });
      // Move from queue to completed
      const ignored = queuedTasks.find(t => t.id === taskId);
      if (ignored) {
        setQueuedTasks(prev => prev.filter(t => t.id !== taskId));
        setCompletedTasks(prev => [{ ...ignored, status: 'ignored' as const }, ...prev]);
      }
    } catch { /* ignore */ }
  };

  const handleAddTask = async (title: string, description: string, priority: Task['priority']) => {
    try {
      const res = await apiFetch(`/api/admin/agents/${agentId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ action: 'add', title, description, priority }),
      });
      const data = await res.json();
      if (data.task) {
        setQueuedTasks(prev => [data.task, ...prev]);
      } else {
        // Optimistic — add locally with temp ID
        setQueuedTasks(prev => [{
          id: `temp-${Date.now()}`,
          agent_id: agentId,
          title,
          description,
          status: 'queued',
          priority,
          source: 'manual',
          result_summary: null,
          files_modified: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
          estimated_cost: null,
          actual_cost: null,
        }, ...prev]);
      }
    } catch { /* ignore */ }
  };

  // ── Loading / Error states ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-btc-orange" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <AlertTriangle size={32} className="text-red-400" />
        <div className="text-sm text-gray-400">{error || 'Agent not found'}</div>
        <Link
          href="/agents"
          className="text-xs text-btc-orange hover:underline flex items-center gap-1"
        >
          <ArrowLeft size={12} /> Back to Agents
        </Link>
      </div>
    );
  }

  const catColor = CATEGORY_COLORS[agent.category] || 'text-gray-400 border-gray-400/30 bg-gray-400/10';
  const catIcon = CATEGORY_ICONS[agent.category] || <Cpu size={14} />;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/agents"
          className="text-xs text-gray-500 hover:text-btc-orange flex items-center gap-1 mb-3 transition-colors"
        >
          <ArrowLeft size={12} /> All Agents
        </Link>

        <div className="flex items-start gap-4">
          {/* Codename badge */}
          <div className={`flex items-center justify-center w-14 h-14 rounded-xl border ${catColor}`}>
            <span className="text-lg font-bold font-mono">{agent.profile.codename[0]}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-gray-100">{agent.name}</h1>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${catColor} flex items-center gap-1`}>
                {catIcon} {agent.category.toUpperCase()}
              </span>
            </div>
            <div className="text-xs font-mono text-gray-500 mb-1">
              {agent.profile.codename} — {agent.profile.role}
            </div>
            <div className="text-sm text-gray-400 leading-relaxed">{agent.description}</div>
          </div>

          <button
            onClick={() => { fetchAgent(); fetchTasks(); }}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-btc-orange transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* 4 Quadrant Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Q1: Availability & Cost */}
        <AvailabilityQuadrant agent={agent} />

        {/* Q2: Task Queue */}
        <TaskQueueQuadrant
          tasks={queuedTasks}
          onApprove={handleApprove}
          onIgnore={handleIgnore}
          onAddTask={handleAddTask}
          loading={tasksLoading}
        />

        {/* Q3: Recently Completed */}
        <CompletedQuadrant tasks={completedTasks} />

        {/* Q4: Agent Intelligence */}
        <IntelligenceQuadrant agent={agent} />
      </div>
    </div>
  );
}
