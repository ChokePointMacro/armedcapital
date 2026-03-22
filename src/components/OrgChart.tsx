'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronRight,
  Shield, Brain, Share2, BarChart3, Server, Target, DollarSign, Zap, Crosshair,
  TrendingUp, TrendingDown, Radio, Eye, Play, CheckCircle2, XCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

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
}

// ── Avatar Generator ────────────────────────────────────────────────────────
// Deterministic SVG avatars based on codename hash

const AVATAR_PALETTES: Record<string, { primary: string; secondary: string; accent: string; bg: string }> = {
  COMMANDER: { primary: '#f59e0b', secondary: '#d97706', accent: '#fbbf24', bg: '#451a03' },
  ANCHOR:    { primary: '#3b82f6', secondary: '#2563eb', accent: '#60a5fa', bg: '#172554' },
  VANGUARD:  { primary: '#ec4899', secondary: '#db2777', accent: '#f472b6', bg: '#500724' },
  CLOSER:    { primary: '#10b981', secondary: '#059669', accent: '#34d399', bg: '#022c22' },
  CATALYST:  { primary: '#8b5cf6', secondary: '#7c3aed', accent: '#a78bfa', bg: '#2e1065' },
  FORGE:     { primary: '#f97316', secondary: '#ea580c', accent: '#fb923c', bg: '#431407' },
  WATCHDOG:  { primary: '#06b6d4', secondary: '#0891b2', accent: '#22d3ee', bg: '#083344' },
  LEDGER:    { primary: '#84cc16', secondary: '#65a30d', accent: '#a3e635', bg: '#1a2e05' },
  VAULT:     { primary: '#14b8a6', secondary: '#0d9488', accent: '#2dd4bf', bg: '#042f2e' },
  APEX:      { primary: '#ef4444', secondary: '#dc2626', accent: '#f87171', bg: '#450a0a' },
  GUARDIAN:  { primary: '#6366f1', secondary: '#4f46e5', accent: '#818cf8', bg: '#1e1b4b' },
  BEACON:    { primary: '#f59e0b', secondary: '#d97706', accent: '#fcd34d', bg: '#451a03' },
  ARCHITECT: { primary: '#a855f7', secondary: '#9333ea', accent: '#c084fc', bg: '#3b0764' },
  BASTION:   { primary: '#64748b', secondary: '#475569', accent: '#94a3b8', bg: '#0f172a' },
  // Infra agents
  SENTINEL:  { primary: '#ef4444', secondary: '#b91c1c', accent: '#fca5a5', bg: '#450a0a' },
  ORACLE:    { primary: '#f97316', secondary: '#c2410c', accent: '#fdba74', bg: '#431407' },
  BROADCASTER: { primary: '#0ea5e9', secondary: '#0369a1', accent: '#7dd3fc', bg: '#0c4a6e' },
  SPECTRE:   { primary: '#22c55e', secondary: '#15803d', accent: '#86efac', bg: '#052e16' },
  MOSAIC:    { primary: '#eab308', secondary: '#a16207', accent: '#fde047', bg: '#422006' },
};

function AgentAvatar({ codename, size = 56 }: { codename: string; size?: number }) {
  const palette = AVATAR_PALETTES[codename] || { primary: '#f97316', secondary: '#ea580c', accent: '#fb923c', bg: '#1c1917' };
  const seed = codename.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);

  // Generate deterministic geometric pattern
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * 60 + seed) % 360;
    const r = 8 + (seed * (i + 1)) % 10;
    const x = 28 + Math.cos((angle * Math.PI) / 180) * r;
    const y = 28 + Math.sin((angle * Math.PI) / 180) * r;
    shapes.push({ x, y, r: 2 + (i % 3), angle });
  }

  return (
    <svg width={size} height={size} viewBox="0 0 56 56" className="rounded-lg flex-shrink-0">
      {/* Background */}
      <rect width="56" height="56" rx="8" fill={palette.bg} />
      {/* Outer ring */}
      <circle cx="28" cy="28" r="22" fill="none" stroke={palette.primary} strokeWidth="1.5" opacity="0.4" />
      <circle cx="28" cy="28" r="18" fill="none" stroke={palette.secondary} strokeWidth="0.5" opacity="0.3" />
      {/* Geometric pattern */}
      {shapes.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={i % 2 === 0 ? palette.primary : palette.accent} opacity={0.6 + (i * 0.05)} />
      ))}
      {/* Center diamond */}
      <rect x="23" y="23" width="10" height="10" rx="2" fill={palette.primary} opacity="0.9"
        transform={`rotate(45 28 28)`} />
      {/* Inner glow */}
      <circle cx="28" cy="28" r="6" fill={palette.accent} opacity="0.15" />
      {/* Initials */}
      <text x="28" y="31" textAnchor="middle" fill={palette.accent} fontSize="9" fontFamily="monospace" fontWeight="bold">
        {codename.slice(0, 2)}
      </text>
    </svg>
  );
}

// ── Org Hierarchy Definition ────────────────────────────────────────────────

interface OrgNode {
  agentId: string;
  children: string[];
}

const ORG_HIERARCHY: OrgNode[] = [
  // Top: Active Partner (COMMANDER) leads everything
  { agentId: 'active-partner', children: ['passive-partner', 'private-equity', 'asset-management', 'hr', 'it'] },
  // Passive Partner oversees investor relations
  { agentId: 'passive-partner', children: [] },
  // PE oversees deal flow
  { agentId: 'private-equity', children: [] },
  // Asset Management oversees portfolio
  { agentId: 'asset-management', children: ['market-scanner', 'data-enrichment'] },
  // HR oversees people/agents
  { agentId: 'hr', children: ['quality-control', 'cx'] },
  // IT oversees infra + engineering
  { agentId: 'it', children: ['engineer', 'dev', 'api-key-manager'] },
  // Middle management
  { agentId: 'engineer', children: [] },
  { agentId: 'dev', children: [] },
  // Operations (reports to COMMANDER directly)
  // Marketing + Sales are peer to peer, both report up
];

// Flat lookup for who reports to whom
const REPORTS_TO: Record<string, string> = {
  'passive-partner': 'active-partner',
  'private-equity': 'active-partner',
  'asset-management': 'active-partner',
  'hr': 'active-partner',
  'it': 'active-partner',
  'market-scanner': 'asset-management',
  'data-enrichment': 'asset-management',
  'quality-control': 'hr',
  'cx': 'hr',
  'engineer': 'it',
  'dev': 'it',
  'api-key-manager': 'it',
  'bookkeeping': 'active-partner',
  'marketing': 'active-partner',
  'sales': 'active-partner',
  'report-generator': 'active-partner',
  'auto-scheduler': 'marketing',
  'research-development': 'active-partner',
};

// Tier assignments for org chart layout
const TIER_MAP: Record<number, string[]> = {
  0: ['active-partner'],
  1: ['passive-partner', 'private-equity', 'asset-management', 'bookkeeping', 'report-generator', 'research-development'],
  2: ['marketing', 'sales', 'hr', 'it'],
  3: ['auto-scheduler', 'quality-control', 'cx', 'engineer', 'dev', 'api-key-manager'],
  4: ['market-scanner', 'data-enrichment'],
};

const TIER_LABELS = ['C-SUITE', 'SENIOR LEADERSHIP', 'DEPARTMENT HEADS', 'SPECIALISTS', 'FIELD OPERATIVES'];

// ── Agent Profile Card (expanded view) ──────────────────────────────────────

function ProfilePanel({ agent, onClose }: { agent: AgentDef; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-800 rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-gray-800">
          <div className="flex items-start gap-4">
            <AgentAvatar codename={agent.profile.codename} size={64} />
            <div className="flex-1">
              <div className="text-[10px] font-mono text-btc-orange tracking-widest uppercase">{agent.profile.codename}</div>
              <div className="text-base font-mono text-gray-200 mt-0.5">{agent.name}</div>
              <div className="text-[10px] font-mono text-gray-500 italic">{agent.profile.role}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                  agent.risk.level === 'critical' ? 'text-red-400 bg-red-400/10 border-red-400/30' :
                  agent.risk.level === 'high' ? 'text-orange-400 bg-orange-400/10 border-orange-400/30' :
                  agent.risk.level === 'medium' ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' :
                  'text-green-400 bg-green-400/10 border-green-400/30'
                }`}>
                  RISK {agent.risk.score}/10
                </div>
                <div className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-gray-700 text-gray-500">
                  v{agent.version}
                </div>
                <div className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                  agent.status === 'active' ? 'text-green-400 border-green-400/30' :
                  agent.status === 'draft' ? 'text-yellow-400 border-yellow-400/30' :
                  'text-gray-500 border-gray-600/30'
                }`}>
                  {agent.status.toUpperCase()}
                </div>
              </div>
            </div>
          </div>
          <p className="text-[10px] font-mono text-gray-500 leading-relaxed mt-3">{agent.description}</p>
        </div>

        {/* Strengths */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
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
        <div className="px-5 pt-2 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
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

        {/* Tendencies */}
        <div className="px-5 pt-2 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
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

        {/* Risk Intel */}
        <div className="px-5 pt-2 pb-3">
          <div className="text-[9px] font-mono text-gray-600 uppercase tracking-wider mb-2">Risk Intel</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600">Cost / Run</div>
              <div className="text-[10px] font-mono text-gray-300">{agent.risk.apiCostPerRun}</div>
            </div>
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600">Cooldown</div>
              <div className="text-[10px] font-mono text-gray-300">{agent.risk.cooldown}</div>
            </div>
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600">Rate Limit</div>
              <div className="text-[10px] font-mono text-gray-300">{agent.risk.rateLimitImpact}</div>
            </div>
            <div className="border border-gray-800/50 rounded p-2 bg-black/30">
              <div className="text-[8px] font-mono text-gray-600">Data Exposure</div>
              <div className="text-[10px] font-mono text-gray-300">{agent.risk.dataExposure}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
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
          </div>
        </div>

        {/* Data Flow + Cost */}
        <div className="px-5 pb-4 space-y-2">
          <div className="border border-gray-800/50 rounded p-2 bg-black/30">
            <div className="text-[8px] font-mono text-gray-600 uppercase mb-1">Data Flow</div>
            <div className="text-[9px] font-mono text-gray-400">{agent.profile.dataFlow}</div>
          </div>
          <div className="border border-gray-800/50 rounded p-2 bg-black/30">
            <div className="text-[8px] font-mono text-gray-600 uppercase mb-1">Failure Impact</div>
            <div className={`text-[9px] font-mono ${agent.risk.level === 'critical' ? 'text-red-400' : 'text-gray-400'}`}>
              {agent.risk.failureImpact}
            </div>
          </div>
        </div>

        {/* Dependencies */}
        <div className="px-5 pb-4 border-t border-gray-800 pt-3">
          <div className="text-[9px] font-mono text-gray-600 uppercase tracking-wider mb-2">Dependencies ({agent.depsConfigured}/{agent.depsTotal})</div>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${agent.depsHealthy ? 'bg-green-500' : 'bg-yellow-500'}`}
                style={{ width: `${agent.depsTotal > 0 ? (agent.depsConfigured / agent.depsTotal) * 100 : 0}%` }}
              />
            </div>
            <span className={`text-[9px] font-mono ${agent.depsHealthy ? 'text-green-400' : 'text-yellow-400'}`}>
              {agent.depsHealthy ? 'ALL SET' : `${agent.missingDeps.length} MISSING`}
            </span>
          </div>
          {agent.missingDeps.length > 0 && (
            <div className="text-[8px] font-mono text-yellow-400">
              Missing: {agent.missingDeps.join(', ')}
            </div>
          )}
        </div>

        {/* Close */}
        <div className="p-3 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="text-[9px] font-mono text-gray-500 hover:text-gray-300 px-3 py-1.5 border border-gray-800 rounded hover:border-gray-700 transition-colors"
          >
            CLOSE DOSSIER
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Org Node (mini card in chart) ───────────────────────────────────────────

function OrgNode({ agent, onClick }: { agent: AgentDef; onClick: () => void }) {
  const riskColor =
    agent.risk.level === 'critical' ? 'border-red-500/40' :
    agent.risk.level === 'high' ? 'border-orange-500/40' :
    agent.risk.level === 'medium' ? 'border-yellow-500/40' :
    'border-gray-700';

  return (
    <button
      onClick={onClick}
      className={`group border rounded-lg p-3 bg-gray-950/80 hover:bg-gray-900/80 transition-all cursor-pointer text-left w-44 ${riskColor} hover:border-btc-orange/50`}
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar codename={agent.profile.codename} size={40} />
        <div className="flex-1 min-w-0">
          <div className="text-[8px] font-mono text-btc-orange tracking-widest uppercase truncate">
            {agent.profile.codename}
          </div>
          <div className="text-[10px] font-mono text-gray-300 truncate">{agent.name}</div>
          <div className="text-[8px] font-mono text-gray-600 truncate">{agent.profile.role}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <div className={`w-1.5 h-1.5 rounded-full ${agent.depsHealthy ? 'bg-green-500' : 'bg-yellow-500'}`} />
        <span className={`text-[7px] font-mono uppercase tracking-wider ${
          agent.status === 'active' ? 'text-green-400/60' :
          agent.status === 'draft' ? 'text-yellow-400/60' : 'text-gray-600'
        }`}>
          {agent.status}
        </span>
        <span className="text-[7px] font-mono text-gray-700 ml-auto">
          R:{agent.risk.score}
        </span>
      </div>
    </button>
  );
}

// ── Main OrgChart Component ────────────────────────────────────────────────

export function OrgChart({ user }: { user: any }) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentDef | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/agents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAgents(json.agents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const agentMap = new Map(agents.map(a => [a.id, a]));

  // Filter to only employee agents (exclude the 5 infra agents for the org chart)
  const INFRA_IDS = new Set(['api-key-manager', 'report-generator', 'auto-scheduler', 'market-scanner', 'data-enrichment']);

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-mono text-gray-200 tracking-tight flex items-center gap-2">
            <Target className="w-4 h-4 text-btc-orange" />
            Armed Capital — Organizational Structure
          </h1>
          <p className="text-[10px] font-mono text-gray-600 mt-1">
            {agents.length} agents deployed — Click any node to view full dossier
          </p>
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

      {/* Error */}
      {error && (
        <div className="border border-red-900/50 rounded-lg p-4 bg-red-950/20 mb-6 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm font-mono text-red-400">{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && agents.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 text-btc-orange animate-spin" />
        </div>
      )}

      {/* Org Chart Tiers */}
      {agents.length > 0 && (
        <div className="space-y-8">
          {Object.entries(TIER_MAP).map(([tierIdx, agentIds]) => {
            const tierAgents = agentIds.map(id => agentMap.get(id)).filter(Boolean) as AgentDef[];
            if (tierAgents.length === 0) return null;

            return (
              <div key={tierIdx} className="relative">
                {/* Tier label */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-[8px] font-mono text-gray-700 uppercase tracking-[0.2em]">
                    {TIER_LABELS[Number(tierIdx)]}
                  </div>
                  <div className="flex-1 h-px bg-gray-800/50" />
                  <div className="text-[8px] font-mono text-gray-800">
                    TIER {Number(tierIdx) + 1}
                  </div>
                </div>

                {/* Connector lines (vertical) */}
                {Number(tierIdx) > 0 && (
                  <div className="absolute -top-4 left-1/2 w-px h-4 bg-gray-800/50" />
                )}

                {/* Agent nodes */}
                <div className="flex flex-wrap justify-center gap-4">
                  {tierAgents.map(agent => (
                    <div key={agent.id} className="relative">
                      <OrgNode agent={agent} onClick={() => setSelectedAgent(agent)} />
                      {/* Vertical connector down */}
                      {TIER_MAP[Number(tierIdx) + 1]?.some(childId =>
                        REPORTS_TO[childId] === agent.id
                      ) && (
                        <div className="absolute -bottom-4 left-1/2 w-px h-4 bg-gray-800/30" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {agents.length > 0 && (
        <div className="mt-10 border border-gray-800 rounded-lg p-4 bg-gray-900/60">
          <div className="text-[9px] font-mono text-gray-600 uppercase tracking-widest mb-3">Legend</div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-1.5 rounded bg-green-500" />
              <span className="text-[8px] font-mono text-gray-500">Active / Healthy</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-1.5 rounded bg-yellow-500" />
              <span className="text-[8px] font-mono text-gray-500">Draft / Degraded</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-3 rounded border border-red-500/40" />
              <span className="text-[8px] font-mono text-gray-500">Critical Risk</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-3 rounded border border-orange-500/40" />
              <span className="text-[8px] font-mono text-gray-500">High Risk</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-3 rounded border border-yellow-500/40" />
              <span className="text-[8px] font-mono text-gray-500">Medium Risk</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-3 rounded border border-gray-700" />
              <span className="text-[8px] font-mono text-gray-500">Low Risk</span>
            </div>
          </div>
        </div>
      )}

      {/* Profile modal */}
      {selectedAgent && (
        <ProfilePanel agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
