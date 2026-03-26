'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Loader2, Play, Pause, Square, TrendingUp, TrendingDown,
  Activity, DollarSign, Target, BarChart3, Settings, AlertTriangle,
  CheckCircle2, XCircle, Bot, Zap, Shield, Eye, Wallet,
  ArrowUpRight, ArrowDownRight, Clock, ChevronDown, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BotPosition {
  id: string;
  asset_class: 'polymarket' | 'crypto' | 'equity_signal';
  exchange: string;
  symbol: string;
  market_id: string | null;
  side: string;
  entry_price: number;
  current_price: number | null;
  quantity: number;
  position_size_usd: number;
  kelly_fraction: number | null;
  ev_at_entry: number | null;
  ai_probability: number | null;
  ai_reasoning: string | null;
  ai_model: string | null;
  status: 'open' | 'closed' | 'pending';
  pnl: number;
  pnl_percent: number;
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
  metadata: Record<string, unknown>;
}

interface BotPerformance {
  id: string;
  timestamp: string;
  total_equity: number;
  daily_pnl: number;
  weekly_pnl: number | null;
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  open_positions: number;
  total_trades: number;
}

interface BotConfig {
  trading_mode: 'paper' | 'live';
  kelly_fraction: number;
  max_position_pct: number;
  max_concurrent_positions: number;
  daily_loss_limit_pct: number;
  slippage_limit_pct: number;
  ev_threshold: number;
  polymarket_enabled: boolean;
  crypto_enabled: boolean;
  exchanges: string[];
}

interface BotLog {
  id: string;
  level: string;
  category: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

type TabView = 'dashboard' | 'positions' | 'performance' | 'config' | 'logs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFRESH = 10_000;

async function safeFetch(path: string): Promise<any> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await apiFetch(path, { signal: ctrl.signal } as any);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const fUsd = (n: number | null | undefined) => {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
};

const fPct = (n: number | null | undefined) => {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
};

const fTime = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';

const fDate = (ts: string | null) =>
  ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

const ASSET_CLASS_COLORS: Record<string, string> = {
  crypto: 'text-btc-orange border-btc-orange/30 bg-btc-orange/10',
  polymarket: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
  equity_signal: 'text-sky-400 border-sky-400/30 bg-sky-400/10',
};

const SIDE_COLORS: Record<string, string> = {
  buy: 'text-green-400', sell: 'text-red-400',
  yes: 'text-green-400', no: 'text-red-400',
  long: 'text-green-400', short: 'text-red-400',
};

const MODE_STYLES: Record<string, string> = {
  paper: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  live: 'text-green-400 border-green-400/30 bg-green-400/10',
};

// ─── Mini Equity Chart (SVG sparkline) ────────────────────────────────────────

function EquitySparkline({ data }: { data: BotPerformance[] }) {
  if (!data.length) return null;
  const sorted = [...data].reverse();
  const values = sorted.map(d => d.total_equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 280;
  const h = 60;
  const points = values.map((v, i) =>
    `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(' ');

  const isUp = values[values.length - 1] >= values[0];

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? '#22c55e' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Position Row ─────────────────────────────────────────────────────────────

function PositionRow({ pos, onClose }: { pos: BotPosition; onClose: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isPaper = pos.metadata?.is_paper === true;
  const pnl = Number(pos.pnl) || 0;
  const pnlPct = Number(pos.pnl_percent) || 0;
  const isOpen = pos.status === 'open';
  const currentPrice = pos.current_price ?? pos.entry_price;

  // Live PnL calculation for open positions
  const livePnl = isOpen && pos.current_price
    ? (pos.side === 'buy' || pos.side === 'yes'
        ? (Number(pos.current_price) - Number(pos.entry_price)) * Number(pos.quantity)
        : (Number(pos.entry_price) - Number(pos.current_price)) * Number(pos.quantity))
    : pnl;
  const livePnlPct = pos.position_size_usd > 0 ? livePnl / Number(pos.position_size_usd) : 0;

  return (
    <div className={`border rounded-lg transition-all ${
      isOpen
        ? 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
        : 'border-gray-800/50 bg-gray-950/40'
    }`}>
      <div
        className="p-3 cursor-pointer flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isOpen ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-gray-600'
        }`} />

        {/* Symbol + side */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-gray-200 truncate">{pos.symbol}</span>
            <span className={`text-[10px] font-mono font-bold uppercase ${SIDE_COLORS[pos.side] || 'text-gray-400'}`}>
              {pos.side}
            </span>
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${ASSET_CLASS_COLORS[pos.asset_class] || ''}`}>
              {pos.asset_class}
            </span>
            {isPaper && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-yellow-400/30 bg-yellow-400/10 text-yellow-400">
                PAPER
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-gray-600 mt-0.5">
            Entry: {fUsd(pos.entry_price)} · Size: {fUsd(pos.position_size_usd)} · {fDate(pos.opened_at)}
          </div>
        </div>

        {/* PnL */}
        <div className="text-right flex-shrink-0">
          <div className={`text-sm font-mono ${livePnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {livePnl >= 0 ? '+' : ''}{fUsd(livePnl)}
          </div>
          <div className={`text-[10px] font-mono ${livePnlPct >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
            {fPct(livePnlPct)}
          </div>
        </div>

        {/* Expand arrow */}
        {expanded
          ? <ChevronDown className="w-3 h-3 text-gray-600 flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-800/50 pt-2 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <div className="text-[9px] font-mono text-gray-600 uppercase">Current Price</div>
              <div className="text-xs font-mono text-gray-300">{fUsd(currentPrice)}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-gray-600 uppercase">Quantity</div>
              <div className="text-xs font-mono text-gray-300">{Number(pos.quantity).toFixed(6)}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-gray-600 uppercase">AI Probability</div>
              <div className="text-xs font-mono text-gray-300">
                {pos.ai_probability ? `${(Number(pos.ai_probability) * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-gray-600 uppercase">EV at Entry</div>
              <div className="text-xs font-mono text-gray-300">
                {pos.ev_at_entry ? fPct(Number(pos.ev_at_entry)) : '—'}
              </div>
            </div>
          </div>

          {pos.ai_reasoning && (
            <div>
              <div className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">AI Reasoning</div>
              <div className="text-[11px] font-mono text-gray-400 leading-relaxed bg-gray-950 rounded p-2 border border-gray-800/50">
                {pos.ai_reasoning}
              </div>
            </div>
          )}

          {isOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(pos.id); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-900/30 bg-red-950/20 text-[10px] font-mono text-red-400 hover:bg-red-900/30 transition-colors"
            >
              <XCircle className="w-3 h-3" /> Close Position
            </button>
          )}

          {!isOpen && pos.close_reason && (
            <div className="text-[10px] font-mono text-gray-600">
              Closed: {pos.close_reason} · {fDate(pos.closed_at)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({
  config,
  onUpdate,
}: {
  config: BotConfig;
  onUpdate: (updates: Partial<BotConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Trading Mode */}
      <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60">
        <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">Trading Mode</div>
        <div className="flex gap-2">
          <button
            onClick={() => onUpdate({ trading_mode: 'paper' })}
            className={`flex-1 py-2 px-3 rounded border text-xs font-mono transition-all ${
              config.trading_mode === 'paper'
                ? 'border-yellow-400/50 bg-yellow-400/10 text-yellow-400'
                : 'border-gray-800 bg-gray-950 text-gray-600 hover:border-gray-700'
            }`}
          >
            📄 Paper
          </button>
          <button
            onClick={() => onUpdate({ trading_mode: 'live' })}
            className={`flex-1 py-2 px-3 rounded border text-xs font-mono transition-all ${
              config.trading_mode === 'live'
                ? 'border-green-400/50 bg-green-400/10 text-green-400'
                : 'border-gray-800 bg-gray-950 text-gray-600 hover:border-gray-700'
            }`}
          >
            💰 Live
          </button>
        </div>
      </div>

      {/* Risk Parameters */}
      <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60">
        <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">Risk Parameters</div>
        <div className="grid grid-cols-2 gap-3">
          <ConfigSlider
            label="Kelly Fraction"
            value={config.kelly_fraction}
            min={0.05} max={1.0} step={0.05}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => onUpdate({ kelly_fraction: v })}
          />
          <ConfigSlider
            label="Max Position %"
            value={config.max_position_pct}
            min={0.005} max={0.10} step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => onUpdate({ max_position_pct: v })}
          />
          <ConfigSlider
            label="EV Threshold"
            value={config.ev_threshold}
            min={0.01} max={0.20} step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => onUpdate({ ev_threshold: v })}
          />
          <ConfigSlider
            label="Daily Loss Limit"
            value={config.daily_loss_limit_pct}
            min={0.01} max={0.20} step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => onUpdate({ daily_loss_limit_pct: v })}
          />
          <ConfigSlider
            label="Max Positions"
            value={config.max_concurrent_positions}
            min={1} max={30} step={1}
            format={(v) => `${v}`}
            onChange={(v) => onUpdate({ max_concurrent_positions: v })}
          />
          <ConfigSlider
            label="Slippage Limit"
            value={config.slippage_limit_pct}
            min={0.005} max={0.05} step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => onUpdate({ slippage_limit_pct: v })}
          />
        </div>
      </div>

      {/* Asset Classes */}
      <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60">
        <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">Asset Classes</div>
        <div className="flex gap-2">
          <button
            onClick={() => onUpdate({ crypto_enabled: !config.crypto_enabled })}
            className={`flex-1 py-2 px-3 rounded border text-xs font-mono transition-all ${
              config.crypto_enabled
                ? 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
                : 'border-gray-800 bg-gray-950 text-gray-600'
            }`}
          >
            Crypto {config.crypto_enabled ? '✓' : '✗'}
          </button>
          <button
            onClick={() => onUpdate({ polymarket_enabled: !config.polymarket_enabled })}
            className={`flex-1 py-2 px-3 rounded border text-xs font-mono transition-all ${
              config.polymarket_enabled
                ? 'border-purple-400/50 bg-purple-400/10 text-purple-400'
                : 'border-gray-800 bg-gray-950 text-gray-600'
            }`}
          >
            Polymarket {config.polymarket_enabled ? '✓' : '✗'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigSlider({
  label, value, min, max, step, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[9px] font-mono text-gray-600 uppercase">{label}</span>
        <span className="text-[10px] font-mono text-btc-orange">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-gray-800 rounded-full appearance-none cursor-pointer accent-btc-orange"
      />
    </div>
  );
}

// ─── Log Row ──────────────────────────────────────────────────────────────────

const LOG_LEVEL_COLORS: Record<string, string> = {
  INFO: 'text-gray-400',
  WARNING: 'text-yellow-400',
  ERROR: 'text-red-400',
  DEBUG: 'text-gray-600',
};

function LogRow({ log }: { log: BotLog }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-800/30 last:border-0">
      <span className="text-[9px] font-mono text-gray-600 flex-shrink-0 w-14">{fTime(log.created_at)}</span>
      <span className={`text-[9px] font-mono font-bold flex-shrink-0 w-12 ${LOG_LEVEL_COLORS[log.level] || 'text-gray-400'}`}>
        {log.level}
      </span>
      <span className="text-[10px] font-mono text-gray-500 flex-shrink-0 w-20 truncate">{log.category}</span>
      <span className="text-[10px] font-mono text-gray-300 truncate">{log.message}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TradingBot({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState<TabView>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [positions, setPositions] = useState<BotPosition[]>([]);
  const [performance, setPerformance] = useState<BotPerformance[]>([]);
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null);
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [botStatus, setBotStatus] = useState<'running' | 'paused' | 'offline'>('offline');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const openPositions = positions.filter(p => p.status === 'open');
  const closedPositions = positions.filter(p => p.status === 'closed');
  const latestPerf = performance.length > 0 ? performance[0] : null;

  // ─── Status Polling ─────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    const data = await safeFetch('/api/tradingbot/status');
    if (data) {
      setBotStatus(data.status === 'running' ? 'running' : data.status === 'paused' ? 'paused' : 'offline');
      setStatusMessage(data.message || '');
    }
  }, []);

  // ─── Data Loading ─────────────────────────────────────────────

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [posData, perfData, configData, logsData] = await Promise.all([
        safeFetch('/api/tradingbot/positions'),
        safeFetch('/api/tradingbot/performance'),
        safeFetch('/api/tradingbot/config'),
        safeFetch('/api/tradingbot/logs'),
      ]);

      if (posData) setPositions(posData);
      if (perfData) setPerformance(perfData);
      if (configData) setBotConfig(configData);
      if (logsData) setLogs(logsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); checkStatus(); }, [loadAll, checkStatus]);

  // Auto-refresh data + status
  useEffect(() => {
    const timer = setInterval(() => { loadAll(true); checkStatus(); }, REFRESH);
    return () => clearInterval(timer);
  }, [loadAll, checkStatus]);

  // ─── Commands ─────────────────────────────────────────────────

  const sendCommand = async (command: string, payload: Record<string, unknown> = {}) => {
    try {
      await apiFetch('/api/tradingbot/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, payload }),
      });
      // Refresh after command
      setTimeout(() => loadAll(true), 1000);
    } catch (err) {
      console.error('Command failed:', err);
    }
  };

  const closePosition = (positionId: string) => {
    sendCommand('close_position', { position_id: positionId });
  };

  const updateConfig = (updates: Partial<BotConfig>) => {
    if (!botConfig) return;
    const newConfig = { ...botConfig, ...updates };
    setBotConfig(newConfig);
    sendCommand('update_config', updates);
  };

  // ─── Computed Stats ───────────────────────────────────────────

  const totalPnl = closedPositions.reduce((sum, p) => sum + Number(p.pnl || 0), 0);
  const winCount = closedPositions.filter(p => Number(p.pnl) > 0).length;
  const winRate = closedPositions.length > 0 ? winCount / closedPositions.length : 0;
  const totalEquity = latestPerf?.total_equity ?? (botConfig?.trading_mode === 'paper' ? 1000 : 0);

  const unrealizedPnl = openPositions.reduce((sum, pos) => {
    if (!pos.current_price) return sum;
    const pnl = pos.side === 'buy' || pos.side === 'yes'
      ? (Number(pos.current_price) - Number(pos.entry_price)) * Number(pos.quantity)
      : (Number(pos.entry_price) - Number(pos.current_price)) * Number(pos.quantity);
    return sum + pnl;
  }, 0);

  // ─── Tab Navigation ───────────────────────────────────────────

  const tabs: { key: TabView; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <Activity className="w-3 h-3" /> },
    { key: 'positions', label: 'Positions', icon: <Target className="w-3 h-3" /> },
    { key: 'performance', label: 'Performance', icon: <BarChart3 className="w-3 h-3" /> },
    { key: 'config', label: 'Config', icon: <Settings className="w-3 h-3" /> },
    { key: 'logs', label: 'Logs', icon: <Eye className="w-3 h-3" /> },
  ];

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-6 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-mono text-gray-200 tracking-tight flex items-center gap-2">
            <Bot className="w-4 h-4 text-btc-orange" />
            TradingBot
            {botConfig && (
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ml-2 ${MODE_STYLES[botConfig.trading_mode]}`}>
                {botConfig.trading_mode.toUpperCase()}
              </span>
            )}
          </h1>
          <p className="text-[10px] font-mono text-gray-600 mt-0.5">
            {openPositions.length} open positions · {closedPositions.length} trades
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div className="flex items-center gap-1.5 mr-2">
            <div className={`w-2 h-2 rounded-full ${
              botStatus === 'running' ? 'bg-green-400 animate-pulse' :
              botStatus === 'paused' ? 'bg-yellow-400' :
              'bg-gray-600'
            }`} />
            <span className={`text-[9px] font-mono uppercase tracking-wider ${
              botStatus === 'running' ? 'text-green-400' :
              botStatus === 'paused' ? 'text-yellow-400' :
              'text-gray-600'
            }`}>
              {botStatus}
            </span>
          </div>
          {/* Bot controls */}
          {botStatus === 'offline' ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-800 bg-gray-900/80 text-[10px] font-mono text-gray-500">
                <Square className="w-3 h-3" />
                <span>Start bot locally:</span>
                <code className="text-btc-orange bg-gray-800/50 px-1.5 py-0.5 rounded text-[9px]">python -m bot.main</code>
              </div>
            </div>
          ) : botStatus === 'paused' ? (
            <>
              <button
                onClick={() => sendCommand('resume')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-green-900/30 bg-green-950/20 text-[10px] font-mono text-green-400 hover:bg-green-900/30 transition-colors"
              >
                <Play className="w-3 h-3" /> Resume
              </button>
              <button
                onClick={() => sendCommand('kill')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-900/30 bg-red-950/20 text-[10px] font-mono text-red-400 hover:bg-red-900/30 transition-colors"
              >
                <Square className="w-3 h-3" /> Stop
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => sendCommand('pause')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-yellow-900/30 bg-yellow-950/20 text-[10px] font-mono text-yellow-400 hover:bg-yellow-900/30 transition-colors"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
              <button
                onClick={() => sendCommand('kill')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-900/30 bg-red-950/20 text-[10px] font-mono text-red-400 hover:bg-red-900/30 transition-colors"
              >
                <Square className="w-3 h-3" /> Stop
              </button>
            </>
          )}
          <button
            onClick={() => { loadAll(true); checkStatus(); }}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-gray-800 bg-gray-900 text-[10px] font-mono text-gray-400 hover:text-btc-orange hover:border-gray-700 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 mb-5 border-b border-gray-800/50 pb-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[10px] font-mono transition-colors ${
              activeTab === tab.key
                ? 'text-btc-orange border-b-2 border-btc-orange'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Error State ── */}
      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-900/30 bg-red-950/20 text-[11px] font-mono text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-3 h-3" /> {error}
        </div>
      )}

      {/* ── Loading State ── */}
      {loading && !positions.length && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
          <span className="text-sm font-mono text-gray-600 ml-2">Loading bot data...</span>
        </div>
      )}

      {/* ═══════════════════ DASHBOARD TAB ═══════════════════ */}
      {activeTab === 'dashboard' && !loading && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
                <Wallet className="w-3 h-3" /> Equity
              </div>
              <div className="text-xl font-mono text-gray-200 mt-1">{fUsd(totalEquity)}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Realized PnL
              </div>
              <div className={`text-xl font-mono mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalPnl >= 0 ? '+' : ''}{fUsd(totalPnl)}
              </div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
                <Activity className="w-3 h-3" /> Unrealized
              </div>
              <div className={`text-xl font-mono mt-1 ${unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {unrealizedPnl >= 0 ? '+' : ''}{fUsd(unrealizedPnl)}
              </div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
                <Target className="w-3 h-3 text-btc-orange" /> Win Rate
              </div>
              <div className="text-xl font-mono text-btc-orange mt-1">
                {closedPositions.length > 0 ? `${(winRate * 100).toFixed(0)}%` : '—'}
              </div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
                <Zap className="w-3 h-3" /> Trades
              </div>
              <div className="text-xl font-mono text-gray-200 mt-1">{closedPositions.length}</div>
            </div>
          </div>

          {/* Equity Sparkline */}
          {performance.length > 1 && (
            <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">Equity Curve</div>
              <EquitySparkline data={performance} />
            </div>
          )}

          {/* Open Positions */}
          <div>
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
              Open Positions ({openPositions.length})
            </div>
            {openPositions.length === 0 ? (
              <div className="border border-gray-800/50 rounded-lg p-6 bg-gray-950/30 text-center">
                <Bot className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                <p className="text-[11px] font-mono text-gray-600">No open positions. Bot is scanning for opportunities.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {openPositions.map(pos => (
                  <PositionRow key={pos.id} pos={pos} onClose={closePosition} />
                ))}
              </div>
            )}
          </div>

          {/* Recent Closed */}
          {closedPositions.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-2">
                Recent Trades
              </div>
              <div className="space-y-1.5">
                {closedPositions.slice(0, 5).map(pos => (
                  <PositionRow key={pos.id} pos={pos} onClose={closePosition} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ POSITIONS TAB ═══════════════════ */}
      {activeTab === 'positions' && !loading && (
        <div className="space-y-4">
          <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-2">
            All Positions ({positions.length})
          </div>
          {positions.length === 0 ? (
            <div className="border border-gray-800/50 rounded-lg p-8 bg-gray-950/30 text-center">
              <Target className="w-6 h-6 text-gray-700 mx-auto mb-2" />
              <p className="text-[11px] font-mono text-gray-600">
                {botStatus === 'offline'
                  ? 'No positions yet. Start the bot locally with: python -m bot.main'
                  : 'No positions yet. Bot is scanning for opportunities...'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {positions.map(pos => (
                <PositionRow key={pos.id} pos={pos} onClose={closePosition} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ PERFORMANCE TAB ═══════════════════ */}
      {activeTab === 'performance' && !loading && (
        <div className="space-y-4">
          {/* Performance metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[9px] font-mono text-gray-600 uppercase">Total Equity</div>
              <div className="text-lg font-mono text-gray-200 mt-1">{fUsd(totalEquity)}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[9px] font-mono text-gray-600 uppercase">Total PnL</div>
              <div className={`text-lg font-mono mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fUsd(totalPnl)}
              </div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[9px] font-mono text-gray-600 uppercase">Win / Loss</div>
              <div className="text-lg font-mono text-gray-200 mt-1">
                <span className="text-green-400">{winCount}</span>
                <span className="text-gray-600"> / </span>
                <span className="text-red-400">{closedPositions.length - winCount}</span>
              </div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[9px] font-mono text-gray-600 uppercase">Win Rate</div>
              <div className="text-lg font-mono text-btc-orange mt-1">
                {closedPositions.length > 0 ? `${(winRate * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>

          {/* Equity Curve */}
          {performance.length > 1 && (
            <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">Equity Curve</div>
              <EquitySparkline data={performance} />
            </div>
          )}

          {/* Trade breakdown by asset class */}
          <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">By Asset Class</div>
            {(['crypto', 'polymarket'] as const).map(ac => {
              const acTrades = closedPositions.filter(p => p.asset_class === ac);
              const acPnl = acTrades.reduce((s, p) => s + Number(p.pnl || 0), 0);
              const acWins = acTrades.filter(p => Number(p.pnl) > 0).length;
              return (
                <div key={ac} className="flex items-center justify-between py-2 border-b border-gray-800/30 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${ASSET_CLASS_COLORS[ac]}`}>
                      {ac}
                    </span>
                    <span className="text-[10px] font-mono text-gray-400">{acTrades.length} trades</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-mono text-gray-500">
                      WR: {acTrades.length > 0 ? `${((acWins / acTrades.length) * 100).toFixed(0)}%` : '—'}
                    </span>
                    <span className={`text-[11px] font-mono ${acPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fUsd(acPnl)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════ CONFIG TAB ═══════════════════ */}
      {activeTab === 'config' && !loading && botConfig && (
        <ConfigPanel config={botConfig} onUpdate={updateConfig} />
      )}

      {/* ═══════════════════ LOGS TAB ═══════════════════ */}
      {activeTab === 'logs' && !loading && (
        <div className="border border-gray-800 rounded-lg bg-gray-900/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800/50">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Bot Activity Log</div>
          </div>
          <div className="p-3 max-h-[600px] overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-[11px] font-mono text-gray-600 text-center py-8">
                {botStatus === 'offline'
                  ? 'No logs yet. Start the bot locally with: python -m bot.main'
                  : 'No logs yet. Bot is running...'}
              </p>
            ) : (
              logs.map(log => <LogRow key={log.id} log={log} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
