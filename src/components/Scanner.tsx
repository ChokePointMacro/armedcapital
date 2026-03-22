'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle,
  Target, Shield, Clock, Zap, BarChart3, Activity, ChevronDown, ChevronUp,
  Crosshair, Eye, Flame,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoringBreakdown {
  volatility: number;
  momentum: number;
  trend: number;
  breadth: number;
  macro: number;
}

interface Opportunity {
  rank: number;
  symbol: string;
  name: string;
  type: string;
  signal: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  conviction: number;
  entry: string;
  stopLoss: string;
  target: string;
  riskReward: string;
  thesis: string;
  catalyst: string;
  timeframe: string;
  riskScore: number;
  scoringBreakdown: ScoringBreakdown;
}

interface ScanResult {
  opportunities: Opportunity[];
  marketContext: string;
  scanMode: string;
  scannedAt: string;
  nextScanAt: string;
  instrumentsScanned: number;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SIGNAL_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  BREAKOUT:      { color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30', icon: <TrendingUp className="w-3 h-3" /> },
  MOMENTUM:      { color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30',   icon: <Zap className="w-3 h-3" /> },
  REVERSAL:      { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: <RefreshCw className="w-3 h-3" /> },
  DISLOCATION:   { color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30', icon: <AlertTriangle className="w-3 h-3" /> },
  UNUSUAL_FLOW:  { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', icon: <Flame className="w-3 h-3" /> },
  MACRO_CATALYST:{ color: 'text-cyan-400',   bg: 'bg-cyan-500/10 border-cyan-500/30',   icon: <Activity className="w-3 h-3" /> },
  MEAN_REVERSION:{ color: 'text-pink-400',   bg: 'bg-pink-500/10 border-pink-500/30',   icon: <Target className="w-3 h-3" /> },
  RELATIVE_VALUE:{ color: 'text-teal-400',   bg: 'bg-teal-500/10 border-teal-500/30',   icon: <BarChart3 className="w-3 h-3" /> },
};

function getSignalConfig(signal: string) {
  return SIGNAL_CONFIG[signal] || { color: 'text-gray-400', bg: 'bg-gray-500/10 border-gray-500/30', icon: <Eye className="w-3 h-3" /> };
}

function directionColor(d: string) {
  if (d === 'LONG') return 'text-green-400';
  if (d === 'SHORT') return 'text-red-400';
  return 'text-yellow-400';
}

function directionBg(d: string) {
  if (d === 'LONG') return 'bg-green-500/10 border-green-500/30';
  if (d === 'SHORT') return 'bg-red-500/10 border-red-500/30';
  return 'bg-yellow-500/10 border-yellow-500/30';
}

function directionIcon(d: string) {
  if (d === 'LONG') return <TrendingUp className="w-3.5 h-3.5" />;
  if (d === 'SHORT') return <TrendingDown className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
}

function convictionColor(c: number) {
  if (c >= 80) return 'text-green-400';
  if (c >= 60) return 'text-yellow-400';
  return 'text-orange-400';
}

function riskColor(r: number) {
  if (r <= 3) return 'text-green-400';
  if (r <= 6) return 'text-yellow-400';
  return 'text-red-400';
}

function typeColor(t: string) {
  switch (t) {
    case 'CRYPTO': return 'text-btc-orange';
    case 'EQUITY': return 'text-blue-400';
    case 'COMMODITY': return 'text-yellow-400';
    case 'MACRO': return 'text-purple-400';
    case 'INDEX': return 'text-cyan-400';
    default: return 'text-gray-400';
  }
}

function ScoreBar({ label, value, weight }: { label: string; value: number; weight: string }) {
  const color = value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-gray-500 uppercase w-16 text-right">{label} <span className="text-gray-700">({weight})</span></span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] font-mono text-gray-400 w-7 text-right">{value}</span>
    </div>
  );
}

// ── Opportunity Card ─────────────────────────────────────────────────────────

function OpportunityCard({ opp }: { opp: Opportunity }) {
  const [expanded, setExpanded] = useState(false);
  const signalCfg = getSignalConfig(opp.signal);

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/60 hover:border-gray-700 transition-all overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono font-bold text-gray-600">#{opp.rank}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold text-white">{opp.symbol}</span>
                <span className={`text-[10px] font-mono ${typeColor(opp.type)}`}>{opp.type}</span>
              </div>
              <span className="text-[10px] font-mono text-gray-500">{opp.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Conviction badge */}
            <div className="text-right">
              <div className={`text-lg font-mono font-bold ${convictionColor(opp.conviction)}`}>
                {opp.conviction}
              </div>
              <div className="text-[8px] font-mono text-gray-600 uppercase">conviction</div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-600" /> : <ChevronDown className="w-4 h-4 text-gray-600" />}
          </div>
        </div>

        {/* Tags row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Direction */}
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${directionColor(opp.direction)} ${directionBg(opp.direction)}`}>
            {directionIcon(opp.direction)} {opp.direction}
          </span>
          {/* Signal type */}
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono ${signalCfg.color} ${signalCfg.bg}`}>
            {signalCfg.icon} {opp.signal.replace(/_/g, ' ')}
          </span>
          {/* Timeframe */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-700 text-[10px] font-mono text-gray-400">
            <Clock className="w-3 h-3" /> {opp.timeframe}
          </span>
          {/* Risk */}
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-700 text-[10px] font-mono ${riskColor(opp.riskScore)}`}>
            <Shield className="w-3 h-3" /> Risk {opp.riskScore}/10
          </span>
        </div>

        {/* Thesis preview */}
        <p className="text-[11px] font-mono text-gray-400 mt-2 line-clamp-2 leading-relaxed">
          {opp.thesis}
        </p>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
          {/* Trade levels */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-black/40 rounded p-2.5 border border-gray-800">
              <div className="text-[9px] font-mono text-gray-600 uppercase mb-1 flex items-center gap-1">
                <Crosshair className="w-3 h-3 text-btc-orange" /> Entry
              </div>
              <div className="text-xs font-mono text-white">{opp.entry}</div>
            </div>
            <div className="bg-black/40 rounded p-2.5 border border-gray-800">
              <div className="text-[9px] font-mono text-gray-600 uppercase mb-1 flex items-center gap-1">
                <Shield className="w-3 h-3 text-red-400" /> Stop Loss
              </div>
              <div className="text-xs font-mono text-red-400">{opp.stopLoss}</div>
            </div>
            <div className="bg-black/40 rounded p-2.5 border border-gray-800">
              <div className="text-[9px] font-mono text-gray-600 uppercase mb-1 flex items-center gap-1">
                <Target className="w-3 h-3 text-green-400" /> Target
              </div>
              <div className="text-xs font-mono text-green-400">{opp.target}</div>
            </div>
          </div>

          {/* R:R */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-gray-500">Risk/Reward:</span>
            <span className="text-sm font-mono font-bold text-btc-orange">{opp.riskReward}</span>
          </div>

          {/* Thesis */}
          <div>
            <div className="text-[9px] font-mono text-gray-600 uppercase mb-1">Thesis</div>
            <p className="text-[11px] font-mono text-gray-300 leading-relaxed">{opp.thesis}</p>
          </div>

          {/* Catalyst */}
          <div>
            <div className="text-[9px] font-mono text-gray-600 uppercase mb-1">Catalyst</div>
            <p className="text-[11px] font-mono text-yellow-400/80 leading-relaxed">{opp.catalyst}</p>
          </div>

          {/* Scoring breakdown */}
          <div>
            <div className="text-[9px] font-mono text-gray-600 uppercase mb-2">Scoring Breakdown</div>
            <div className="space-y-1.5">
              <ScoreBar label="Vol" value={opp.scoringBreakdown.volatility} weight="19%" />
              <ScoreBar label="Mom" value={opp.scoringBreakdown.momentum} weight="15%" />
              <ScoreBar label="Trend" value={opp.scoringBreakdown.trend} weight="16%" />
              <ScoreBar label="Breadth" value={opp.scoringBreakdown.breadth} weight="14%" />
              <ScoreBar label="Macro" value={opp.scoringBreakdown.macro} weight="8%" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Scanner({ user }: { user: any }) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/scanner');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  // Countdown timer
  useEffect(() => {
    if (!data?.nextScanAt) return;
    const interval = setInterval(() => {
      const diff = new Date(data.nextScanAt).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('Scanning...');
        scan();
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setCountdown(`${mins}m ${secs.toString().padStart(2, '0')}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [data?.nextScanAt, scan]);

  const longs = data?.opportunities.filter(o => o.direction === 'LONG') || [];
  const shorts = data?.opportunities.filter(o => o.direction === 'SHORT' || o.direction === 'NEUTRAL') || [];

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-mono text-gray-200 tracking-tight flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-btc-orange" />
            Opportunity Scanner
          </h1>
          <p className="text-[10px] font-mono text-gray-600 mt-1">
            Full-spectrum scan — equities, crypto, commodities, macro
          </p>
        </div>
        <div className="flex items-center gap-3">
          {countdown && !loading && (
            <div className="text-[10px] font-mono text-gray-600 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Next scan: {countdown}
            </div>
          )}
          <button
            onClick={scan}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-800 bg-gray-900 text-[10px] font-mono text-gray-400 hover:text-btc-orange hover:border-gray-700 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {loading ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative">
            <Crosshair className="w-10 h-10 text-btc-orange animate-pulse" />
            <div className="absolute inset-0 w-10 h-10 border-2 border-btc-orange/30 rounded-full animate-ping" />
          </div>
          <div className="text-center">
            <p className="text-sm font-mono text-gray-400">Scanning markets...</p>
            <p className="text-[10px] font-mono text-gray-600 mt-1">Analyzing 17 instruments across equities, crypto, commodities & macro</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-red-900/50 rounded-lg p-4 bg-red-950/20 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm font-mono text-red-400">{error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Market context */}
          {data.marketContext && (
            <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-3.5 h-3.5 text-btc-orange" />
                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Market Context</span>
              </div>
              <p className="text-[11px] font-mono text-gray-300 leading-relaxed">{data.marketContext}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-[9px] font-mono text-gray-600">
                  {data.instrumentsScanned} instruments scanned
                </span>
                <span className="text-[9px] font-mono text-gray-600">
                  {data.opportunities.length} opportunities found
                </span>
                <span className="text-[9px] font-mono text-gray-600">
                  Scanned {new Date(data.scannedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase">Opportunities</div>
              <div className="text-xl font-mono text-white mt-1">{data.opportunities.length}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-green-500" /> Long Ideas
              </div>
              <div className="text-xl font-mono text-green-400 mt-1">{longs.length}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-red-500" /> Short / Neutral
              </div>
              <div className="text-xl font-mono text-red-400 mt-1">{shorts.length}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase flex items-center gap-1">
                <Zap className="w-3 h-3 text-btc-orange" /> Top Conviction
              </div>
              <div className="text-xl font-mono text-btc-orange mt-1">
                {data.opportunities[0]?.conviction || '—'}
              </div>
            </div>
          </div>

          {/* Opportunities grid */}
          <div className="space-y-3">
            {data.opportunities.map((opp) => (
              <OpportunityCard key={`${opp.symbol}-${opp.rank}`} opp={opp} />
            ))}
          </div>

          {/* Disclaimer */}
          <div className="mt-6 border border-gray-800/50 rounded-lg p-3 bg-gray-900/30">
            <p className="text-[9px] font-mono text-gray-600 leading-relaxed text-center">
              AI-generated analysis for informational purposes only. Not financial advice.
              Always do your own research and risk management before trading.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
