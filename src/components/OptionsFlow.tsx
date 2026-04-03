'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Activity, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUsd } from '@/lib/formatters';

// ── Types ──────────────────────────────────────────────────────────────────────

interface OptionsTrade {
  id: string;
  ticker: string;
  strike: number;
  expiry: string;
  type: 'Call' | 'Put';
  premium: number;
  size: number;
  price: number;
  tradeType: 'Sweep' | 'Block' | 'Split';
  timestamp: number;
  exchange: number;
  conditions: number[];
  unusualScore: number;
}

interface FilterState {
  minPremium: number;
  typeFilter: 'all' | 'calls' | 'puts';
  tradeTypeFilters: Set<'Sweep' | 'Block' | 'Split'>;
  tickerSearch: string;
}

interface SentimentData {
  callPremium: number;
  putPremium: number;
  totalTrades: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_TRADES = 200;
const UI_UPDATE_INTERVAL = 100; // 10fps

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ── Component ──────────────────────────────────────────────────────────────────

export const OptionsFlow = () => {
  const [connected, setConnected] = useState(false);
  const [displayTrades, setDisplayTrades] = useState<OptionsTrade[]>([]);
  const [displaySentiment, setDisplaySentiment] = useState<SentimentData>({
    callPremium: 0,
    putPremium: 0,
    totalTrades: 0,
  });

  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    minPremium: 0,
    typeFilter: 'all',
    tradeTypeFilters: new Set(['Sweep', 'Block', 'Split']),
    tickerSearch: '',
  });

  // Refs for accumulation
  const tradesRef = useRef<OptionsTrade[]>([]);
  const sentimentRef = useRef<SentimentData>({
    callPremium: 0,
    putPremium: 0,
    totalTrades: 0,
  });
  const esRef = useRef<EventSource | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Connect to SSE ─────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    setConnected(false);
    tradesRef.current = [];
    sentimentRef.current = { callPremium: 0, putPremium: 0, totalTrades: 0 };

    try {
      const es = new EventSource('/api/sse/options-flow');
      esRef.current = es;

      es.addEventListener('connected', () => {
        setConnected(true);
      });

      es.addEventListener('trade', (event) => {
        try {
          const { trade } = JSON.parse(event.data) as { trade: OptionsTrade };

          // Add trade to buffer
          tradesRef.current = [trade, ...tradesRef.current].slice(0, MAX_TRADES);

          // Update sentiment
          if (trade.type === 'Call') {
            sentimentRef.current.callPremium += trade.premium;
          } else {
            sentimentRef.current.putPremium += trade.premium;
          }
          sentimentRef.current.totalTrades++;
        } catch (err) {
          console.error('[OptionsFlow] Parse error:', err);
        }
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Retry after 3 seconds
        setTimeout(connect, 3000);
      };
    } catch (err) {
      console.error('[OptionsFlow] Connection error:', err);
      setTimeout(connect, 3000);
    }
  }, []);

  // ── UI Ticker (10fps) ──────────────────────────────────────────────────────

  useEffect(() => {
    tickerRef.current = setInterval(() => {
      setDisplayTrades([...tradesRef.current]);
      setDisplaySentiment({ ...sentimentRef.current });
    }, UI_UPDATE_INTERVAL);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  // ── Connect on mount ───────────────────────────────────────────────────────

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    };
  }, [connect]);

  // ── Filter trades ──────────────────────────────────────────────────────────

  const filteredTrades = useMemo(() => {
    return displayTrades.filter((trade) => {
      // Premium filter
      if (trade.premium < filters.minPremium) return false;

      // Type filter
      if (filters.typeFilter === 'calls' && trade.type !== 'Call') return false;
      if (filters.typeFilter === 'puts' && trade.type !== 'Put') return false;

      // Trade type filter
      if (!filters.tradeTypeFilters.has(trade.tradeType)) return false;

      // Ticker search
      if (filters.tickerSearch && !trade.ticker.includes(filters.tickerSearch.toUpperCase())) {
        return false;
      }

      return true;
    });
  }, [displayTrades, filters]);

  // ── Calculate stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const sweepCount = filteredTrades.filter((t) => t.tradeType === 'Sweep').length;
    const blockCount = filteredTrades.filter((t) => t.tradeType === 'Block').length;
    const avgPremium =
      filteredTrades.length > 0
        ? filteredTrades.reduce((sum, t) => sum + t.premium, 0) / filteredTrades.length
        : 0;

    return {
      sweepCount,
      blockCount,
      avgPremium,
    };
  }, [filteredTrades]);

  // ── Sentiment calculation ──────────────────────────────────────────────────

  const totalPremium = displaySentiment.callPremium + displaySentiment.putPremium;
  const callPercent = totalPremium > 0 ? (displaySentiment.callPremium / totalPremium) * 100 : 50;

  // ── Filter handlers ────────────────────────────────────────────────────────

  const toggleTradeType = (type: 'Sweep' | 'Block' | 'Split') => {
    setFilters((prev) => {
      const next = new Set(prev.tradeTypeFilters);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return { ...prev, tradeTypeFilters: next };
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen -mt-8 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4 flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-btc-orange" />
          <h1 className="text-lg font-mono font-bold tracking-widest uppercase text-white">
            Options Flow
          </h1>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              <Wifi size={12} className="text-emerald-500" />
              <span className="text-[9px] font-mono uppercase text-emerald-500">Live</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
              <WifiOff size={12} className="text-red-500" />
              <span className="text-[9px] font-mono uppercase text-red-500">Connecting...</span>
            </>
          )}
        </div>
      </div>

      {/* Sentiment Bar */}
      <div className="bg-[#0d0d0d] border border-white/5 p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">
            Call/Put Sentiment
          </span>
          <span className="text-[11px] font-mono text-gray-400">
            {displaySentiment.totalTrades} trades • {formatUsd(totalPremium)} premium
          </span>
        </div>
        <div className="flex h-4 w-full overflow-hidden bg-[#1a1a1a]">
          <div
            className="bg-emerald-500/70 transition-all duration-300"
            style={{ width: `${callPercent}%` }}
          />
          <div
            className="bg-red-500/70 transition-all duration-300"
            style={{ width: `${100 - callPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-mono mt-1">
          <span className="text-emerald-500">Calls {callPercent.toFixed(1)}%</span>
          <span className="text-red-500">Puts {(100 - callPercent).toFixed(1)}%</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-[#0d0d0d] border border-white/5 p-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Min Premium Slider */}
          <div>
            <label className="text-[9px] font-mono uppercase tracking-widest text-gray-500 block mb-1">
              Min Premium
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100000"
                step="5000"
                value={filters.minPremium}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, minPremium: parseInt(e.target.value, 10) }))
                }
                className="flex-1 h-2 bg-[#1a1a1a] rounded appearance-none cursor-pointer"
              />
              <span className="text-[10px] font-mono text-gray-400 w-16 text-right">
                {filters.minPremium === 0 ? 'Any' : `$${(filters.minPremium / 1000).toFixed(0)}K`}
              </span>
            </div>
          </div>

          {/* Call/Put Filter */}
          <div>
            <label className="text-[9px] font-mono uppercase tracking-widest text-gray-500 block mb-1">
              Type
            </label>
            <div className="flex gap-1">
              {(['all', 'calls', 'puts'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilters((prev) => ({ ...prev, typeFilter: type }))}
                  className={cn(
                    'flex-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider border transition-colors',
                    filters.typeFilter === type
                      ? type === 'calls'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : type === 'puts'
                          ? 'border-red-500/50 bg-red-500/10 text-red-400'
                          : 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
                      : 'border-white/10 text-gray-500 hover:text-gray-300'
                  )}
                >
                  {type === 'all' ? 'All' : type === 'calls' ? 'Calls' : 'Puts'}
                </button>
              ))}
            </div>
          </div>

          {/* Trade Type Checkboxes */}
          <div>
            <label className="text-[9px] font-mono uppercase tracking-widest text-gray-500 block mb-1">
              Trade Type
            </label>
            <div className="flex gap-1">
              {(['Sweep', 'Block', 'Split'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => toggleTradeType(type)}
                  className={cn(
                    'flex-1 px-2 py-1 text-[8px] font-mono uppercase tracking-wider border transition-colors',
                    filters.tradeTypeFilters.has(type)
                      ? 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
                      : 'border-white/10 text-gray-500 hover:text-gray-300'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Ticker Search */}
          <div>
            <label className="text-[9px] font-mono uppercase tracking-widest text-gray-500 block mb-1">
              Ticker
            </label>
            <input
              type="text"
              placeholder="Search..."
              value={filters.tickerSearch}
              onChange={(e) => setFilters((prev) => ({ ...prev, tickerSearch: e.target.value }))}
              className="w-full px-2 py-1 text-[10px] font-mono bg-[#1a1a1a] border border-white/10 text-white placeholder-gray-600 focus:border-btc-orange/30 focus:outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Flow Table */}
      <div
        className="bg-[#0d0d0d] border border-white/5 overflow-hidden flex flex-col flex-1"
        style={{ minHeight: 'calc(100vh - 380px)' }}
      >
        {/* Table header */}
        <div className="flex items-center px-3 py-1.5 bg-white/[0.02] border-b border-white/5 text-[8px] font-mono uppercase tracking-widest text-gray-500 flex-shrink-0">
          <span className="w-[70px]">Time</span>
          <span className="w-[70px] font-bold text-white">Ticker</span>
          <span className="w-[70px] text-right">Strike</span>
          <span className="w-[60px] text-right">Expiry</span>
          <span className="w-[50px] text-center">Type</span>
          <span className="w-[90px] text-right">Premium</span>
          <span className="w-[60px] text-right">Size</span>
          <span className="w-[70px] text-center">Trade</span>
          <span className="w-[40px] text-center">Score</span>
        </div>

        {/* Trade rows */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
          {filteredTrades.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
              {connected
                ? filteredTrades.length === 0 && displayTrades.length > 0
                  ? 'No trades match filters'
                  : 'Waiting for options flow...'
                : 'Connecting...'}
            </div>
          ) : (
            filteredTrades.map((trade, idx) => {
              const isCall = trade.type === 'Call';
              const tradeTypeColor =
                trade.tradeType === 'Sweep'
                  ? 'bg-btc-orange/10 text-btc-orange border-btc-orange/20'
                  : trade.tradeType === 'Block'
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    : 'bg-gray-500/10 text-gray-400 border-gray-500/20';

              const scoreColor =
                trade.unusualScore >= 7
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : trade.unusualScore >= 4
                    ? 'bg-yellow-500/10 text-yellow-400'
                    : 'bg-gray-500/10 text-gray-400';

              return (
                <div
                  key={`${trade.id}-${idx}`}
                  className={cn(
                    'flex items-center px-3 py-[3px] font-mono text-[10px] border-b border-white/[0.02] transition-colors duration-200 animate-in fade-in slide-in-from-top-1',
                    isCall ? 'bg-emerald-500/[0.04]' : 'bg-red-500/[0.04]'
                  )}
                >
                  <span className="w-[70px] text-gray-500 tabular-nums">{formatTime(trade.timestamp)}</span>
                  <span className="w-[70px] font-bold text-white tabular-nums">{trade.ticker}</span>
                  <span className="w-[70px] text-right text-gray-300 tabular-nums">
                    ${formatNumber(trade.strike, 2)}
                  </span>
                  <span className="w-[60px] text-right text-gray-400 tabular-nums">{trade.expiry}</span>
                  <span
                    className={cn(
                      'w-[50px] text-center text-[8px] uppercase font-bold tracking-wider',
                      isCall ? 'text-emerald-500' : 'text-red-500'
                    )}
                  >
                    {isCall ? 'C' : 'P'}
                  </span>
                  <span
                    className={cn(
                      'w-[90px] text-right tabular-nums font-medium',
                      trade.premium > 50000 ? 'text-btc-orange font-bold' : 'text-gray-300'
                    )}
                  >
                    {formatUsd(trade.premium)}
                  </span>
                  <span className="w-[60px] text-right text-gray-400 tabular-nums">{trade.size}</span>
                  <span className={cn('w-[70px] text-center text-[7px] uppercase font-bold px-1 py-0.5 border rounded', tradeTypeColor)}>
                    {trade.tradeType}
                  </span>
                  <span className={cn('w-[40px] text-center text-[8px] font-bold px-1 py-0.5 rounded', scoreColor)}>
                    {trade.unusualScore}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Stats Footer */}
      <div className="bg-[#0d0d0d] border border-white/5 border-t-0 px-3 py-2 flex flex-wrap gap-4 text-[10px] font-mono text-gray-400 flex-shrink-0">
        <div>
          <span className="text-gray-500">Total: </span>
          <span className="text-white font-bold">{filteredTrades.length}</span>
        </div>
        <div>
          <span className="text-gray-500">Avg Premium: </span>
          <span className="text-white font-bold tabular-nums">{formatUsd(stats.avgPremium)}</span>
        </div>
        <div>
          <span className="text-btc-orange">Sweeps: </span>
          <span className="text-white font-bold">{stats.sweepCount}</span>
        </div>
        <div>
          <span className="text-purple-400">Blocks: </span>
          <span className="text-white font-bold">{stats.blockCount}</span>
        </div>
      </div>
    </div>
  );
};
