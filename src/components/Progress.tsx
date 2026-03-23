'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Loader2, Shield, Server, Database,
  Zap, CheckCircle2, AlertTriangle, Clock, Circle,
  ChevronDown, ChevronRight, ExternalLink,
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

// ── Constants ────────────────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

export function Progress() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(['security', 'infrastructure']));
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all');

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

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

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
        <button onClick={fetchHealth} className="mt-3 text-xs text-gray-400 hover:text-btc-orange">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { readiness, checks } = data;
  const checklist = readiness.checklist;

  // Group by category
  const grouped = checklist.reduce<Record<string, ReadinessItem[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  const filtered = (items: ReadinessItem[]) => {
    if (filter === 'todo') return items.filter(i => i.status !== 'done');
    if (filter === 'done') return items.filter(i => i.status === 'done');
    return items;
  };

  const scoreColor = readiness.score >= 70 ? 'text-green-400' : readiness.score >= 40 ? 'text-yellow-400' : 'text-red-400';
  const ringPct = readiness.score;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono text-gray-300 uppercase tracking-widest">Production Readiness</h2>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-btc-orange transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {/* ── Score + System Health Cards ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Readiness Score */}
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
                ? <span className="text-red-400">{readiness.criticalRemaining} critical items remaining</span>
                : <span className="text-green-400">All critical items resolved</span>
              }
            </p>
          </div>
        </div>

        {/* System Status */}
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
                    {check.latencyMs !== null && (
                      <span className="text-[10px] text-gray-600">{check.latencyMs}ms</span>
                    )}
                    <span className={`text-[10px] font-mono ${s.color}`}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-2 border-t border-gray-800 flex items-center justify-between">
            <span className="text-[10px] text-gray-600">Response</span>
            <span className="text-[10px] text-gray-500">{data.responseMs}ms</span>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
          <p className="text-xs text-gray-500 font-mono uppercase mb-3">Task Breakdown</p>
          <div className="grid grid-cols-2 gap-3">
            {(['critical', 'high', 'medium', 'low'] as const).map(p => {
              const all = checklist.filter(i => i.priority === p);
              const done = all.filter(i => i.status === 'done');
              return (
                <div key={p} className="text-center">
                  <p className="text-lg font-bold text-white">{done.length}<span className="text-gray-500 text-xs">/{all.length}</span></p>
                  <p className={`text-[10px] font-mono uppercase ${PRIORITY_BADGE[p].split(' ')[1]}`}>{p}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Filter Tabs ─────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {(['all', 'todo', 'done'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? 'border-btc-orange text-btc-orange bg-btc-orange/5'
                : 'border-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {f === 'all' ? `All (${checklist.length})` : f === 'todo' ? `Todo (${checklist.filter(i => i.status !== 'done').length})` : `Done (${checklist.filter(i => i.status === 'done').length})`}
          </button>
        ))}
      </div>

      {/* ── Checklist by Category ───────────────────────────────────── */}
      <div className="space-y-3">
        {Object.entries(CATEGORY_META).map(([cat, meta]) => {
          const items = filtered(grouped[cat] || []);
          if (items.length === 0 && filter !== 'all') return null;
          const allItems = grouped[cat] || [];
          const doneCount = allItems.filter(i => i.status === 'done').length;
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
                  <span className="text-[10px] text-gray-500">{doneCount}/{allItems.length}</span>
                  <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${allItems.length > 0 ? (doneCount / allItems.length) * 100 : 0}%`,
                        backgroundColor: doneCount === allItems.length ? '#22c55e' : '#f7931a',
                      }}
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
                      const st = STATUS_STYLES[item.status] || STATUS_STYLES.todo;
                      return (
                        <div
                          key={item.id}
                          className={`flex items-start gap-3 px-4 py-3 border-b border-gray-800/50 last:border-0 ${st.bg}`}
                        >
                          <span className={`mt-0.5 ${st.text}`}>{st.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs ${item.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                                {item.title}
                              </span>
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[item.priority]}`}>
                                {item.priority}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-0.5">{item.description}</p>
                          </div>
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

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="text-center text-[10px] text-gray-600 border-t border-gray-800 pt-4">
        Last checked {new Date(data.timestamp).toLocaleTimeString()} · Response {data.responseMs}ms
      </div>
    </div>
  );
}
