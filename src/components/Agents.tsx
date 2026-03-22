'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Loader2, Play, CheckCircle2, XCircle, AlertTriangle,
  Shield, Brain, Share2, BarChart3, Server, ChevronDown, ChevronRight,
  Crosshair, DollarSign, Eye, Radio, Zap, Target, TrendingUp, TrendingDown,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface RiskProfile {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  apiCostPerRun: string;
  rateLimitImpact: 'none' | 'low' | 'moderate' | 'heavy';
  dataExposure: 'none' | 'internal' | 'external';
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
  runEndpoint: string;
  evalEndpoint: string;
}

interface EvalResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface EvalResponse {
  agentId: string;
  agentName: string;
  evaluation: {
    results: EvalResult[];
    passed: number;
    total: number;
    score: number;
    status: 'pass' | 'partial' | 'fail';
    evaluatedAt: string;
  };
}

interface AgentsData {
  agents: AgentDef[];
  total: number;
  healthy: number;
  checkedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: <Shield size={14} />,
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
  security: 'text-red-400 border-red-400/30 bg-red-400/10',
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
  low: 'text-green-400 bg-green-400/10 border-green-400/30',
  medium: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  critical: 'text-red-400 bg-red-400/10 border-red-400/30',
};

const RISK_GLOW: Record<string, string> = {
  low: '',
  medium: '',
  high: 'shadow-[0_0_8px_rgba(251,146,60,0.3)]',
  critical: 'shadow-[0_0_12px_rgba(239,68,68,0.4)]',
};

const STATUS_COLORS: Record<string, string> = {
  pass: 'text-green-400 bg-green-400/10 border-green-400/30',
  partial: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  fail: 'text-red-400 bg-red-400/10 border-red-400/30',
};

// ── Risk Score Bar ──────────────────────────────────────────────────────────

function RiskScoreBar({ score }: { score: number }) {
  const segments = Array.from({ length: 10 }, (_, i) => i + 1);
  return (
    <div className="flex gap-0.5">
      {segments.map(s => (
        <div
          key={s}
          className={`h-2 w-2 rounded-sm transition-all ${
            s <= score
              ? s <= 3 ? 'bg-green-500' : s <= 6 ? 'bg-yellow-500' : s <= 8 ? 'bg-orange-500' : 'bg-red-500'
              : 'bg-gray-800'
          }`}
        />
      ))}
    </div>
  );
}

// ── Agent Card ───────────────────────────────────────────────────────────────

type CardSection = 'none' | 'profile' | 'risk' | 'capabilities' | 'eval';

function AgentCard({ agent }: { agent: AgentDef }) {
  const [activeSection, setActiveSection] = useState<CardSection>('none');
  const [evalData, setEvalData] = useState<EvalResponse | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const toggle = (section: CardSection) => {
    setActiveSection(prev => prev === section ? 'none' : section);
  };

  const runEval = async () => {
    setEvalLoading(true);
    try {
      const res = await apiFetch('/api/admin/agents', {
        method: 'POST',
        body: JSON.stringify({ agentId: agent.id, action: 'eval' }),
      });
      if (res.ok) {
        const data = await res.json();
        setEvalData(data);
        setActiveSection('eval');
      }
    } catch {
      // silently fail
    } finally {
      setEvalLoading(false);
    }
  };

  const catColor = CATEGORY_COLORS[agent.category] || 'text-gray-400 border-gray-400/30 bg-gray-400/10';
  const riskColor = agent.risk ? RISK_COLORS[agent.risk.level] || '' : '';
  const riskGlow = agent.risk ? RISK_GLOW[agent.risk.level] || '' : '';

  return (
    <div className={`border rounded-lg transition-all ${
      agent.depsHealthy
        ? 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
        : 'border-yellow-900/30 bg-yellow-950/10 hover:border-yellow-800/30'
    }`}>
      {/* ── Header ── */}
      <div className="p-4">
        {/* Codename + Name row */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${agent.depsHealthy ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]'}`} />
            {agent.profile && (
              <span className="text-[10px] font-mono font-bold text-btc-orange tracking-widest uppercase">
                {agent.profile.codename}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {agent.risk && (
              <div className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${riskColor} ${riskGlow}`}>
                RISK {agent.risk.score}/10
              </div>
            )}
            <div className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${catColor}`}>
              {agent.category}
            </div>
          </div>
        </div>

        {/* Name + version */}
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-mono text-gray-200">{agent.name}</span>
          <span className="text-[9px] font-mono text-gray-600">v{agent.version}</span>
        </div>

        {/* Role */}
        {agent.profile && (
          <p className="text-[10px] font-mono text-gray-500 italic mb-2">{agent.profile.role}</p>
        )}

        {/* Description */}
        <p className="text-[10px] font-mono text-gray-500 leading-relaxed mb-3">{agent.description}</p>

        {/* Risk flags row */}
        {agent.risk && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {agent.risk.canPublish && (
              <div className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/5 text-red-400">
                <Radio size={8} /> PUBLISHES
              </div>
            )}
            {agent.risk.canSpend && (
              <div className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/5 text-yellow-400">
                <DollarSign size={8} /> SPENDS
              </div>
            )}
            {agent.risk.dataExposure === 'external' && (
              <div className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border border-orange-500/30 bg-orange-500/5 text-orange-400">
                <Eye size={8} /> EXTERNAL DATA
              </div>
            )}
            {agent.risk.dataExposure === 'internal' && (
              <div className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border border-gray-600/30 bg-gray-600/5 text-gray-400">
                <Eye size={8} /> INTERNAL ONLY
              </div>
            )}
            <div className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border border-gray-700/30 bg-gray-700/5 text-gray-500">
              <DollarSign size={8} /> {agent.risk.apiCostPerRun}
            </div>
          </div>
        )}

        {/* Risk score bar */}
        {agent.risk && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Threat Level</span>
            <RiskScoreBar score={agent.risk.score} />
            <span className={`text-[9px] font-mono uppercase tracking-wider ${
              agent.risk.level === 'critical' ? 'text-red-400' :
              agent.risk.level === 'high' ? 'text-orange-400' :
              agent.risk.level === 'medium' ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {agent.risk.level}
            </span>
          </div>
        )}

        {/* Dep health bar */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Dependencies</span>
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${agent.depsHealthy ? 'bg-green-500' : 'bg-yellow-500'}`}
              style={{ width: `${agent.depsTotal > 0 ? (agent.depsConfigured / agent.depsTotal) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[9px] font-mono text-gray-500">{agent.depsConfigured}/{agent.depsTotal}</span>
        </div>

        {/* Missing deps */}
        {agent.missingDeps.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-3 h-3 text-yellow-500 flex-shrink-0" />
            <span className="text-[9px] font-mono text-yellow-400">
              Missing: {agent.missingDeps.join(', ')}
            </span>
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runEval}
            disabled={evalLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-btc-orange/30 bg-btc-orange/5 text-btc-orange text-[9px] font-mono uppercase tracking-wider hover:bg-btc-orange/10 transition-all disabled:opacity-40"
          >
            {evalLoading ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            {evalLoading ? 'Evaluating...' : 'Run Eval'}
          </button>
          <button
            onClick={() => toggle('profile')}
            className={`flex items-center gap-1 px-2 py-1.5 text-[9px] font-mono transition-colors ${
              activeSection === 'profile' ? 'text-btc-orange' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {activeSection === 'profile' ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Profile
          </button>
          <button
            onClick={() => toggle('risk')}
            className={`flex items-center gap-1 px-2 py-1.5 text-[9px] font-mono transition-colors ${
              activeSection === 'risk' ? 'text-btc-orange' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {activeSection === 'risk' ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Risk Intel
          </button>
          <button
            onClick={() => toggle('capabilities')}
            className={`flex items-center gap-1 px-2 py-1.5 text-[9px] font-mono transition-colors ${
              activeSection === 'capabilities' ? 'text-btc-orange' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {activeSection === 'capabilities' ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Capabilities
          </button>
        </div>
      </div>

      {/* ── Expanded: Profile ── */}
      {activeSection === 'profile' && agent.profile && (
        <div className="px-4 pb-4 border-t border-gray-800/50 pt-3 space-y-3">
          {/* Strengths */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className="w-3 h-3 text-green-500" />
              <span className="text-[9px] font-mono text-green-400 uppercase tracking-wider">Strengths</span>
            </div>
            <div className="space-y-1 ml-4">
              {agent.profile.strengths.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-green-500/50 mt-1.5 flex-shrink-0" />
                  <span className="text-[9px] font-mono text-gray-400">{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Weaknesses */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingDown className="w-3 h-3 text-red-500" />
              <span className="text-[9px] font-mono text-red-400 uppercase tracking-wider">Weaknesses</span>
            </div>
            <div className="space-y-1 ml-4">
              {agent.profile.weaknesses.map((w, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-red-500/50 mt-1.5 flex-shrink-0" />
                  <span className="text-[9px] font-mono text-gray-400">{w}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Behavioral Tendencies */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Crosshair className="w-3 h-3 text-btc-orange" />
              <span className="text-[9px] font-mono text-btc-orange uppercase tracking-wider">Behavioral Tendencies</span>
            </div>
            <div className="space-y-1 ml-4">
              {agent.profile.tendencies.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-btc-orange/50 mt-1.5 flex-shrink-0" />
                  <span className="text-[9px] font-mono text-gray-400">{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Data Flow */}
          <div className="border border-gray-800/50 rounded p-2 bg-black/30">
            <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Data Flow</div>
            <div className="text-[9px] font-mono text-gray-400">{agent.profile.dataFlow}</div>
          </div>

          {/* Cost Profile */}
          <div className="border border-gray-800/50 rounded p-2 bg-black/30">
            <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Cost Profile</div>
            <div className="text-[9px] font-mono text-gray-400">{agent.profile.costProfile}</div>
          </div>
        </div>
      )}

      {/* ── Expanded: Risk Intel ── */}
      {activeSection === 'risk' && agent.risk && (
        <div className="px-4 pb-4 border-t border-gray-800/50 pt-3 space-y-3">
          {/* Risk grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Risk Level</div>
              <div className={`text-[11px] font-mono font-bold uppercase ${
                agent.risk.level === 'critical' ? 'text-red-400' :
                agent.risk.level === 'high' ? 'text-orange-400' :
                agent.risk.level === 'medium' ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {agent.risk.level} ({agent.risk.score}/10)
              </div>
            </div>
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Cost / Run</div>
              <div className="text-[11px] font-mono text-gray-300">{agent.risk.apiCostPerRun}</div>
            </div>
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Rate Limit Impact</div>
              <div className={`text-[11px] font-mono ${
                agent.risk.rateLimitImpact === 'heavy' ? 'text-red-400' :
                agent.risk.rateLimitImpact === 'moderate' ? 'text-yellow-400' : 'text-gray-300'
              }`}>
                {agent.risk.rateLimitImpact}
              </div>
            </div>
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Cooldown</div>
              <div className="text-[11px] font-mono text-gray-300">{agent.risk.cooldown}</div>
            </div>
          </div>

          {/* Permission flags */}
          <div className="flex flex-wrap gap-2">
            <div className={`flex items-center gap-1 text-[9px] font-mono px-2 py-1 rounded border ${
              agent.risk.canPublish ? 'border-red-500/30 text-red-400 bg-red-500/5' : 'border-gray-700/30 text-gray-600 bg-gray-700/5'
            }`}>
              <Radio size={9} />
              {agent.risk.canPublish ? 'CAN PUBLISH' : 'NO PUBLISH'}
            </div>
            <div className={`flex items-center gap-1 text-[9px] font-mono px-2 py-1 rounded border ${
              agent.risk.canSpend ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5' : 'border-gray-700/30 text-gray-600 bg-gray-700/5'
            }`}>
              <DollarSign size={9} />
              {agent.risk.canSpend ? 'CAN SPEND' : 'NO SPEND'}
            </div>
            <div className={`flex items-center gap-1 text-[9px] font-mono px-2 py-1 rounded border ${
              agent.risk.dataExposure === 'external' ? 'border-orange-500/30 text-orange-400 bg-orange-500/5' :
              agent.risk.dataExposure === 'internal' ? 'border-gray-600/30 text-gray-400 bg-gray-600/5' :
              'border-gray-700/30 text-gray-600 bg-gray-700/5'
            }`}>
              <Eye size={9} />
              DATA: {agent.risk.dataExposure.toUpperCase()}
            </div>
          </div>

          {/* Failure Impact */}
          <div className="border border-gray-800/50 rounded p-2 bg-black/30">
            <div className="text-[8px] font-mono text-gray-600 uppercase tracking-wider mb-1">Failure Impact</div>
            <div className={`text-[9px] font-mono ${
              agent.risk.level === 'critical' ? 'text-red-400' : 'text-gray-400'
            }`}>
              {agent.risk.failureImpact}
            </div>
          </div>
        </div>
      )}

      {/* ── Expanded: Capabilities ── */}
      {activeSection === 'capabilities' && (
        <div className="px-4 pb-3 border-t border-gray-800/50 pt-3">
          <div className="space-y-1">
            {agent.capabilities.map((cap, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-btc-orange/50 mt-1.5 flex-shrink-0" />
                <span className="text-[9px] font-mono text-gray-500">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Eval Results ── */}
      {(activeSection === 'eval' || evalData) && evalData && (
        <div className="px-4 pb-4 border-t border-gray-800/50 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Evaluation Results</span>
            <div className={`text-[9px] font-mono px-2 py-0.5 rounded border ${STATUS_COLORS[evalData.evaluation.status]}`}>
              {evalData.evaluation.score}% — {evalData.evaluation.status.toUpperCase()}
            </div>
          </div>
          <div className="space-y-1.5">
            {evalData.evaluation.results.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                {r.passed
                  ? <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                  : <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                }
                <span className="text-[9px] font-mono text-gray-400 flex-1">{r.check}</span>
                <span className={`text-[8px] font-mono ${r.passed ? 'text-green-400/60' : 'text-red-400/60'}`}>
                  {r.detail}
                </span>
              </div>
            ))}
          </div>
          <div className="text-[8px] font-mono text-gray-700 mt-2">
            Evaluated {new Date(evalData.evaluation.evaluatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Agents({ user }: { user: any }) {
  const [data, setData] = useState<AgentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/agents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Compute aggregate risk stats
  const avgRisk = data ? (data.agents.reduce((sum, a) => sum + (a.risk?.score || 0), 0) / data.agents.length).toFixed(1) : '0';
  const criticalCount = data ? data.agents.filter(a => a.risk?.level === 'critical').length : 0;
  const publisherCount = data ? data.agents.filter(a => a.risk?.canPublish).length : 0;

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-mono text-gray-200 tracking-tight flex items-center gap-2">
            <Brain className="w-4 h-4 text-btc-orange" />
            Agent Control Center
          </h1>
          {data && (
            <p className="text-[10px] font-mono text-gray-600 mt-1">
              {data.healthy}/{data.total} agents operational — Last checked {new Date(data.checkedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-800 bg-gray-900 text-[10px] font-mono text-gray-400 hover:text-btc-orange hover:border-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Summary bar */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Agents</div>
            <div className="text-xl font-mono text-gray-200 mt-1">{data.total}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-500" /> Operational
            </div>
            <div className="text-xl font-mono text-green-400 mt-1">{data.healthy}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-yellow-500" /> Degraded
            </div>
            <div className="text-xl font-mono text-yellow-400 mt-1">{data.total - data.healthy}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <Target className="w-3 h-3 text-btc-orange" /> Avg Risk
            </div>
            <div className="text-xl font-mono text-btc-orange mt-1">{avgRisk}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <Zap className="w-3 h-3 text-red-500" /> Critical
            </div>
            <div className="text-xl font-mono text-red-400 mt-1">{criticalCount}</div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-red-900/50 rounded-lg p-4 bg-red-950/20 mb-6 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm font-mono text-red-400">{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-64 bg-gray-900/60 border border-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Agent cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* Footer */}
      {data && (
        <div className="mt-6 border border-gray-800 rounded-lg p-4 bg-gray-900/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[11px] font-mono text-gray-500 uppercase tracking-widest">Fleet Summary</h2>
              <p className="text-[9px] font-mono text-gray-700 mt-1">
                {data.total} agents registered — {publisherCount} can publish externally — {criticalCount} at critical risk level.
                Click &quot;Profile&quot; for strengths/weaknesses, &quot;Risk Intel&quot; for threat parameters, or &quot;Run Eval&quot; to check live status.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
