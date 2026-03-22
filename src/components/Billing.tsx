'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, TrendingUp, Zap, AlertTriangle, RefreshCw, Loader2,
  BarChart3, Clock, Cpu, Pause, Play, ChevronDown, ChevronRight,
  Database, Shield, Eye, EyeOff, Settings2, AlertCircle, CheckCircle2,
  TrendingDown, Layers, Globe,
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

// ── Data Source Catalog ──────────────────────────────────────────────────────
// Every connected + available source, with cost tiers and accuracy impact scores

interface DataSource {
  id: string;
  name: string;
  category: 'market-data' | 'fundamentals' | 'sentiment' | 'macro' | 'credit' | 'ai-model' | 'infra';
  tier: 'free' | 'freemium' | 'paid';
  monthlyEstimate: number;
  connected: boolean;
  enabled: boolean;
  accuracyWeight: number;   // 0-100: how much this source matters to overall intelligence quality
  coverageAreas: string[];  // what data domains it covers
  redundancyGroup?: string; // if another source covers the same data
  impactIfRemoved: {
    briefQuality: number;   // % drop in daily brief quality
    signalAccuracy: number; // % drop in trade signal accuracy
    riskBlindSpots: string; // specific blind spots created
  };
}

const DATA_SOURCES: DataSource[] = [
  // ── Market Data ────────────────────────────────────────────────────────
  {
    id: 'tradingview', name: 'TradingView WS', category: 'market-data', tier: 'freemium',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 95,
    coverageAreas: ['Real-time prices', 'Technical indicators', 'Chart data', 'Alerts'],
    impactIfRemoved: { briefQuality: -35, signalAccuracy: -60, riskBlindSpots: 'No live price feeds. All technical analysis disabled. Signal engine offline.' },
  },
  {
    id: 'crypto-com', name: 'Crypto.com', category: 'market-data', tier: 'free',
    monthlyEstimate: 0, connected: false, enabled: false, accuracyWeight: 40,
    coverageAreas: ['Crypto spot prices', 'Order books', 'Trade history', 'Candlesticks'],
    redundancyGroup: 'crypto-prices',
    impactIfRemoved: { briefQuality: -8, signalAccuracy: -15, riskBlindSpots: 'Reduced crypto price granularity. Missing order book depth for liquidity analysis.' },
  },
  {
    id: 'bigdata', name: 'Bigdata.com', category: 'market-data', tier: 'freemium',
    monthlyEstimate: 0, connected: false, enabled: false, accuracyWeight: 55,
    coverageAreas: ['Equity tearsheets', 'Events calendar', 'Company search', 'Financial data'],
    impactIfRemoved: { briefQuality: -15, signalAccuracy: -20, riskBlindSpots: 'No automated tearsheet generation. Missing event-driven catalysts in briefs.' },
  },

  // ── Fundamentals & Earnings ────────────────────────────────────────────
  {
    id: 'quartr', name: 'Quartr', category: 'fundamentals', tier: 'freemium',
    monthlyEstimate: 0, connected: false, enabled: false, accuracyWeight: 65,
    coverageAreas: ['Earnings calls', 'Financial statements', 'Company events', 'Transcripts'],
    impactIfRemoved: { briefQuality: -20, signalAccuracy: -25, riskBlindSpots: 'No earnings call intelligence. Missing management guidance signals and forward estimates.' },
  },
  {
    id: 'factset', name: 'FactSet', category: 'fundamentals', tier: 'paid',
    monthlyEstimate: 50, connected: false, enabled: false, accuracyWeight: 80,
    coverageAreas: ['Consensus estimates', 'Fundamentals', 'M&A data', 'Global prices', 'Metrics'],
    impactIfRemoved: { briefQuality: -25, signalAccuracy: -30, riskBlindSpots: 'No institutional-grade estimates. Missing M&A pipeline. Fundamental analysis severely degraded.' },
  },
  {
    id: 'sp-global', name: 'S&P Global', category: 'fundamentals', tier: 'paid',
    monthlyEstimate: 75, connected: false, enabled: false, accuracyWeight: 85,
    coverageAreas: ['Company fundamentals', 'Capitalization', 'Industry classification', 'Pricing'],
    redundancyGroup: 'fundamentals',
    impactIfRemoved: { briefQuality: -25, signalAccuracy: -30, riskBlindSpots: 'No S&P classification data. Missing capital structure analysis. Sector rotation signals blind.' },
  },
  {
    id: 'daloopa', name: 'Daloopa', category: 'fundamentals', tier: 'freemium',
    monthlyEstimate: 0, connected: false, enabled: false, accuracyWeight: 45,
    coverageAreas: ['KPIs with hyperlinks', 'Financial fundamental data', 'Company series'],
    redundancyGroup: 'fundamentals',
    impactIfRemoved: { briefQuality: -10, signalAccuracy: -12, riskBlindSpots: 'Missing granular KPI tracking. Less sourced data for fundamental verification.' },
  },

  // ── Sentiment & Social ─────────────────────────────────────────────────
  {
    id: 'lunarcrush', name: 'LunarCrush', category: 'sentiment', tier: 'free',
    monthlyEstimate: 0, connected: false, enabled: false, accuracyWeight: 50,
    coverageAreas: ['Crypto social sentiment', 'Stock social metrics', 'Creator analytics', 'Topic trends'],
    impactIfRemoved: { briefQuality: -12, signalAccuracy: -18, riskBlindSpots: 'No social sentiment layer. Missing crowd psychology signals. Meme/narrative risk untracked.' },
  },

  // ── Macro & Fixed Income ───────────────────────────────────────────────
  {
    id: 'lseg', name: 'LSEG', category: 'macro', tier: 'paid',
    monthlyEstimate: 100, connected: false, enabled: false, accuracyWeight: 75,
    coverageAreas: ['FX spot/forward', 'Bond pricing', 'Options', 'IR swaps', 'Credit curves'],
    impactIfRemoved: { briefQuality: -20, signalAccuracy: -25, riskBlindSpots: 'No real-time fixed income data. Missing yield curve dynamics, FX forward rates, credit spread movements.' },
  },
  {
    id: 'fred', name: 'FRED (Fed Reserve)', category: 'macro', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 70,
    coverageAreas: ['Interest rates', 'Employment', 'GDP', 'Inflation', 'Money supply'],
    impactIfRemoved: { briefQuality: -22, signalAccuracy: -20, riskBlindSpots: 'No macroeconomic indicators. Missing Fed data for rate expectations and economic cycle positioning.' },
  },
  {
    id: 'bls', name: 'BLS (Bureau of Labor)', category: 'macro', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 40,
    coverageAreas: ['CPI/PPI', 'Employment data', 'Wage growth', 'Productivity'],
    redundancyGroup: 'macro-econ',
    impactIfRemoved: { briefQuality: -10, signalAccuracy: -8, riskBlindSpots: 'Missing direct BLS feeds. Inflation and labor data delayed or from secondary sources.' },
  },
  {
    id: 'treasury', name: 'Treasury.gov', category: 'macro', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 50,
    coverageAreas: ['Yield curves', 'Auction results', 'Debt issuance', 'TIC flows'],
    impactIfRemoved: { briefQuality: -15, signalAccuracy: -12, riskBlindSpots: 'No direct Treasury yield data. Missing auction demand signals and foreign holder flows.' },
  },
  {
    id: 'cftc', name: 'CFTC COT Reports', category: 'macro', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 55,
    coverageAreas: ['Futures positioning', 'Speculative vs commercial', 'Open interest'],
    impactIfRemoved: { briefQuality: -15, signalAccuracy: -18, riskBlindSpots: 'No positioning data. Missing speculative crowding signals and hedger/dealer flow analysis.' },
  },
  {
    id: 'defillama', name: 'DefiLlama', category: 'macro', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 35,
    coverageAreas: ['DeFi TVL', 'Protocol analytics', 'Chain comparisons', 'Yield data'],
    impactIfRemoved: { briefQuality: -8, signalAccuracy: -10, riskBlindSpots: 'No DeFi metrics. Missing TVL flows, protocol health, and on-chain yield dynamics.' },
  },

  // ── Credit & Risk ──────────────────────────────────────────────────────
  {
    id: 'moodys', name: "Moody's", category: 'credit', tier: 'paid',
    monthlyEstimate: 60, connected: false, enabled: false, accuracyWeight: 70,
    coverageAreas: ['Credit ratings', 'Risk analytics', 'Sector outlooks', 'Entity research'],
    impactIfRemoved: { briefQuality: -18, signalAccuracy: -22, riskBlindSpots: 'No credit risk layer. Missing rating change signals, sector credit deterioration, default probability.' },
  },

  // ── AI Models ──────────────────────────────────────────────────────────
  {
    id: 'anthropic', name: 'Anthropic (Claude)', category: 'ai-model', tier: 'paid',
    monthlyEstimate: 20, connected: true, enabled: true, accuracyWeight: 90,
    coverageAreas: ['Report generation', 'Analysis', 'Task execution', 'Brief synthesis'],
    impactIfRemoved: { briefQuality: -80, signalAccuracy: -70, riskBlindSpots: 'Primary intelligence engine offline. No automated reports, analysis, or brief generation possible.' },
  },
  {
    id: 'gemini', name: 'Google Gemini', category: 'ai-model', tier: 'paid',
    monthlyEstimate: 15, connected: true, enabled: true, accuracyWeight: 60,
    coverageAreas: ['Secondary analysis', 'Multimodal processing', 'Code generation'],
    redundancyGroup: 'ai-models',
    impactIfRemoved: { briefQuality: -15, signalAccuracy: -12, riskBlindSpots: 'No multimodal backup. Single-model dependency increases. Reduced analysis throughput.' },
  },
  {
    id: 'coingecko', name: 'CoinGecko', category: 'market-data', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 30,
    coverageAreas: ['Crypto market caps', 'Token metadata', 'Exchange volumes', 'Categories'],
    redundancyGroup: 'crypto-prices',
    impactIfRemoved: { briefQuality: -5, signalAccuracy: -8, riskBlindSpots: 'Missing crypto metadata and market cap rankings. Reduced altcoin coverage.' },
  },
  {
    id: 'fear-greed', name: 'Fear & Greed Index', category: 'sentiment', tier: 'free',
    monthlyEstimate: 0, connected: true, enabled: true, accuracyWeight: 25,
    coverageAreas: ['Market sentiment gauge', 'Contrarian signals'],
    impactIfRemoved: { briefQuality: -5, signalAccuracy: -8, riskBlindSpots: 'No aggregate sentiment metric. Missing contrarian timing signals.' },
  },
];

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  'market-data': { label: 'Market Data', color: 'text-blue-400 bg-blue-400/10' },
  'fundamentals': { label: 'Fundamentals', color: 'text-purple-400 bg-purple-400/10' },
  'sentiment': { label: 'Sentiment', color: 'text-pink-400 bg-pink-400/10' },
  'macro': { label: 'Macro & Rates', color: 'text-cyan-400 bg-cyan-400/10' },
  'credit': { label: 'Credit & Risk', color: 'text-yellow-400 bg-yellow-400/10' },
  'ai-model': { label: 'AI Models', color: 'text-btc-orange bg-btc-orange/10' },
  'infra': { label: 'Infrastructure', color: 'text-gray-400 bg-gray-400/10' },
};

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

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 0.001);
  const w = 80; const h = 24;
  const points = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke="#f7931a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccuracyGauge({ value }: { value: number }) {
  const color = value >= 80 ? 'text-green-400' : value >= 60 ? 'text-yellow-400' : value >= 40 ? 'text-btc-orange' : 'text-red-400';
  const bgColor = value >= 80 ? 'bg-green-400' : value >= 60 ? 'bg-yellow-400' : value >= 40 ? 'bg-btc-orange' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bgColor} transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold ${color}`}>{value}%</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Billing() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sources' | 'impact'>('overview');
  const [sources, setSources] = useState<DataSource[]>(DATA_SOURCES);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState('');

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

  const toggleSource = (sourceId: string) => {
    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, enabled: !s.enabled } : s));
  };

  const setSourceLimit = (sourceId: string, monthly: number) => {
    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, monthlyEstimate: monthly } : s));
    setEditingLimit(null);
  };

  // ── Computed metrics ────────────────────────────────────────────────────
  const agentEntries = data ? Object.entries(data.byAgent).sort(([, a], [, b]) => b.totalUsd - a.totalUsd) : [];
  const modelEntries = data ? Object.entries(data.byModel).sort(([, a], [, b]) => b.totalUsd - a.totalUsd) : [];
  const last7Days = data?.daily.slice(0, 7).reverse().map(d => d.totalUsd) || [];

  const enabledSources = sources.filter(s => s.enabled);
  const disabledSources = sources.filter(s => !s.enabled);
  const totalMonthlyEstimate = sources.reduce((sum, s) => sum + (s.enabled ? s.monthlyEstimate : 0), 0);

  // Overall accuracy score based on enabled sources
  const maxAccuracy = sources.reduce((sum, s) => sum + s.accuracyWeight, 0);
  const currentAccuracy = enabledSources.reduce((sum, s) => sum + s.accuracyWeight, 0);
  const accuracyScore = Math.round((currentAccuracy / maxAccuracy) * 100);

  // Categories for grouping tiles
  const categories = [...new Set(sources.map(s => s.category))];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <DollarSign size={20} className="text-btc-orange" />
            Billing & Data Sources
          </h1>
          <p className="text-xs text-gray-500 mt-1">Spend tracking, data source budgets, and accuracy impact analysis</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {['7d', '14d', '30d', '90d'].map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${
                  period === p ? 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange' : 'border-gray-800 text-gray-500 hover:text-gray-300'
                }`}>{p}</button>
            ))}
          </div>
          <button onClick={() => { setLoading(true); fetchBilling(); }}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-btc-orange transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 pb-px">
        {([
          { key: 'overview' as const, label: 'Spend Overview', icon: <BarChart3 size={12} /> },
          { key: 'sources' as const, label: 'Data Sources', icon: <Database size={12} /> },
          { key: 'impact' as const, label: 'Accuracy Impact', icon: <Shield size={12} /> },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-btc-orange text-btc-orange'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {loading && !data && activeTab === 'overview' ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-btc-orange" />
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════════
              TAB 1: SPEND OVERVIEW (existing billing view)
              ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && data && (
            <>
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
                  <div className="flex items-center mb-2"><TrendingUp size={16} className="text-btc-orange" /></div>
                  <div className="text-2xl font-mono font-bold text-gray-100">{formatUsd(data.totals.projectedMonthly)}</div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase">Projected Monthly</div>
                </div>
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
                  <div className="flex items-center mb-2"><Zap size={16} className="text-blue-400" /></div>
                  <div className="text-2xl font-mono font-bold text-gray-100">{data.totals.tasks}</div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase">Tasks Executed</div>
                </div>
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
                  <div className="flex items-center mb-2"><AlertTriangle size={16} className="text-red-400" /></div>
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
                    ) : agentEntries.map(([agentId, stats]) => {
                      const budget = data.budgets[agentId];
                      const expanded = expandedAgent === agentId;
                      return (
                        <div key={agentId} className="border border-gray-800 rounded-lg overflow-hidden">
                          <button onClick={() => setExpandedAgent(expanded ? null : agentId)}
                            className="w-full text-left p-3 flex items-center gap-3 hover:bg-gray-900/50 transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-gray-200">{agentId}</span>
                                {budget?.paused && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20">PAUSED</span>}
                              </div>
                              <div className="text-[10px] font-mono text-gray-600">{stats.taskCount} tasks • {stats.avgLatency}ms avg</div>
                            </div>
                            <span className="text-sm font-mono font-bold text-green-400">{formatUsd(stats.totalUsd)}</span>
                            {expanded ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
                          </button>
                          {expanded && budget && (
                            <div className="px-3 pb-3 space-y-2">
                              <SpendBar spent={budget.dailySpentUsd} limit={budget.dailyLimitUsd} label="Daily Budget" />
                              <SpendBar spent={budget.monthlySpentUsd} limit={budget.monthlyLimitUsd} label="Monthly Budget" />
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => togglePause(agentId, budget.paused)}
                                  className={`flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
                                    budget.paused ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'
                                  }`}>
                                  {budget.paused ? <><Play size={10} /> Resume</> : <><Pause size={10} /> Pause</>}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Spend by Model + Daily */}
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5">
                  <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Cpu size={14} /> Spend by Model
                  </h2>
                  <div className="space-y-3">
                    {modelEntries.length === 0 ? (
                      <div className="text-center py-6 text-gray-600 text-xs font-mono">No model data yet</div>
                    ) : modelEntries.map(([model, stats]) => {
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
                    })}
                  </div>
                  <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider mt-6 mb-3 flex items-center gap-2">
                    <Clock size={14} /> Daily Breakdown
                  </h3>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {data.daily.length === 0 ? (
                      <div className="text-center py-4 text-gray-600 text-xs font-mono">No daily data</div>
                    ) : data.daily.slice(0, 14).map(day => (
                      <div key={day.date} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-900/50">
                        <span className="text-[10px] font-mono text-gray-500">{day.date}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-gray-600">{day.taskCount} tasks</span>
                          <span className="text-xs font-mono font-semibold text-gray-300">{formatUsd(day.totalUsd)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cost Insights */}
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
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB 2: DATA SOURCE TILES
              ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'sources' && (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
                  <Database size={16} className="text-blue-400 mb-2" />
                  <div className="text-2xl font-mono font-bold text-gray-100">{enabledSources.length}</div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase">Active Sources</div>
                </div>
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
                  <Globe size={16} className="text-gray-400 mb-2" />
                  <div className="text-2xl font-mono font-bold text-gray-100">{sources.length}</div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase">Total Available</div>
                </div>
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
                  <DollarSign size={16} className="text-green-400 mb-2" />
                  <div className="text-2xl font-mono font-bold text-gray-100">{formatUsd(totalMonthlyEstimate)}</div>
                  <div className="text-[10px] font-mono text-gray-500 uppercase">Est. Monthly Cost</div>
                </div>
                <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4">
                  <Shield size={16} className="text-btc-orange mb-2" />
                  <AccuracyGauge value={accuracyScore} />
                  <div className="text-[10px] font-mono text-gray-500 uppercase mt-1">Accuracy Score</div>
                </div>
              </div>

              {/* Source tiles by category */}
              {categories.map(cat => {
                const catInfo = CATEGORY_LABELS[cat] || { label: cat, color: 'text-gray-400 bg-gray-400/10' };
                const catSources = sources.filter(s => s.category === cat);
                return (
                  <div key={cat} className="mb-6">
                    <h2 className="text-xs font-mono uppercase tracking-wider mb-3 flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded ${catInfo.color}`}>{catInfo.label}</span>
                      <span className="text-gray-600">{catSources.filter(s => s.enabled).length}/{catSources.length} active</span>
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {catSources.map(source => {
                        const expanded = expandedSource === source.id;
                        return (
                          <div key={source.id} className={`border rounded-xl bg-gray-950/80 overflow-hidden transition-colors ${
                            source.enabled ? 'border-gray-700' : 'border-gray-800/50 opacity-60'
                          }`}>
                            <div className="p-4">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${source.connected ? 'bg-green-400' : 'bg-gray-600'}`} />
                                  <span className="text-sm font-mono font-medium text-gray-200">{source.name}</span>
                                </div>
                                <button onClick={() => toggleSource(source.id)}
                                  className={`p-1 rounded transition-colors ${source.enabled ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-600 hover:bg-gray-800'}`}>
                                  {source.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                                </button>
                              </div>

                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                                  source.tier === 'free' ? 'bg-green-400/10 text-green-400' :
                                  source.tier === 'freemium' ? 'bg-blue-400/10 text-blue-400' :
                                  'bg-btc-orange/10 text-btc-orange'
                                }`}>{source.tier}</span>
                                {source.connected ? (
                                  <span className="text-[9px] font-mono text-green-400/60">Connected</span>
                                ) : (
                                  <span className="text-[9px] font-mono text-gray-600">Not connected</span>
                                )}
                              </div>

                              {/* Monthly cost / limit */}
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-mono text-gray-500">Monthly limit</span>
                                {editingLimit === source.id ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-gray-400">$</span>
                                    <input type="number" value={limitValue}
                                      onChange={e => setLimitValue(e.target.value)}
                                      className="w-16 bg-gray-900 border border-btc-orange/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-gray-200 focus:outline-none"
                                      autoFocus
                                      onKeyDown={e => { if (e.key === 'Enter') setSourceLimit(source.id, parseFloat(limitValue) || 0); if (e.key === 'Escape') setEditingLimit(null); }}
                                    />
                                    <button onClick={() => setSourceLimit(source.id, parseFloat(limitValue) || 0)}
                                      className="text-[9px] font-mono text-btc-orange hover:text-btc-orange/80">Set</button>
                                  </div>
                                ) : (
                                  <button onClick={() => { setEditingLimit(source.id); setLimitValue(String(source.monthlyEstimate)); }}
                                    className="text-[10px] font-mono text-gray-300 hover:text-btc-orange flex items-center gap-1 transition-colors">
                                    {formatUsd(source.monthlyEstimate)}/mo
                                    <Settings2 size={9} className="text-gray-600" />
                                  </button>
                                )}
                              </div>

                              {/* Accuracy weight bar */}
                              <div className="mb-1">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[9px] font-mono text-gray-600">Accuracy weight</span>
                                  <span className="text-[9px] font-mono text-gray-500">{source.accuracyWeight}/100</span>
                                </div>
                                <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${
                                    source.accuracyWeight >= 70 ? 'bg-btc-orange' : source.accuracyWeight >= 40 ? 'bg-blue-400' : 'bg-gray-500'
                                  }`} style={{ width: `${source.accuracyWeight}%` }} />
                                </div>
                              </div>

                              {/* Coverage tags */}
                              <div className="flex flex-wrap gap-1 mt-2">
                                {source.coverageAreas.slice(0, 3).map(area => (
                                  <span key={area} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{area}</span>
                                ))}
                                {source.coverageAreas.length > 3 && (
                                  <span className="text-[8px] font-mono text-gray-600">+{source.coverageAreas.length - 3}</span>
                                )}
                              </div>

                              {/* Expand for impact details */}
                              <button onClick={() => setExpandedSource(expanded ? null : source.id)}
                                className="w-full mt-2 text-[9px] font-mono text-gray-600 hover:text-btc-orange flex items-center justify-center gap-1 transition-colors">
                                {expanded ? 'Hide impact' : 'View removal impact'}
                                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              </button>
                            </div>

                            {expanded && (
                              <div className="border-t border-gray-800 bg-gray-900/40 p-3 space-y-2">
                                <div className="flex items-center gap-3">
                                  <div className="flex-1">
                                    <div className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">Brief Quality</div>
                                    <span className={`text-xs font-mono font-bold ${source.impactIfRemoved.briefQuality <= -20 ? 'text-red-400' : 'text-yellow-400'}`}>
                                      {source.impactIfRemoved.briefQuality}%
                                    </span>
                                  </div>
                                  <div className="flex-1">
                                    <div className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">Signal Accuracy</div>
                                    <span className={`text-xs font-mono font-bold ${source.impactIfRemoved.signalAccuracy <= -20 ? 'text-red-400' : 'text-yellow-400'}`}>
                                      {source.impactIfRemoved.signalAccuracy}%
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">Risk Blind Spots</div>
                                  <p className="text-[10px] text-gray-400 leading-relaxed">{source.impactIfRemoved.riskBlindSpots}</p>
                                </div>
                                {source.redundancyGroup && (
                                  <div className="text-[9px] font-mono text-blue-400/60 flex items-center gap-1">
                                    <Layers size={9} /> Partial redundancy with other {source.redundancyGroup} sources
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
              })}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB 3: ACCURACY IMPACT REPORT
              ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'impact' && (
            <>
              {/* Top-level accuracy gauge */}
              <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-mono font-bold text-gray-200">Intelligence Accuracy Score</h2>
                    <p className="text-[10px] font-mono text-gray-500 mt-0.5">
                      Based on {enabledSources.length}/{sources.length} active data sources
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={`text-3xl font-mono font-bold ${
                      accuracyScore >= 80 ? 'text-green-400' : accuracyScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                    }`}>{accuracyScore}%</div>
                    <div className="text-[10px] font-mono text-gray-600">
                      {accuracyScore >= 80 ? 'Excellent' : accuracyScore >= 60 ? 'Good' : accuracyScore >= 40 ? 'Degraded' : 'Critical'}
                    </div>
                  </div>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${
                    accuracyScore >= 80 ? 'bg-green-400' : accuracyScore >= 60 ? 'bg-yellow-400' : accuracyScore >= 40 ? 'bg-btc-orange' : 'bg-red-400'
                  }`} style={{ width: `${accuracyScore}%` }} />
                </div>
              </div>

              {/* Disabled sources — what you're missing */}
              {disabledSources.length > 0 && (
                <div className="border border-red-400/20 rounded-xl bg-red-400/5 p-5 mb-6">
                  <h2 className="text-xs font-mono text-red-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <AlertCircle size={14} /> Disabled Sources — Accuracy Gaps
                  </h2>
                  <div className="space-y-3">
                    {disabledSources
                      .sort((a, b) => b.accuracyWeight - a.accuracyWeight)
                      .map(source => (
                      <div key={source.id} className="border border-gray-800 rounded-lg bg-gray-950/80 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium text-gray-200">{source.name}</span>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${CATEGORY_LABELS[source.category]?.color || 'bg-gray-800 text-gray-400'}`}>
                              {CATEGORY_LABELS[source.category]?.label || source.category}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-500">{formatUsd(source.monthlyEstimate)}/mo</span>
                            <button onClick={() => toggleSource(source.id)}
                              className="text-[10px] font-mono px-2 py-1 rounded border border-green-400/20 bg-green-400/10 text-green-400 hover:bg-green-400/20 transition-colors">
                              Enable
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mb-2">
                          <div>
                            <div className="text-[9px] font-mono text-gray-600 uppercase">Brief Quality</div>
                            <span className="text-sm font-mono font-bold text-red-400">{source.impactIfRemoved.briefQuality}%</span>
                          </div>
                          <div>
                            <div className="text-[9px] font-mono text-gray-600 uppercase">Signal Accuracy</div>
                            <span className="text-sm font-mono font-bold text-red-400">{source.impactIfRemoved.signalAccuracy}%</span>
                          </div>
                          <div>
                            <div className="text-[9px] font-mono text-gray-600 uppercase">Weight</div>
                            <span className="text-sm font-mono font-bold text-btc-orange">{source.accuracyWeight}/100</span>
                          </div>
                        </div>
                        <div className="bg-gray-900/60 rounded-lg p-2.5">
                          <div className="text-[9px] font-mono text-gray-600 uppercase mb-1">Blind Spots Created</div>
                          <p className="text-[10px] text-gray-400 leading-relaxed">{source.impactIfRemoved.riskBlindSpots}</p>
                        </div>
                        {source.redundancyGroup && (
                          <div className="text-[9px] font-mono text-blue-400/60 flex items-center gap-1 mt-2">
                            <Layers size={9} /> Partially covered by other {source.redundancyGroup} sources
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Enabled sources — what's working */}
              <div className="border border-green-400/20 rounded-xl bg-green-400/5 p-5 mb-6">
                <h2 className="text-xs font-mono text-green-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <CheckCircle2 size={14} /> Active Sources — Coverage Map
                </h2>
                <div className="space-y-2">
                  {enabledSources
                    .sort((a, b) => b.accuracyWeight - a.accuracyWeight)
                    .map(source => (
                    <div key={source.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-900/30 transition-colors">
                      <div className="w-24 flex-shrink-0">
                        <span className="text-xs font-mono text-gray-200">{source.name}</span>
                      </div>
                      <div className="flex-1">
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-green-400 transition-all" style={{ width: `${source.accuracyWeight}%` }} />
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400 w-12 text-right">{source.accuracyWeight}/100</span>
                      <div className="flex flex-wrap gap-1 w-48">
                        {source.coverageAreas.slice(0, 2).map(area => (
                          <span key={area} className="text-[8px] font-mono px-1 py-0.5 rounded bg-gray-800 text-gray-500">{area}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Category coverage analysis */}
              <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5">
                <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <TrendingDown size={14} /> Category Coverage Analysis
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categories.map(cat => {
                    const catInfo = CATEGORY_LABELS[cat] || { label: cat, color: 'text-gray-400 bg-gray-400/10' };
                    const catSources = sources.filter(s => s.category === cat);
                    const catEnabled = catSources.filter(s => s.enabled);
                    const catMaxWeight = catSources.reduce((sum, s) => sum + s.accuracyWeight, 0);
                    const catCurWeight = catEnabled.reduce((sum, s) => sum + s.accuracyWeight, 0);
                    const catPct = catMaxWeight > 0 ? Math.round((catCurWeight / catMaxWeight) * 100) : 0;
                    const catCost = catEnabled.reduce((sum, s) => sum + s.monthlyEstimate, 0);

                    return (
                      <div key={cat} className="border border-gray-800 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${catInfo.color}`}>{catInfo.label}</span>
                          <span className="text-[10px] font-mono text-gray-500">{catEnabled.length}/{catSources.length}</span>
                        </div>
                        <div className="mb-2">
                          <AccuracyGauge value={catPct} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-gray-600">{formatUsd(catCost)}/mo</span>
                          <span className={`text-[9px] font-mono ${
                            catPct >= 80 ? 'text-green-400' : catPct >= 50 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {catPct >= 80 ? 'Strong' : catPct >= 50 ? 'Moderate' : 'Weak'} coverage
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
