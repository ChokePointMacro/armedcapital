'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, ChevronDown, ChevronUp, AlertTriangle, Activity, TrendingUp, TrendingDown, Minus, Shield, Zap, Clock, DollarSign, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { BackButton } from './BackButton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TickerItem { symbol: string; price: number; change: number; changePercent: number; }

interface SignalValue { value: number; signal: string; }
interface AnswerSignal { answer: string; signal: string; }
interface WeightEntry { weight: number; label: string; }

interface TerminalData {
  ticker: TickerItem[];
  decision: { shouldTrade: boolean; score: number; label: string };
  volatility: {
    score: number; vixLevel: number; vixTrend: string; vixTrendSignal: string;
    vixIvPercentile: number; vixIvSignal: string; putCallRatio: number; putCallSignal: string;
  };
  trend: {
    score: number; spxVs20d: SignalValue; spxVs50d: SignalValue; spxVs200d: SignalValue;
    qqqTrend: string; regime: string;
  };
  breadth: {
    score: number; pctAbove50d: number; pctAbove50dSignal: string;
    pctAbove200d: number; pctAbove200dSignal: string;
    nyseAd: number; nyseAdSignal: string; newHighsLows: string; newHighsLowsSignal: string;
  };
  momentum: {
    score: number; sectorsPositive: number; sectorsTotal: number; sectorsSignal: string;
    leader: { name: string; change: number }; laggard: { name: string; change: number };
    participation: string;
  };
  macro: {
    score: number; fomc: string; fomcSignal: string; tenYearYield: number; tenYearSignal: string;
    dxy: number; dxySignal: string; fedStance: string; geopolitical: string;
  };
  oil: {
    score: number; price: number | null; change: number | null;
    priceSignal: string; inflationImpact: string; trendSignal: string;
  };
  crypto: {
    score: number; btcPrice: number | null; btcChange: number | null;
    btcDominance: number | null; sentiment: string; dominanceSignal: string;
  };
  executionWindow: {
    score: number;
    breakoutsWorking: AnswerSignal; leadersHolding: AnswerSignal;
    pullbacksBought: AnswerSignal; followThrough: AnswerSignal;
  };
  sectors: { name: string; symbol: string; change: number }[];
  scoringWeights: Record<string, WeightEntry>;
  updatedAt: string;
}

// ─── Execution Report Types ──────────────────────────────────────────────────

interface ReportVector {
  metric: string;
  value: number;
  raw: string;
  signal: 'green' | 'yellow' | 'red';
  detail: string;
}

interface AgentReport {
  id: string;
  name: string;
  role: string;
  category: string;
  riskTier: string;
  overallScore: number;
  status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'IDLE';
  vectors: ReportVector[];
  lastRun: string | null;
  runsLast24h: number;
  successRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
}

interface ExecutionReport {
  platformScore: number;
  summary: {
    operational: number;
    degraded: number;
    down: number;
    idle: number;
    totalAgents: number;
    totalRuns24h: number;
    totalCost24h: number;
    avgSuccessRate: number;
  };
  agents: AgentReport[];
  evaluatedAt: string;
}

// ─── Directional Bias Engine ─────────────────────────────────────────────────

interface DirectionalBias {
  direction: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number; // 0-100
  label: string;
  reasoning: string;
  positionSize: string;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
}

function computeDirectionalBias(data: TerminalData): DirectionalBias {
  const { decision, volatility, trend, breadth, momentum, macro, oil, crypto, executionWindow } = data;
  const longScore = decision.score;
  // Short score: invert directional components, keep macro/oil/crypto as-is
  const shortScore = Math.round(
    (100 - volatility.score) * 0.15 +
    (100 - trend.score) * 0.20 +
    (100 - breadth.score) * 0.16 +
    (100 - momentum.score) * 0.16 +
    macro.score * 0.13 +
    (100 - (oil?.score ?? 50)) * 0.10 +
    (100 - (crypto?.score ?? 50)) * 0.10
  );

  const spread = longScore - shortScore;
  const absBias = Math.abs(spread);

  // Determine direction
  let direction: 'LONG' | 'SHORT' | 'FLAT';
  let activeScore: number;

  if (absBias < 10) {
    direction = 'FLAT';
    activeScore = Math.max(longScore, shortScore);
  } else if (spread > 0) {
    direction = 'LONG';
    activeScore = longScore;
  } else {
    direction = 'SHORT';
    activeScore = shortScore;
  }

  // Confidence: based on score magnitude + spread clarity
  const scoreStrength = Math.abs(activeScore - 50) / 50; // 0-1 how far from neutral
  const spreadClarity = Math.min(absBias / 40, 1); // 0-1 how clear the directional signal
  const confidence = Math.round(Math.min(100, (scoreStrength * 60 + spreadClarity * 40)));

  // Risk level from VIX + execution window
  let riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  if (volatility.vixLevel > 30 || volatility.vixIvPercentile > 85) riskLevel = 'EXTREME';
  else if (volatility.vixLevel > 22 || executionWindow.score < 30) riskLevel = 'HIGH';
  else if (volatility.vixLevel > 18 || executionWindow.score < 50) riskLevel = 'MODERATE';
  else riskLevel = 'LOW';

  // Position sizing
  let positionSize: string;
  if (direction === 'FLAT') {
    positionSize = '0%';
  } else if (confidence >= 75 && riskLevel !== 'EXTREME') {
    positionSize = '100%';
  } else if (confidence >= 60 && riskLevel !== 'EXTREME') {
    positionSize = '75%';
  } else if (confidence >= 45) {
    positionSize = '50%';
  } else if (confidence >= 30) {
    positionSize = '25%';
  } else {
    positionSize = '0%';
  }

  // Build reasoning
  const reasons: string[] = [];
  if (direction === 'LONG') {
    if (trend.score >= 70) reasons.push('Strong uptrend structure');
    else if (trend.score >= 50) reasons.push('Trend intact');
    else reasons.push('Trend weakening — counter-trend risk');
    if (breadth.pctAbove50d >= 70) reasons.push('Broad participation');
    else if (breadth.pctAbove50d < 40) reasons.push('Narrow breadth — selective only');
    if (momentum.sectorsPositive >= 8) reasons.push('Strong sector momentum');
    if (volatility.vixLevel > 25) reasons.push('Elevated VIX — expect chop');
    if (crypto?.score >= 65) reasons.push('Crypto risk-on supports longs');
    if (oil?.score >= 60) reasons.push('Oil at goldilocks levels');
    else if (oil?.score <= 35) reasons.push('Oil stress — inflation or demand concern');
  } else if (direction === 'SHORT') {
    if (trend.score <= 30) reasons.push('Broken trend — selling pressure dominant');
    else if (trend.score <= 50) reasons.push('Weakening trend structure');
    if (breadth.pctAbove50d < 35) reasons.push('Breadth collapsing');
    if (momentum.sectorsPositive <= 3) reasons.push('Broad sector weakness');
    if (volatility.vixLevel > 25) reasons.push('Elevated VIX confirms fear');
    if (volatility.vixTrend === 'Rising') reasons.push('VIX trending higher');
    if (crypto?.score <= 35) reasons.push('Crypto risk-off confirms bearish sentiment');
    if (oil?.trendSignal === 'spiking') reasons.push('Oil spike adding inflation pressure');
  } else {
    reasons.push('No clear directional edge');
    if (absBias < 5) reasons.push('Long and short signals cancelling out');
    reasons.push('Wait for clarity before committing');
  }

  // Label
  let label: string;
  if (direction === 'FLAT') {
    label = 'STAY FLAT — No Edge';
  } else if (confidence >= 70) {
    label = `HIGH CONVICTION ${direction}`;
  } else if (confidence >= 45) {
    label = `${direction} BIAS — Moderate Conviction`;
  } else {
    label = `WEAK ${direction} LEAN — Low Conviction`;
  }

  return { direction, confidence, label, reasoning: reasons.join(' · '), positionSize, riskLevel };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signalColor(signal: string): string {
  const s = signal.toLowerCase();
  if (['strong', 'positive', 'intact', 'good', 'working', 'holding', 'support', 'conviction', 'low', 'falling', 'uptrend', 'broad'].includes(s))
    return 'text-emerald-400';
  if (['neutral', 'normal', 'moderate', 'stable', 'caution', 'correcting'].includes(s))
    return 'text-amber-400';
  return 'text-red-400';
}

function signalDot(signal: string): string {
  const s = signal.toLowerCase();
  if (['strong', 'positive', 'intact', 'good', 'working', 'holding', 'support', 'conviction', 'low', 'falling', 'uptrend', 'broad'].includes(s))
    return 'bg-emerald-400';
  if (['neutral', 'normal', 'moderate', 'stable', 'caution', 'correcting'].includes(s))
    return 'bg-amber-400';
  return 'bg-red-400';
}

function scoreBorderColor(score: number): string {
  if (score >= 60) return 'border-emerald-500/20';
  if (score >= 40) return 'border-amber-500/20';
  return 'border-red-500/20';
}

function scoreGlowColor(score: number): string {
  if (score >= 60) return 'rgba(16,185,129,0.15)';
  if (score >= 40) return 'rgba(245,158,11,0.15)';
  return 'rgba(239,68,68,0.15)';
}

function scoreStrokeColor(score: number): string {
  if (score >= 60) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function directionColor(dir: 'LONG' | 'SHORT' | 'FLAT'): string {
  if (dir === 'LONG') return '#10b981';
  if (dir === 'SHORT') return '#ef4444';
  return '#f59e0b';
}

function riskColor(risk: string): string {
  if (risk === 'LOW') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (risk === 'MODERATE') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  if (risk === 'HIGH') return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

// ─── SVG Circle Gauge ─────────────────────────────────────────────────────────

const CircleGauge = ({ score, size = 80, strokeWidth = 6, label, color }: { score: number; size?: number; strokeWidth?: number; label?: string; color?: string }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const strokeColor = color || scoreStrokeColor(score);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1f1f1f" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-bold text-white" style={{ fontSize: size * 0.28 }}>{score}</span>
        {label && <span className="font-mono text-gray-500 uppercase" style={{ fontSize: size * 0.11 }}>{label}</span>}
      </div>
    </div>
  );
};

// ─── Mini Gauge Card ──────────────────────────────────────────────────────────

const GaugeCard = ({ title, score }: { title: string; score: number }) => (
  <div className={cn('border rounded px-3 py-2 bg-[#0d0d0d] flex flex-col items-center gap-1', scoreBorderColor(score))}>
    <span className="font-mono text-[8px] uppercase tracking-widest text-gray-500">{title}</span>
    <CircleGauge score={score} size={52} strokeWidth={4} />
  </div>
);

// ─── Detail Panel ─────────────────────────────────────────────────────────────

const DetailPanel = ({ title, score, children }: { title: string; score: number; children: React.ReactNode }) => (
  <div
    className={cn('border rounded bg-[#0d0d0d] overflow-hidden', scoreBorderColor(score))}
    style={{ boxShadow: `0 0 20px ${scoreGlowColor(score)}` }}
  >
    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
      <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400">{title}</span>
      <span
        className="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
        style={{ color: scoreStrokeColor(score), backgroundColor: `${scoreStrokeColor(score)}15` }}
      >
        {score}/100
      </span>
    </div>
    <div className="px-3 py-2 space-y-1.5">{children}</div>
  </div>
);

// ─── Line Item ────────────────────────────────────────────────────────────────

const LineItem = ({ label, value, signal }: { label: string; value: string | number; signal?: string }) => (
  <div className="flex items-center justify-between font-mono text-[10px]">
    <span className="text-gray-500 uppercase">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-gray-300">{value}</span>
      {signal && (
        <div className="flex items-center gap-1">
          <div className={cn('w-1.5 h-1.5 rounded-full', signalDot(signal))} />
          <span className={cn('text-[9px] uppercase', signalColor(signal))}>{signal}</span>
        </div>
      )}
    </div>
  </div>
);

// ─── Sector Bar ───────────────────────────────────────────────────────────────

const SectorBar = ({ name, change, maxAbs }: { name: string; change: number; maxAbs: number }) => {
  const pct = maxAbs > 0 ? Math.abs(change) / maxAbs * 100 : 0;
  const isPos = change >= 0;
  return (
    <div className="flex items-center gap-2 font-mono text-[9px]">
      <span className="w-20 text-gray-500 uppercase text-right shrink-0">{name}</span>
      <div className="flex-1 h-3 bg-[#111] rounded-sm relative overflow-hidden">
        {isPos ? (
          <div className="absolute left-1/2 h-full rounded-sm" style={{ width: `${pct / 2}%`, background: 'linear-gradient(90deg, #10b981, #059669)' }} />
        ) : (
          <div className="absolute h-full rounded-sm" style={{ width: `${pct / 2}%`, right: '50%', background: 'linear-gradient(270deg, #ef4444, #991b1b)' }} />
        )}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
      </div>
      <span className={cn('w-12 text-right', isPos ? 'text-emerald-400' : 'text-red-400')}>
        {isPos ? '+' : ''}{change.toFixed(2)}%
      </span>
    </div>
  );
};

// ─── Weight Bar ───────────────────────────────────────────────────────────────

const WeightBar = ({ label, value, max }: { label: string; value: number; max: number }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 font-mono text-[9px]">
      <span className="w-16 text-gray-500 uppercase shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-[#111] rounded-sm overflow-hidden">
        <div
          className="h-full rounded-sm"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #f7931a, #f59e0b)' }}
        />
      </div>
      <span className="w-8 text-right text-btc-orange">+{value}</span>
    </div>
  );
};

// ─── Direction Icon ───────────────────────────────────────────────────────────

const DirectionIcon = ({ direction, size = 18 }: { direction: 'LONG' | 'SHORT' | 'FLAT'; size?: number }) => {
  if (direction === 'LONG') return <TrendingUp size={size} className="text-emerald-400" />;
  if (direction === 'SHORT') return <TrendingDown size={size} className="text-red-400" />;
  return <Minus size={size} className="text-amber-400" />;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const Terminal = () => {
  const [data, setData] = useState<TerminalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [execReport, setExecReport] = useState<ExecutionReport | null>(null);
  const [execExpanded, setExecExpanded] = useState<string | null>(null);

  const fetchExecReport = useCallback(async () => {
    try {
      const res = await apiFetch('/api/terminal/execution');
      if (res.ok) setExecReport(await res.json());
    } catch { /* non-critical */ }
  }, []);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/terminal');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchAnalysis = useCallback(async () => {
    if (analysis) return;
    setAnalysisLoading(true);
    try {
      const res = await apiFetch('/api/terminal/analysis');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAnalysis(json.text);
    } catch {
      setAnalysis('Failed to load analysis.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [analysis]);

  useEffect(() => {
    fetchData();
    fetchExecReport();
    const interval = setInterval(() => { fetchData(true); fetchExecReport(); }, 60000);
    return () => clearInterval(interval);
  }, [fetchData, fetchExecReport]);

  useEffect(() => {
    if (analysisOpen && !analysis && !analysisLoading) fetchAnalysis();
  }, [analysisOpen, analysis, analysisLoading, fetchAnalysis]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-btc-orange" size={28} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Loading Terminal Data...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="text-red-400" size={28} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-red-400">Terminal Error</span>
          <span className="font-mono text-[9px] text-gray-500 max-w-xs">{error || 'No data available'}</span>
          <button onClick={() => fetchData()} className="mt-2 px-4 py-1.5 border border-btc-orange/30 text-btc-orange font-mono text-[9px] uppercase tracking-widest hover:bg-btc-orange/10 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const d = data;
  const bias = computeDirectionalBias(d);
  const maxSectorAbs = Math.max(...d.sectors.map(s => Math.abs(s.change)), 0.01);
  const biasColor = directionColor(bias.direction);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BackButton />
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="font-mono text-[8px] text-gray-600 uppercase">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-btc-orange/20 text-btc-orange/70 font-mono text-[9px] uppercase tracking-widest hover:bg-btc-orange/10 transition-colors disabled:opacity-30"
          >
            <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="flex items-center gap-3 mb-2">
        <Activity size={16} className="text-btc-orange" />
        <h1 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-white">Market Quality Terminal</h1>
        <div className="flex-1 border-t border-btc-orange/10" />
        <span className={cn('font-mono text-[9px] font-bold uppercase tracking-widest px-3 py-1 rounded border', riskColor(bias.riskLevel))}>
          Risk: {bias.riskLevel}
        </span>
      </div>

      {/* A. Ticker Bar */}
      <div className="flex gap-4 overflow-x-auto py-2 px-3 bg-[#0d0d0d] border border-white/5 rounded scrollbar-none">
        {d.ticker.map(t => (
          <div key={t.symbol} className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
            <span className="text-gray-500 font-bold">{t.symbol}</span>
            <span className="text-white">{t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className={t.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {t.changePercent >= 0 ? '+' : ''}{(t.changePercent * 100).toFixed(2)}%
            </span>
            <div className="w-px h-3 bg-white/10" />
          </div>
        ))}
      </div>

      {/* B. Directional Bias Decision Box */}
      <div
        className="border rounded p-6 bg-[#0d0d0d] grid grid-cols-[auto_1fr_auto] gap-6 items-center"
        style={{
          borderColor: `${biasColor}30`,
          boxShadow: `0 0 40px ${biasColor}15`,
        }}
      >
        {/* Left: Confidence gauge */}
        <div className="flex flex-col items-center gap-2">
          <CircleGauge score={bias.confidence} size={110} strokeWidth={8} label="CONFID" color={biasColor} />
        </div>

        {/* Center: Direction + reasoning */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <DirectionIcon direction={bias.direction} size={28} />
            <span
              className="font-mono text-3xl font-black uppercase tracking-wider"
              style={{ color: biasColor, textShadow: `0 0 20px ${biasColor}40` }}
            >
              {bias.direction === 'FLAT' ? 'STAY FLAT' : `GO ${bias.direction}`}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: biasColor }}>
            {bias.label}
          </span>
          <span className="font-mono text-[10px] text-gray-500 leading-relaxed mt-1">
            {bias.reasoning}
          </span>
        </div>

        {/* Right: Position size + market score */}
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-[8px] uppercase tracking-widest text-gray-600">Position Size</span>
            <span className="font-mono text-2xl font-bold text-white">{bias.positionSize}</span>
            <span className="font-mono text-[8px] text-gray-600 uppercase">of normal</span>
          </div>
          <div className="flex flex-col items-end gap-1 pt-2 border-t border-white/5">
            <span className="font-mono text-[8px] uppercase tracking-widest text-gray-600">Market Score</span>
            <span className="font-mono text-lg font-bold" style={{ color: scoreStrokeColor(d.decision.score) }}>
              {d.decision.score}<span className="text-[10px] text-gray-600">/100</span>
            </span>
          </div>
        </div>
      </div>

      {/* C. Gauge Row */}
      <div className="flex gap-2 flex-wrap justify-center">
        <GaugeCard title="Volatility" score={d.volatility.score} />
        <GaugeCard title="Trend" score={d.trend.score} />
        <GaugeCard title="Breadth" score={d.breadth.score} />
        <GaugeCard title="Momentum" score={d.momentum.score} />
        <GaugeCard title="Macro" score={d.macro.score} />
        <GaugeCard title="Oil" score={d.oil?.score ?? 50} />
        <GaugeCard title="Crypto" score={d.crypto?.score ?? 50} />
        <GaugeCard title="Execution" score={execReport?.platformScore ?? d.executionWindow.score} />
      </div>

      {/* D. Alert Banner */}
      {(d.macro.fomcSignal === 'event-risk' || d.macro.fomcSignal === 'caution') && (
        <div className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded font-mono text-[10px] uppercase tracking-widest border',
          d.macro.fomcSignal === 'event-risk'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
        )}>
          <AlertTriangle size={14} />
          <span className="font-bold">FOMC: {d.macro.fomc}</span>
          <span className="text-gray-500">|</span>
          <span>Expect elevated volatility — reduce position sizes</span>
        </div>
      )}

      {/* E. Detail Panels (2x3 grid) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* Volatility */}
        <DetailPanel title="Volatility" score={d.volatility.score}>
          <LineItem label="VIX Level" value={d.volatility.vixLevel} signal={d.volatility.vixLevel > 25 ? 'elevated' : d.volatility.vixLevel > 20 ? 'normal' : 'low'} />
          <LineItem label="VIX Trend" value={d.volatility.vixTrend} signal={d.volatility.vixTrendSignal} />
          <LineItem label="IV Percentile" value={`${d.volatility.vixIvPercentile}%`} signal={d.volatility.vixIvSignal} />
          <LineItem label="Put/Call Ratio" value={d.volatility.putCallRatio} signal={d.volatility.putCallSignal} />
        </DetailPanel>

        {/* Trend */}
        <DetailPanel title="Trend" score={d.trend.score}>
          <LineItem label="SPX vs 20d MA" value={`${d.trend.spxVs20d.value > 0 ? '+' : ''}${d.trend.spxVs20d.value}%`} signal={d.trend.spxVs20d.signal} />
          <LineItem label="SPX vs 50d MA" value={`${d.trend.spxVs50d.value > 0 ? '+' : ''}${d.trend.spxVs50d.value}%`} signal={d.trend.spxVs50d.signal} />
          <LineItem label="SPX vs 200d MA" value={`${d.trend.spxVs200d.value > 0 ? '+' : ''}${d.trend.spxVs200d.value}%`} signal={d.trend.spxVs200d.signal} />
          <LineItem label="QQQ Trend" value={d.trend.qqqTrend} signal={d.trend.qqqTrend} />
          <LineItem label="Regime" value={d.trend.regime} signal={d.trend.regime} />
        </DetailPanel>

        {/* Breadth */}
        <DetailPanel title="Breadth" score={d.breadth.score}>
          <LineItem label="% Above 50d MA" value={`${d.breadth.pctAbove50d}%`} signal={d.breadth.pctAbove50dSignal} />
          <LineItem label="% Above 200d MA" value={`${d.breadth.pctAbove200d}%`} signal={d.breadth.pctAbove200dSignal} />
          <LineItem label="NYSE A/D" value={d.breadth.nyseAd > 0 ? `+${d.breadth.nyseAd}` : d.breadth.nyseAd} signal={d.breadth.nyseAdSignal} />
          <LineItem label="New Highs/Lows" value={d.breadth.newHighsLows} signal={d.breadth.newHighsLowsSignal} />
        </DetailPanel>

        {/* Momentum */}
        <DetailPanel title="Momentum" score={d.momentum.score}>
          <LineItem label="Sectors Positive" value={`${d.momentum.sectorsPositive}/${d.momentum.sectorsTotal}`} signal={d.momentum.sectorsSignal} />
          <LineItem label="Leader" value={`${d.momentum.leader.name} (${d.momentum.leader.change > 0 ? '+' : ''}${d.momentum.leader.change}%)`} signal="positive" />
          <LineItem label="Laggard" value={`${d.momentum.laggard.name} (${d.momentum.laggard.change > 0 ? '+' : ''}${d.momentum.laggard.change}%)`} signal="negative" />
          <LineItem label="Participation" value={d.momentum.participation} signal={d.momentum.participation === 'broad' ? 'strong' : d.momentum.participation === 'moderate' ? 'neutral' : 'weak'} />
        </DetailPanel>

        {/* Macro */}
        <DetailPanel title="Macro" score={d.macro.score}>
          <LineItem label="FOMC" value={d.macro.fomc} signal={d.macro.fomcSignal} />
          <LineItem label="10Y Yield" value={`${d.macro.tenYearYield}%`} signal={d.macro.tenYearSignal} />
          <LineItem label="DXY" value={d.macro.dxy} signal={d.macro.dxySignal} />
          <LineItem label="Fed Stance" value={d.macro.fedStance} />
          <LineItem label="Geopolitical" value={d.macro.geopolitical} signal="caution" />
        </DetailPanel>

        {/* Oil */}
        {d.oil && (
          <DetailPanel title="Oil (WTI)" score={d.oil.score}>
            <LineItem label="WTI Price" value={d.oil.price != null ? `$${d.oil.price}` : 'N/A'} signal={d.oil.priceSignal} />
            <LineItem label="Daily Change" value={d.oil.change != null ? `${d.oil.change > 0 ? '+' : ''}${d.oil.change}%` : 'N/A'} signal={d.oil.trendSignal} />
            <LineItem label="Inflation Impact" value={d.oil.inflationImpact} signal={d.oil.inflationImpact === 'high' ? 'elevated' : d.oil.inflationImpact === 'moderate' ? 'normal' : 'low'} />
            <LineItem label="Trend" value={d.oil.trendSignal} signal={d.oil.trendSignal === 'spiking' ? 'elevated' : d.oil.trendSignal === 'crashing' ? 'negative' : d.oil.trendSignal === 'falling' ? 'caution' : 'normal'} />
          </DetailPanel>
        )}

        {/* Crypto */}
        {d.crypto && (
          <DetailPanel title="Crypto (BTC)" score={d.crypto.score}>
            <LineItem label="BTC Price" value={d.crypto.btcPrice != null ? `$${d.crypto.btcPrice.toLocaleString()}` : 'N/A'} signal={d.crypto.sentiment} />
            <LineItem label="24h Change" value={d.crypto.btcChange != null ? `${d.crypto.btcChange > 0 ? '+' : ''}${d.crypto.btcChange}%` : 'N/A'} signal={d.crypto.sentiment} />
            <LineItem label="BTC Dominance" value={d.crypto.btcDominance != null ? `${d.crypto.btcDominance}%` : 'N/A'} signal={d.crypto.dominanceSignal} />
            <LineItem label="Risk Sentiment" value={d.crypto.sentiment} signal={d.crypto.sentiment} />
          </DetailPanel>
        )}

        {/* Execution Window */}
        <DetailPanel title="Execution Window" score={d.executionWindow.score}>
          <LineItem label="Breakouts Working?" value={d.executionWindow.breakoutsWorking.answer} signal={d.executionWindow.breakoutsWorking.signal} />
          <LineItem label="Leaders Holding?" value={d.executionWindow.leadersHolding.answer} signal={d.executionWindow.leadersHolding.signal} />
          <LineItem label="Pullbacks Bought?" value={d.executionWindow.pullbacksBought.answer} signal={d.executionWindow.pullbacksBought.signal} />
          <LineItem label="Follow Through" value={d.executionWindow.followThrough.answer} signal={d.executionWindow.followThrough.signal} />
        </DetailPanel>
      </div>

      {/* F. Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Execution Summary */}
        <div className="border border-white/5 rounded bg-[#0d0d0d] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gray-500 mb-3">Execution Summary</div>
          <div className="space-y-2">
            {[
              { label: 'Breakouts', ...d.executionWindow.breakoutsWorking },
              { label: 'Leaders', ...d.executionWindow.leadersHolding },
              { label: 'Pullbacks', ...d.executionWindow.pullbacksBought },
              { label: 'Follow-Through', ...d.executionWindow.followThrough },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-gray-500 uppercase">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'px-2 py-0.5 rounded text-[8px] font-bold uppercase',
                    item.answer === 'Yes' || item.answer === 'Strong'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : item.answer === 'Weak'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-red-500/10 text-red-400'
                  )}>
                    {item.answer}
                  </span>
                  <span className={cn('text-[8px] uppercase', signalColor(item.signal))}>{item.signal}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sector Performance */}
        <div className="border border-white/5 rounded bg-[#0d0d0d] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gray-500 mb-3">Sector Performance</div>
          <div className="space-y-1">
            {d.sectors.map(s => (
              <SectorBar key={s.symbol} name={s.name} change={s.change} maxAbs={maxSectorAbs} />
            ))}
          </div>
        </div>

        {/* Scoring Weights */}
        <div className="border border-white/5 rounded bg-[#0d0d0d] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gray-500 mb-3">Scoring Breakdown</div>
          <div className="space-y-2">
            {Object.entries(d.scoringWeights).map(([key, w]) => (
              <WeightBar key={key} label={key} value={w.weight} max={25} />
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between font-mono">
            <span className="text-[9px] uppercase tracking-widest text-gray-500">Total Score</span>
            <span className="text-lg font-bold" style={{ color: scoreStrokeColor(d.decision.score) }}>
              {d.decision.score}<span className="text-[10px] text-gray-600">/100</span>
            </span>
          </div>
        </div>
      </div>

      {/* G. Agent Execution Report */}
      {execReport && (
        <div className="border border-white/5 rounded bg-[#0d0d0d] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-3">
              <Shield size={14} className="text-btc-orange" />
              <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400">Agent Execution Report</span>
              <span className="font-mono text-[9px] text-gray-600">
                {execReport.summary.totalRuns24h} runs / 24h
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {execReport.summary.operational > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[8px] text-emerald-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {execReport.summary.operational}
                  </span>
                )}
                {execReport.summary.degraded > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[8px] text-amber-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    {execReport.summary.degraded}
                  </span>
                )}
                {execReport.summary.down > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[8px] text-red-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    {execReport.summary.down}
                  </span>
                )}
                {execReport.summary.idle > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[8px] text-gray-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                    {execReport.summary.idle}
                  </span>
                )}
              </div>
              <CircleGauge score={execReport.platformScore} size={36} strokeWidth={3} />
            </div>
          </div>

          {/* Agent Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-white/5">
            {execReport.agents.map(agent => {
              const isExpanded = execExpanded === agent.id;
              const statusColors: Record<string, string> = {
                OPERATIONAL: 'text-emerald-400 bg-emerald-500/10',
                DEGRADED: 'text-amber-400 bg-amber-500/10',
                DOWN: 'text-red-400 bg-red-500/10',
                IDLE: 'text-gray-500 bg-gray-500/10',
              };
              const statusDot: Record<string, string> = {
                OPERATIONAL: 'bg-emerald-400',
                DEGRADED: 'bg-amber-400',
                DOWN: 'bg-red-400',
                IDLE: 'bg-gray-500',
              };
              return (
                <div key={agent.id} className="flex flex-col">
                  <button
                    onClick={() => setExecExpanded(isExpanded ? null : agent.id)}
                    className="px-3 py-3 hover:bg-white/[0.02] transition-colors text-left"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-1.5 h-1.5 rounded-full', agent.status === 'OPERATIONAL' ? 'animate-pulse' : '', statusDot[agent.status])} />
                        <span className="font-mono text-[10px] font-bold text-gray-200 uppercase">{agent.name}</span>
                      </div>
                      <span className={cn('font-mono text-[7px] px-1.5 py-0.5 rounded uppercase font-bold', statusColors[agent.status])}>
                        {agent.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[8px] text-gray-600 leading-tight">{agent.role.slice(0, 35)}</span>
                      <CircleGauge score={agent.overallScore} size={32} strokeWidth={3} />
                    </div>
                    {/* Mini vector bars */}
                    <div className="mt-2 space-y-1">
                      {agent.vectors.map(v => (
                        <div key={v.metric} className="flex items-center gap-1.5">
                          <span className="font-mono text-[7px] text-gray-600 w-14 shrink-0 uppercase">{v.metric.slice(0, 10)}</span>
                          <div className="flex-1 h-1.5 bg-[#111] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${v.value}%`,
                                background: v.signal === 'green' ? '#10b981' : v.signal === 'yellow' ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                          <span className="font-mono text-[7px] text-gray-500 w-6 text-right">{v.value}</span>
                        </div>
                      ))}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-white/5 bg-[#080808]">
                      <div className="pt-2 space-y-1.5">
                        {agent.vectors.map(v => (
                          <div key={v.metric} className="flex items-center justify-between font-mono text-[9px]">
                            <span className="text-gray-500 uppercase">{v.metric}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">{v.raw}</span>
                              <div className={cn('w-1.5 h-1.5 rounded-full',
                                v.signal === 'green' ? 'bg-emerald-400' : v.signal === 'yellow' ? 'bg-amber-400' : 'bg-red-400'
                              )} />
                            </div>
                          </div>
                        ))}
                        <div className="pt-1.5 mt-1.5 border-t border-white/5 space-y-1">
                          <div className="flex justify-between font-mono text-[8px]">
                            <span className="text-gray-600">RUNS 24H</span>
                            <span className="text-gray-400">{agent.runsLast24h}</span>
                          </div>
                          <div className="flex justify-between font-mono text-[8px]">
                            <span className="text-gray-600">AVG LATENCY</span>
                            <span className="text-gray-400">{agent.avgLatencyMs > 0 ? `${agent.avgLatencyMs}ms` : 'N/A'}</span>
                          </div>
                          <div className="flex justify-between font-mono text-[8px]">
                            <span className="text-gray-600">COST 24H</span>
                            <span className="text-gray-400">${agent.totalCostUsd.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between font-mono text-[8px]">
                            <span className="text-gray-600">RISK TIER</span>
                            <span className={cn('uppercase',
                              agent.riskTier === 'LOW' ? 'text-emerald-400' :
                              agent.riskTier === 'MEDIUM' ? 'text-amber-400' :
                              agent.riskTier === 'HIGH' ? 'text-orange-400' : 'text-red-400'
                            )}>{agent.riskTier}</span>
                          </div>
                          {agent.lastRun && (
                            <div className="flex justify-between font-mono text-[8px]">
                              <span className="text-gray-600">LAST RUN</span>
                              <span className="text-gray-400">{new Date(agent.lastRun).toLocaleTimeString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-[#080808]">
            <div className="flex items-center gap-4 font-mono text-[8px] text-gray-600">
              <span>SUCCESS RATE: <span className="text-gray-400">{execReport.summary.avgSuccessRate}%</span></span>
              <span>24H COST: <span className="text-gray-400">${execReport.summary.totalCost24h.toFixed(4)}</span></span>
              <span>AGENTS: <span className="text-gray-400">{execReport.summary.totalAgents}</span></span>
            </div>
            <span className="font-mono text-[7px] text-gray-600">
              Eval {new Date(execReport.evaluatedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* H. Terminal Analysis */}
      <div className="border border-white/5 rounded bg-[#0d0d0d] overflow-hidden">
        <button
          onClick={() => setAnalysisOpen(!analysisOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-btc-orange animate-pulse" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400">AI Terminal Analysis</span>
          </div>
          {analysisOpen ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </button>
        {analysisOpen && (
          <div className="px-4 pb-4 border-t border-white/5">
            {analysisLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="animate-spin text-btc-orange" size={14} />
                <span className="font-mono text-[10px] text-gray-500 uppercase">Generating analysis...</span>
              </div>
            ) : analysis ? (
              <div className="font-mono text-[11px] text-gray-400 leading-relaxed whitespace-pre-wrap pt-3">
                {analysis}
              </div>
            ) : (
              <span className="font-mono text-[10px] text-gray-600">No analysis available.</span>
            )}
          </div>
        )}
      </div>

      {/* Footer timestamp */}
      <div className="text-center font-mono text-[8px] text-gray-600 uppercase tracking-widest pb-4">
        Data as of {new Date(d.updatedAt).toLocaleString()} — Refreshes every 60s — Cached 5 min server-side
      </div>
    </div>
  );
};
