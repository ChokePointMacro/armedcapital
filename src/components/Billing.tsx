'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, TrendingUp, Zap, AlertTriangle, RefreshCw, Loader2,
  BarChart3, Clock, Cpu, Pause, Play, ChevronDown, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface BillingData {
  period: { days: number; since: string };
  totals: {
    spendUsd: number;
    tasks: number;
    tokens: number;
    errors: number;
    avgDailySpend: number;
    projectedMonthly: number;
  };
  byAgent: Record<string, { totalUsd: number; taskCount: number; avgLatency: number; totalTokens: number }>;
  byModel: Record<string, { totalUsd: number; taskCount: number; totalTokens: number }>;
  daily: Array<{ date: string; totalUsd: number; taskCount: number; byAgent: Record<string, number> }>;
  budgets: Record<string, {
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    dailySpentUsd: number;
    monthlySpentUsd: number;
    paused: boolean;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(val: number): string {
  if (val >= 1) return `$${val.toFixed(2)}`;
  if (val >= 0.01) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(4)}`;
}

function SpendBar({ spent, limit, label }: { spent: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-gray-500">{label}</span>
        <span className="text-[10px] font-mono text-gray-400">
          {formatUsd(spent)} / {formatUsd(limit)} ({Math.round(pct)}%)
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Mini Sparkline (last 7 days) ─────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 0.001);
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - (v / max) * h}`).join(' ');

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke="#f7931a"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Billing() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const fetchBilling = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/admin/billing?period=${period}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    fetchBilling();
    const interval = setInterval(fetchBilling, 30000);
    return () => clearInterval(interval);
  }, [fetchBilling]);

  const togglePause = async (agentId: string, currentlyPaused: boolean) => {
    try {
      await apiFetch('/api/admin/budget', {
        method: 'POST',
        body: JSON.stringify({ agentId, paused: !currentlyPaused }),
      });
      fetchBilling();
    } catch { /* ignore */ }
  };

  const agentEntries = data ? Object.entries(data.byAgent).sort(([, a], [, b]) => b.totalUsd - a.totalUsd) : [];
  const modelEntries = data ? Object.entries(data.byModel).sort(([, a], [, b]) => b.totalUsd - a.totalUsd) : [];

  // Last 7 days for sparkline
  const last7Days = data?.daily
    .slice(0, 7)
    .reverse()
    .map(d => d.totalUsd) || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <DollarSign size={20} className="text-btc-orange" />
            Billing & Spend
          </h1>
          <p className="text-xs text-gray-500 mt-1">Real-time API cost tracking across all agents — admin only</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex gap-1">
            {['7d', '14d', '30d', '90d'].map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${
                  period === p
                    ? 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
                    : 'border-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setLoading(true); fetchBilling(); }}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-btc-orange transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-btc-orange" />
        </div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
              <div className="flex items-center justify-between mb-2">
                <DollarSign size={16} className="text-green-400" />
                <Sparkline data={last7Days} />
              </div>
              <div className="text-2xl font-mono font-bold text-gray-100">{formatUsd(data.totals.spendUsd)}</div>
              <div className="text-[10px] font-mono text-gray-500 uppercase">Total Spend ({period})</div>
            </div>
            <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
              <div className="flex items-center mb-2">
                <TrendingUp size={16} className="text-btc-orange" />
              </div>
              <div className="text-2xl font-mono font-bold text-gray-100">{formatUsd(data.totals.projectedMonthly)}</div>
              <div className="text-[10px] font-mono text-gray-500 uppercase">Projected Monthly</div>
            </div>
            <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
              <div className="flex items-center mb-2">
                <Zap size={16} className="text-blue-400" />
              </div>
              <div className="text-2xl font-mono font-bold text-gray-100">{data.totals.tasks}</div>
              <div className="text-[10px] font-mono text-gray-500 uppercase">Tasks Executed</div>
            </div>
            <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
              <div className="flex items-center mb-2">
                <AlertTriangle size={16} className="text-red-400" />
              </div>
              <div className="text-2xl font-mono font-bold text-gray-100">{data.totals.errors}</div>
              <div className="text-[10px] font-mono text-gray-500 uppercase">Errors</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Spend by Agent */}
            <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5">
              <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <BarChart3 size={14} /> Spend by Agent
              </h2>
              <div className="space-y-2">
                {agentEntries.length === 0 ? (
                  <div className="text-center py-6 text-gray-600 text-xs font-mono">No spend data yet</div>
                ) : (
                  agentEntries.map(([agentId, stats]) => {
                    const budget = data.budgets[agentId];
                    const expanded = expandedAgent === agentId;

                    return (
                      <div key={agentId} className="border border-gray-800 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpandedAgent(expanded ? null : agentId)}
                          className="w-full text-left p-3 flex items-center gap-3 hover:bg-gray-900/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono text-gray-200">{agentId}</span>
                              {budget?.paused && (
                                <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20">PAUSED</span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-gray-600">
                              {stats.taskCount} tasks • {stats.avgLatency}ms avg
                            </div>
                          </div>
                          <span className="text-sm font-mono font-bold text-green-400">{formatUsd(stats.totalUsd)}</span>
                          {expanded ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
                        </button>

                        {expanded && budget && (
                          <div className="px-3 pb-3 space-y-2">
                            <SpendBar spent={budget.dailySpentUsd} limit={budget.dailyLimitUsd} label="Daily Budget" />
                            <SpendBar spent={budget.monthlySpentUsd} limit={budget.monthlyLimitUsd} label="Monthly Budget" />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => togglePause(agentId, budget.paused)}
                                className={`flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
                                  budget.paused
                                    ? 'text-green-400 bg-green-400/10 border-green-400/20 hover:bg-green-400/20'
                                    : 'text-red-400 bg-red-400/10 border-red-400/20 hover:bg-red-400/20'
                                }`}
                              >
                                {budget.paused ? <><Play size={10} /> Resume</> : <><Pause size={10} /> Pause</>}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Spend by Model */}
            <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5">
              <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Cpu size={14} /> Spend by Model
              </h2>
              <div className="space-y-3">
                {modelEntries.length === 0 ? (
                  <div className="text-center py-6 text-gray-600 text-xs font-mono">No model data yet</div>
                ) : (
                  modelEntries.map(([model, stats]) => {
                    const totalModelSpend = modelEntries.reduce((sum, [, s]) => sum + s.totalUsd, 0);
                    const pct = totalModelSpend > 0 ? (stats.totalUsd / totalModelSpend) * 100 : 0;

                    return (
                      <div key={model} className="bg-gray-900/60 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-mono text-gray-300">{model}</span>
                          <span className="text-xs font-mono font-bold text-green-400">{formatUsd(stats.totalUsd)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mb-1.5">
                          <div className="h-full rounded-full bg-btc-orange transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex gap-4 text-[10px] font-mono text-gray-600">
                          <span>{stats.taskCount} tasks</span>
                          <span>{Math.round(pct)}% of total</span>
                          {stats.totalTokens > 0 && <span>{(stats.totalTokens / 1000).toFixed(1)}k tokens</span>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Daily spend table */}
              <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider mt-6 mb-3 flex items-center gap-2">
                <Clock size={14} /> Daily Breakdown
              </h3>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {data.daily.length === 0 ? (
                  <div className="text-center py-4 text-gray-600 text-xs font-mono">No daily data</div>
                ) : (
                  data.daily.slice(0, 14).map(day => (
                    <div key={day.date} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-900/50">
                      <span className="text-[10px] font-mono text-gray-500">{day.date}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-gray-600">{day.taskCount} tasks</span>
                        <span className="text-xs font-mono font-semibold text-gray-300">{formatUsd(day.totalUsd)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Avg daily + insights */}
          <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5">
            <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Cost Insights</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] font-mono text-gray-600 uppercase">Avg Daily</div>
                <div className="text-lg font-mono font-bold text-gray-200">{formatUsd(data.totals.avgDailySpend)}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-gray-600 uppercase">Cost/Task</div>
                <div className="text-lg font-mono font-bold text-gray-200">
                  {data.totals.tasks > 0 ? formatUsd(data.totals.spendUsd / data.totals.tasks) : '$0'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-gray-600 uppercase">Active Agents</div>
                <div className="text-lg font-mono font-bold text-gray-200">{agentEntries.length}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-gray-600 uppercase">Error Rate</div>
                <div className={`text-lg font-mono font-bold ${data.totals.errors > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {data.totals.tasks > 0 ? `${Math.round((data.totals.errors / data.totals.tasks) * 100)}%` : '0%'}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
