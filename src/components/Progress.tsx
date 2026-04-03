'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Loader2, Shield, Server, Database,
  Zap, CheckCircle2, AlertTriangle, Circle, Archive,
  ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, X, Play,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number | null;
  message?: string;
}

interface ReadinessItem {
  id: string;
  category: 'security' | 'infrastructure' | 'data' | 'features' | 'performance';
  title: string;
  description: string;
  status: 'done' | 'in_progress' | 'todo' | 'critical';
  priority: 'critical' | 'high' | 'medium' | 'low';
}

interface HealthData {
  status: string;
  uptime: number;
  timestamp: string;
  responseMs: number;
  checks: HealthCheck[];
  readiness: {
    score: number;
    completed: number;
    total: number;
    criticalRemaining: number;
    checklist: ReadinessItem[];
  };
}

type Decision = 'approved' | 'denied';

interface ExecResult {
  success: boolean;
  message: string;
  details?: string;
  requiresDeploy?: boolean;
  executedAt?: string;
}

interface DecisionEntry {
  decision: Decision;
  decidedAt: string;
  execResult?: ExecResult;
  executing?: boolean;
}

type DecisionMap = Record<string, DecisionEntry>;

interface ArchivedItem {
  id: string;
  title: string;
  category: string;
  priority: string;
  description: string;
  summary: string;
  archivedAt: string;
  execResult?: ExecResult;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DECISIONS_KEY = 'armedcapital_progress_decisions';
const ARCHIVE_KEY = 'armedcapital_progress_archive';

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  security: { label: 'Security', icon: <Shield size={14} />, color: 'text-red-400' },
  infrastructure: { label: 'Infrastructure', icon: <Server size={14} />, color: 'text-blue-400' },
  data: { label: 'Data & Caching', icon: <Database size={14} />, color: 'text-purple-400' },
  features: { label: 'Features', icon: <Zap size={14} />, color: 'text-btc-orange' },
  performance: { label: 'Performance', icon: <Activity size={14} />, color: 'text-green-400' },
};

const STATUS_STYLES: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
  done: { icon: <CheckCircle2 size={14} />, bg: 'bg-green-500/10', text: 'text-green-400' },
  in_progress: { icon: <Loader2 size={14} className="animate-spin" />, bg: 'bg-btc-orange/10', text: 'text-btc-orange' },
  todo: { icon: <Circle size={14} />, bg: 'bg-gray-700/30', text: 'text-gray-500' },
  critical: { icon: <AlertTriangle size={14} />, bg: 'bg-red-500/10', text: 'text-red-400' },
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-300 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const HEALTH_STATUS: Record<string, { color: string; label: string }> = {
  healthy: { color: 'text-green-400', label: 'Healthy' },
  degraded: { color: 'text-yellow-400', label: 'Degraded' },
  down: { color: 'text-red-400', label: 'Down' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadDecisions(): DecisionMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DECISIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveDecisions(map: DecisionMap) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(DECISIONS_KEY, JSON.stringify(map)); } catch {}
}

function loadArchive(): ArchivedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveArchive(items: ArchivedItem[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(items)); } catch {}
}

function buildSummary(item: ReadinessItem, execResult?: ExecResult): string {
  if (execResult?.message) return execResult.message;
  if (item.status === 'done') return `${item.title} — completed`;
  return item.description;
}

// ── Component ────────────────────────────────────────────────────────────────

export function Progress() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(['security', 'infrastructure', 'data', 'features', 'performance']));
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied' | 'done'>('all');
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [archive, setArchive] = useState<ArchivedItem[]>([]);
  const [showArchive, setShowArchive] = useState(false);

  // Load persisted decisions + archive
  useEffect(() => { setDecisions(loadDecisions()); setArchive(loadArchive()); }, []);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // Auto-archive: move items with status=done (from health API) to archive on data refresh
  useEffect(() => {
    if (!data) return;
    const checklist = data.readiness.checklist;

    setArchive(prevArchive => {
      const currentArchiveIds = new Set(prevArchive.map(a => a.id));
      const toArchive: ArchivedItem[] = [];

      for (const item of checklist) {
        if (currentArchiveIds.has(item.id)) continue;
        // Only auto-archive items the health API marks as done
        if (item.status === 'done') {
          toArchive.push({
            id: item.id,
            title: item.title,
            category: item.category,
            priority: item.priority,
            description: item.description,
            summary: `${item.title} — completed`,
            archivedAt: new Date().toISOString(),
          });
        }
      }

      if (toArchive.length === 0) return prevArchive;

      const updated = [...prevArchive, ...toArchive];
      saveArchive(updated);

      // Clean up decisions for newly archived items
      setDecisions(prev => {
        const next = { ...prev };
        let changed = false;
        toArchive.forEach(a => { if (next[a.id]) { delete next[a.id]; changed = true; } });
        if (changed) saveDecisions(next);
        return changed ? next : prev;
      });

      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Execute a task via the API
  const executeTask = async (id: string): Promise<ExecResult | null> => {
    try {
      const res = await apiFetch('/api/admin/progress/execute', {
        method: 'POST',
        body: JSON.stringify({ taskId: id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { success: false, message: err.error || 'Execution failed' };
      }
      return await res.json();
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  };

  // Helper: update a single decision entry using functional state update (avoids stale closures)
  const updateDecision = (id: string, entry: DecisionEntry) => {
    setDecisions(prev => {
      const next = { ...prev, [id]: entry };
      saveDecisions(next);
      return next;
    });
  };

  const decide = async (id: string, decision: Decision) => {
    const now = new Date().toISOString();

    if (decision === 'approved') {
      // Mark as executing immediately
      updateDecision(id, { decision, decidedAt: now, executing: true });
      setExpandedItem(id);

      // Execute the task
      const result = await executeTask(id);
      const execResult = result || { success: false, message: 'No response' };

      // Update with result (functional update so concurrent approvals don't clobber each other)
      updateDecision(id, { decision, decidedAt: now, executing: false, execResult });

      // Auto-archive if successful and no deploy needed
      if (execResult.success && !execResult.requiresDeploy && data) {
        const item = data.readiness.checklist.find(i => i.id === id);
        if (item) {
          setArchive(prev => {
            if (prev.some(a => a.id === id)) return prev;
            const updated = [...prev, {
              id: item.id,
              title: item.title,
              category: item.category,
              priority: item.priority,
              description: item.description,
              summary: execResult.message || item.description,
              archivedAt: new Date().toISOString(),
              execResult,
            }];
            saveArchive(updated);
            return updated;
          });
          // Remove from decisions after short delay so user sees the result briefly
          setTimeout(() => {
            setDecisions(prev => {
              const next = { ...prev };
              delete next[id];
              saveDecisions(next);
              return next;
            });
          }, 3000);
        }
      }
    } else {
      updateDecision(id, { decision, decidedAt: now });
    }
  };

  const undecide = (id: string) => {
    setDecisions(prev => {
      const next = { ...prev };
      delete next[id];
      saveDecisions(next);
      return next;
    });
  };

  const batchDecide = async (decision: Decision) => {
    const ids = Array.from(batchSelected);
    setBatchSelected(new Set());
    setBatchMode(false);

    if (decision === 'denied') {
      setDecisions(prev => {
        const next = { ...prev };
        ids.forEach(id => {
          next[id] = { decision, decidedAt: new Date().toISOString() };
        });
        saveDecisions(next);
        return next;
      });
      return;
    }

    // Approve + execute each task (concurrent — all fire at once)
    await Promise.all(ids.map(id => decide(id, 'approved')));
  };

  const toggleBatchItem = (id: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const approveAllCritical = async () => {
    if (!data) return;
    const criticalItems = data.readiness.checklist
      .filter(i => i.priority === 'critical' && i.status !== 'done');

    for (const item of criticalItems) {
      await decide(item.id, 'approved');
    }
  };

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading health data…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-20">
        <AlertTriangle size={24} className="text-red-400 mx-auto mb-2" />
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={fetchHealth} className="mt-3 text-xs text-gray-400 hover:text-btc-orange">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const { readiness, checks } = data;
  const archivedIds = new Set(archive.map(a => a.id));
  const checklist = readiness.checklist.filter(i => !archivedIds.has(i.id));

  // Counts
  const approvedCount = checklist.filter(i => decisions[i.id]?.decision === 'approved').length;
  const deniedCount = checklist.filter(i => decisions[i.id]?.decision === 'denied').length;
  const pendingCount = checklist.filter(i => i.status !== 'done' && !decisions[i.id]).length;

  // Group by category
  const grouped = checklist.reduce<Record<string, ReadinessItem[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  const filtered = (items: ReadinessItem[]) => {
    if (filter === 'pending') return items.filter(i => i.status !== 'done' && !decisions[i.id]);
    if (filter === 'approved') return items.filter(i => decisions[i.id]?.decision === 'approved');
    if (filter === 'denied') return items.filter(i => decisions[i.id]?.decision === 'denied');
    if (filter === 'done') return items.filter(i => i.status === 'done');
    return items;
  };

  const scoreColor = readiness.score >= 70 ? 'text-green-400' : readiness.score >= 40 ? 'text-yellow-400' : 'text-red-400';
  const ringPct = readiness.score;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono text-gray-300 uppercase tracking-widest">Production Readiness</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={approveAllCritical}
            className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <ThumbsUp size={10} /> Approve All Critical
          </button>
          <button
            onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}
            className={`flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded border transition-colors ${
              batchMode ? 'border-btc-orange text-btc-orange bg-btc-orange/5' : 'border-gray-700 text-gray-500 hover:text-gray-300'
            }`}
          >
            {batchMode ? <X size={10} /> : <CheckCircle2 size={10} />}
            {batchMode ? 'Cancel' : 'Batch'}
          </button>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-btc-orange transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Batch action bar */}
      {batchMode && batchSelected.size > 0 && (
        <div className="flex items-center gap-3 bg-gray-900/80 border border-gray-700 rounded-lg px-4 py-3">
          <span className="text-xs text-gray-300">{batchSelected.size} selected</span>
          <button
            onClick={() => batchDecide('approved')}
            className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20 transition-colors"
          >
            <ThumbsUp size={10} /> Approve Selected
          </button>
          <button
            onClick={() => batchDecide('denied')}
            className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
          >
            <ThumbsDown size={10} /> Deny Selected
          </button>
        </div>
      )}

      {/* Score + System Health */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Score ring */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-5 flex items-center gap-5">
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f2937" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15.9" fill="none"
                stroke={readiness.score >= 70 ? '#22c55e' : readiness.score >= 40 ? '#eab308' : '#ef4444'}
                strokeWidth="2.5"
                strokeDasharray={`${ringPct} ${100 - ringPct}`}
                strokeLinecap="round"
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${scoreColor}`}>
              {readiness.score}%
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-mono uppercase">Readiness Score</p>
            <p className="text-2xl font-bold text-white">{readiness.completed}<span className="text-gray-500 text-sm">/{readiness.total}</span></p>
            <p className="text-[10px] text-gray-500 mt-1">
              {readiness.criticalRemaining > 0
                ? <span className="text-red-400">{readiness.criticalRemaining} critical remaining</span>
                : <span className="text-green-400">All critical resolved</span>
              }
            </p>
          </div>
        </div>

        {/* System health */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
          <p className="text-xs text-gray-500 font-mono uppercase mb-3">System Health</p>
          <div className="space-y-2">
            {checks.map(check => {
              const s = HEALTH_STATUS[check.status] || HEALTH_STATUS.down;
              return (
                <div key={check.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${check.status === 'healthy' ? 'bg-green-400' : check.status === 'degraded' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                    <span className="text-xs text-gray-300">{check.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {check.latencyMs !== null && <span className="text-[10px] text-gray-600">{check.latencyMs}ms</span>}
                    <span className={`text-[10px] font-mono ${s.color}`}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Decision stats */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
          <p className="text-xs text-gray-500 font-mono uppercase mb-3">Decisions</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <p className="text-lg font-bold text-yellow-400">{pendingCount}</p>
              <p className="text-[10px] font-mono text-gray-500">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-400">{approvedCount}</p>
              <p className="text-[10px] font-mono text-gray-500">Approved</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-red-400">{deniedCount}</p>
              <p className="text-[10px] font-mono text-gray-500">Denied</p>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-gray-800">
            <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-gray-800">
              {readiness.completed > 0 && (
                <div className="bg-blue-500 transition-all" style={{ width: `${(readiness.completed / readiness.total) * 100}%` }} title="Already done" />
              )}
              {approvedCount > 0 && (
                <div className="bg-green-500 transition-all" style={{ width: `${(approvedCount / readiness.total) * 100}%` }} title="Approved" />
              )}
              {deniedCount > 0 && (
                <div className="bg-red-500/50 transition-all" style={{ width: `${(deniedCount / readiness.total) * 100}%` }} title="Denied" />
              )}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-blue-400">Done</span>
              <span className="text-[9px] text-green-400">Approved</span>
              <span className="text-[9px] text-red-400">Denied</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {([
          { key: 'all' as const, label: `All (${checklist.length})` },
          { key: 'pending' as const, label: `Pending (${pendingCount})` },
          { key: 'approved' as const, label: `Approved (${approvedCount})` },
          { key: 'denied' as const, label: `Denied (${deniedCount})` },
          { key: 'done' as const, label: `Done (${readiness.completed})` },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded border transition-colors ${
              filter === f.key
                ? 'border-btc-orange text-btc-orange bg-btc-orange/5'
                : 'border-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Checklist */}
      <div className="space-y-3">
        {Object.entries(CATEGORY_META).map(([cat, meta]) => {
          const items = filtered(grouped[cat] || []);
          if (items.length === 0 && filter !== 'all') return null;
          const allItems = grouped[cat] || [];
          const doneCount = allItems.filter(i => i.status === 'done').length;
          const approvedInCat = allItems.filter(i => decisions[i.id]?.decision === 'approved').length;
          const isExpanded = expandedCats.has(cat);

          return (
            <div key={cat} className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                  <span className={meta.color}>{meta.icon}</span>
                  <span className="text-xs font-mono text-gray-300 uppercase">{meta.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-500">{doneCount + approvedInCat}/{allItems.length}</span>
                  <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${allItems.length > 0 ? (doneCount / allItems.length) * 100 : 0}%` }}
                    />
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${allItems.length > 0 ? (approvedInCat / allItems.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-800">
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-600 px-4 py-3">No items match filter</p>
                  ) : (
                    items.map(item => {
                      const d = decisions[item.id];
                      const isDone = item.status === 'done';
                      const isApproved = d?.decision === 'approved';
                      const isDenied = d?.decision === 'denied';
                      const isExecuting = d?.executing === true;
                      const hasResult = !!d?.execResult;
                      const isOpen = expandedItem === item.id;

                      let rowBg = 'bg-gray-700/20';
                      if (isDone) rowBg = 'bg-green-500/5';
                      else if (isExecuting) rowBg = 'bg-btc-orange/10';
                      else if (isApproved && hasResult) rowBg = d.execResult?.success ? 'bg-green-500/10' : 'bg-red-500/10';
                      else if (isApproved) rowBg = 'bg-green-500/10';
                      else if (isDenied) rowBg = 'bg-red-500/5';
                      else if (item.priority === 'critical') rowBg = 'bg-red-500/5';

                      const st = isDone
                        ? STATUS_STYLES.done
                        : isExecuting
                          ? { icon: <Loader2 size={14} className="animate-spin" />, bg: '', text: 'text-btc-orange' }
                          : isApproved
                            ? { icon: <CheckCircle2 size={14} />, bg: '', text: 'text-green-400' }
                            : isDenied
                              ? { icon: <ThumbsDown size={14} />, bg: '', text: 'text-red-400' }
                              : STATUS_STYLES[item.status] || STATUS_STYLES.todo;

                      return (
                        <div key={item.id} className={`border-b border-gray-800/50 last:border-0 ${rowBg}`}>
                          {/* Main row */}
                          <div
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                            onClick={() => {
                              if (batchMode && !isDone) {
                                toggleBatchItem(item.id);
                              } else {
                                setExpandedItem(isOpen ? null : item.id);
                              }
                            }}
                          >
                            {/* Batch checkbox */}
                            {batchMode && !isDone && (
                              <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                                batchSelected.has(item.id)
                                  ? 'border-btc-orange bg-btc-orange/20 text-btc-orange'
                                  : 'border-gray-600'
                              }`}>
                                {batchSelected.has(item.id) && <CheckCircle2 size={10} />}
                              </span>
                            )}

                            {/* Status icon */}
                            <span className={`flex-shrink-0 ${st.text}`}>{st.icon}</span>

                            {/* Title + badges */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs ${isDone || isDenied ? 'text-gray-500 line-through' : isApproved ? 'text-green-300' : 'text-gray-200'}`}>
                                  {item.title}
                                </span>
                                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[item.priority]}`}>
                                  {item.priority}
                                </span>
                                {isExecuting && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-btc-orange/20 text-btc-orange border border-btc-orange/30 animate-pulse">
                                    EXECUTING…
                                  </span>
                                )}
                                {isApproved && !isExecuting && hasResult && (
                                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                    d.execResult?.success
                                      ? 'bg-green-500/20 text-green-300 border-green-500/30'
                                      : 'bg-red-500/20 text-red-300 border-red-500/30'
                                  }`}>
                                    {d.execResult?.success ? 'EXECUTED' : 'FAILED'}
                                  </span>
                                )}
                                {isApproved && !isExecuting && !hasResult && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                                    APPROVED
                                  </span>
                                )}
                                {isDenied && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                                    DENIED
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Quick action buttons (non-done items) */}
                            {!isDone && !batchMode && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {!isApproved && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); decide(item.id, 'approved'); }}
                                    className="p-1.5 rounded hover:bg-green-500/20 text-gray-500 hover:text-green-400 transition-colors"
                                    title="Approve"
                                  >
                                    <ThumbsUp size={13} />
                                  </button>
                                )}
                                {!isDenied && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); decide(item.id, 'denied'); }}
                                    className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                                    title="Deny"
                                  >
                                    <ThumbsDown size={13} />
                                  </button>
                                )}
                                {(isApproved || isDenied) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); undecide(item.id); }}
                                    className="p-1.5 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-400 transition-colors"
                                    title="Undo"
                                  >
                                    <X size={13} />
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Expand arrow */}
                            {!batchMode && (
                              <span className="text-gray-600 flex-shrink-0">
                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </span>
                            )}
                          </div>

                          {/* Expanded detail */}
                          {isOpen && !batchMode && (
                            <div className="px-4 pb-4 pt-1 ml-8 border-l-2 border-gray-800 space-y-3">
                              <p className="text-xs text-gray-400">{item.description}</p>

                              {/* Execution result */}
                              {hasResult && d.execResult && (
                                <div className={`rounded-lg border p-3 ${
                                  d.execResult.success
                                    ? 'bg-green-500/5 border-green-500/20'
                                    : 'bg-red-500/5 border-red-500/20'
                                }`}>
                                  <div className="flex items-center gap-2 mb-1">
                                    {d.execResult.success
                                      ? <CheckCircle2 size={12} className="text-green-400" />
                                      : <AlertTriangle size={12} className="text-red-400" />
                                    }
                                    <span className={`text-xs font-mono ${d.execResult.success ? 'text-green-300' : 'text-red-300'}`}>
                                      {d.execResult.message}
                                    </span>
                                    {d.execResult.requiresDeploy && (
                                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                                        NEEDS DEPLOY
                                      </span>
                                    )}
                                  </div>
                                  {d.execResult.details && (
                                    <pre className="text-[10px] text-gray-400 mt-2 whitespace-pre-wrap font-mono bg-black/20 rounded p-2 max-h-40 overflow-y-auto">
                                      {d.execResult.details}
                                    </pre>
                                  )}
                                  {d.execResult.executedAt && (
                                    <p className="text-[9px] text-gray-600 mt-1">
                                      Executed: {new Date(d.execResult.executedAt).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Executing spinner */}
                              {isExecuting && (
                                <div className="flex items-center gap-2 py-2">
                                  <Loader2 size={14} className="animate-spin text-btc-orange" />
                                  <span className="text-xs text-btc-orange">Executing task…</span>
                                </div>
                              )}

                              <div className="flex items-center gap-2 text-[10px] text-gray-600">
                                <span>Category: <span className={CATEGORY_META[item.category]?.color}>{item.category}</span></span>
                                <span>·</span>
                                <span>Priority: <span className={PRIORITY_BADGE[item.priority].split(' ')[1]}>{item.priority}</span></span>
                                {d && (
                                  <>
                                    <span>·</span>
                                    <span>Decided: {new Date(d.decidedAt).toLocaleDateString()}</span>
                                  </>
                                )}
                              </div>

                              {/* Action buttons */}
                              {!isDone && !isExecuting && (
                                <div className="flex gap-2 pt-1">
                                  {!isApproved && (
                                    <button
                                      onClick={() => decide(item.id, 'approved')}
                                      className="flex items-center gap-1.5 text-[10px] font-mono px-4 py-2 rounded bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20 transition-colors"
                                    >
                                      <Play size={11} /> Approve &amp; Execute
                                    </button>
                                  )}
                                  {isApproved && hasResult && (
                                    <button
                                      onClick={() => decide(item.id, 'approved')}
                                      className="flex items-center gap-1.5 text-[10px] font-mono px-4 py-2 rounded bg-btc-orange/10 border border-btc-orange/30 text-btc-orange hover:bg-btc-orange/20 transition-colors"
                                    >
                                      <RefreshCw size={11} /> Re-Execute
                                    </button>
                                  )}
                                  {!isDenied && !isApproved && (
                                    <button
                                      onClick={() => decide(item.id, 'denied')}
                                      className="flex items-center gap-1.5 text-[10px] font-mono px-4 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
                                    >
                                      <ThumbsDown size={11} /> Deny — Not Now
                                    </button>
                                  )}
                                  {(isApproved || isDenied) && (
                                    <button
                                      onClick={() => undecide(item.id)}
                                      className="flex items-center gap-1.5 text-[10px] font-mono px-4 py-2 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-300 transition-colors"
                                    >
                                      <X size={11} /> Reset
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Approved queue summary */}
      {approvedCount > 0 && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Play size={14} className="text-green-400" />
              <span className="text-xs font-mono text-green-300 uppercase">Approved Roadmap ({approvedCount} items)</span>
            </div>
          </div>
          <div className="space-y-1">
            {checklist
              .filter(i => decisions[i.id]?.decision === 'approved')
              .sort((a, b) => {
                const pOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                return (pOrder[a.priority] ?? 4) - (pOrder[b.priority] ?? 4);
              })
              .map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600 font-mono w-5 text-right">{idx + 1}.</span>
                  <span className={`text-[9px] font-mono px-1 rounded ${PRIORITY_BADGE[item.priority]}`}>{item.priority[0].toUpperCase()}</span>
                  <span className="text-gray-300">{item.title}</span>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* Archive */}
      {archive.length > 0 && (
        <div className="bg-gray-900/30 border border-gray-800/60 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowArchive(!showArchive)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              {showArchive ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
              <Archive size={14} className="text-gray-500" />
              <span className="text-xs font-mono text-gray-400 uppercase">Archive</span>
              <span className="text-[10px] font-mono text-gray-600 ml-1">({archive.length} completed)</span>
            </div>
          </button>

          {showArchive && (
            <div className="border-t border-gray-800/60">
              {archive
                .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime())
                .map(item => {
                  const catMeta = CATEGORY_META[item.category];
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-800/30 last:border-0">
                      <CheckCircle2 size={14} className="text-green-500/60 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-400">{item.title}</span>
                          {catMeta && <span className={`text-[9px] font-mono ${catMeta.color}`}>{item.category}</span>}
                        </div>
                        <p className="text-[10px] text-gray-600 mt-0.5">{item.summary}</p>
                        <p className="text-[9px] text-gray-700 mt-0.5">{new Date(item.archivedAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-[10px] text-gray-600 border-t border-gray-800 pt-4">
        Last checked {new Date(data.timestamp).toLocaleTimeString()} · {data.responseMs}ms · {archive.length} archived
      </div>
    </div>
  );
}
