'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUsd } from '@/lib/formatters';
import type { DarkPoolTrade, DarkPoolStats, DarkPoolResponse } from '@/app/api/dark-pool/route';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FilterState {
  tickerSearch: string;
  minNotional: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FETCH_INTERVAL = 30000; // 30 seconds
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

export const DarkPool = () => {
  const [connected, setConnected] = useState(false);
  const [displayTrades, setDisplayTrades] = useState<DarkPoolTrade[]>([]);
  const [displayStats, setDisplayStats] = useState<DarkPoolStats>({
    totalNotional: 0,
    totalTrades: 0,
    topTicker: 'N/A',
    topTickerNotional: 0,
    averageTradeSize: 0,
    accumulationTickers: [],
  });
  const [dataSource, setDataSource] = useState<'polygon' | 'fallback'>('polygon');

  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    tickerSearch: '',
    minNotional: 0,
  });

  // Refs for accumulation
  const tradesRef = useRef<DarkPoolTrade[]>([]);
  const statsRef = useRef<DarkPoolStats>(displayStats);
  const dataSourceRef = useRef<'polygon' | 'fallback'>('polygon');
  const fetchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch dark pool data ───────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/dark-pool');
      if (!response.ok) {
        console.error('[DarkPool] Fetch failed:', response.status);
        setConnected(false);
        return;
      }

      const data = (await response.json()) as DarkPoolResponse;

      // Update refs
      tradesRef.current = data.trades.slice(0, MAX_TRADES);
      statsRef.current = data.stats;
      dataSourceRef.current = data.dataSource;

      setConnected(true);
    } catch (err) {
      console.error('[DarkPool] Fetch error:', err);
      setConnected(false);
    }
  }, []);

  // ── Setup fetch interval ───────────────────────────────────────────────────

  useEffect(() => {
    // Fetch immediately on mount
    fetchData();

    // Then set up interval
    fetchTimerRef.current = setInterval(fetchData, FETCH_INTERVAL);

    return () => {
      if (fetchTimerRef.current) clearInterval(fetchTimerRef.current);
    };
  }, [fetchData]);

  // ── UI Ticker (10fps) ──────────────────────────────────────────────────────

  useEffect(() => {
    tickerRef.current = setInterval(() => {
      setDisplayTrades([...tradesRef.current]);
      setDisplayStats({ ...statsRef.current });
      setDataSource(dataSourceRef.current);
    }, UI_UPDATE_INTERVAL);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  // ── Filter trades ──────────────────────────────────────────────────────────

  const filteredTrades = useMemo(() => {
    return displayTrades.filter((trade) => {
      // Notional filter
      if (trade.notionalValue < filters.minNotional) return false;

      // Ticker search
      if (filters.tickerSearch && !trade.ticker.includes(filters.tickerSearch.toUpperCase())) {
        return false;
      }

      return true;
    });
  }, [displayTrades, filters]);

  // ── Calculate heatmap data (ticker volume) ─────────────────────────────────

  const heatmapData = useMemo(() => {
    const volumeByTicker = new Map<string, number>();

    displayTrades.forEach((trade) => {
      volumeByTicker.set(trade.ticker, (volumeByTicker.get(trade.ticker) || 0) + trade.notionalValue);
    });

    const tickers = Array.from(volumeByTicker.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    const maxVolume = Math.max(...tickers.map((t) => t[1]), 1);

    return tickers.map(([ticker, volume]) => ({
      ticker,
      volume,
      intensity: volume / maxVolume,
    }));
  }, [displayTrades]);

  // ── Calculate accumulation percentage for each ticker ──────────────────────

  const accumulationMap = useMemo(() => {
    const tickerData = new Map<string, { total: number; aboveAsk: number }>();

    displayTrades.forEach((trade) => {
      if (!tickerData.has(trade.ticker)) {
        tickerData.set(trade.ticker, { total: 0, aboveAsk: 0 });
      }
      const counts = tickerData.get(trade.ticker)!;
      counts.total++;
      if (trade.side === 'above-ask') counts.aboveAsk++;
    });

    const result = new Map<string, number>();
    tickerData.forEach((counts, ticker) => {
      result.set(ticker, counts.total > 0 ? (counts.aboveAsk / counts.total) * 100 : 0);
    });

    return result;
  }, [displayTrades]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen -mt-8 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4 flex flex-col">
      {/* Simulated Data Banner */}
      {dataSource === 'fallback' && (
        <div className="bg-yellow-500/20 border border-yellow-500/50 rounded px-3 py-2 mb-4 flex items-center gap-2">
          <AlertCircle size={14} className="text-yellow-600 flex-shrink-0" />
          <span className="text-[10px] font-mono text-yellow-900">
            SIMULATED DATA • Real Polygon.io data unavailable
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
          <h1 className="text-lg font-mono font-bold tracking-widest uppercase text-white">
            Dark Pool Surveillance
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
              <span className="text-[9px] font-mono uppercase text-red-500">Disconnected</span>
            </>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-[#0d0d0d] border border-white/5 p-3 mb-4 flex flex-wrap gap-4 text-[10px] font-mono">
        <div>
          <span className="text-gray-500">Total Notional: </span>
          <span className="text-white font-bold tabular-nums">{formatUsd(displayStats.totalNotional)}</span>
        </div>
        <div>
          <span className="text-gray-500"># Trades: </span>
          <span className="text-white font-bold">{displayStats.totalTrades}</span>
        </div>
        <div>
          <span className="text-gray-500">Top Ticker: </span>
          <span className="text-white font-bold">{displayStats.topTicker}</span>
          {displayStats.topTickerNotional > 0 && (
            <span className="text-gray-500 ml-1">({formatUsd(displayStats.topTickerNotional)})</span>
          )}
        </div>
        <div>
          <span className="text-gray-500">Avg Size: </span>
          <span className="text-white font-bold tabular-nums">
            {formatNumber(displayStats.averageTradeSize, 0)}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-[#0d0d0d] border border-white/5 p-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Ticker Search */}
          <div>
            <label className="text-[9px] font-mono uppercase tracking-widest text-gray-500 block mb-1">
              Ticker Search
            </label>
            <input
              type="text"
              placeholder="Filter by ticker..."
              value={filters.tickerSearch}
              onChange={(e) => setFilters((prev) => ({ ...prev, tickerSearch: e.target.value }))}
              className="w-full px-2 py-1 text-[10px] font-mono bg-[#1a1a1a] border border-white/10 text-white placeholder-gray-600 focus:border-purple-500/30 focus:outline-none transition-colors"
            />
          </div>

          {/* Min Notional Slider */}
          <div>
            <label className="text-[9px] font-mono uppercase tracking-widest text-gray-500 block mb-1">
              Min Notional Value
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1000000"
                step="50000"
                value={filters.minNotional}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, minNotional: parseInt(e.target.value, 10) }))
                }
                className="flex-1 h-2 bg-[#1a1a1a] rounded appearance-none cursor-pointer"
              />
              <span className="text-[10px] font-mono text-gray-400 w-20 text-right">
                {filters.minNotional === 0 ? 'Any' : formatUsd(filters.minNotional)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap Section */}
      <div className="bg-[#0d0d0d] border border-white/5 p-3 mb-4">
        <div className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">
          Dark Pool Activity Heatmap (by notional volume)
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-15 gap-2">
          {heatmapData.length === 0 ? (
            <div className="col-span-full text-[9px] text-gray-600 text-center py-4">
              No activity data
            </div>
          ) : (
            heatmapData.map((item) => {
              const isAccumulating = displayStats.accumulationTickers.includes(item.ticker);
              const intensity = item.intensity;

              // Determine color: green for accumulation, red for distribution, purple gradient for others
              let bgColor = 'bg-purple-500/30';
              if (isAccumulating) {
                bgColor = intensity > 0.7 ? 'bg-emerald-500/60' : 'bg-emerald-500/40';
              } else if (intensity < 0.3) {
                bgColor = 'bg-purple-500/20';
              }

              return (
                <div
                  key={item.ticker}
                  className={cn(
                    'px-2 py-2 rounded border text-center transition-all',
                    bgColor,
                    isAccumulating ? 'border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'border-purple-500/30'
                  )}
                  title={`${item.ticker}: ${formatUsd(item.volume)}`}
                >
                  <div className="text-[9px] font-bold text-white tabular-nums">{item.ticker}</div>
                  <div className="text-[8px] text-gray-300 tabular-nums">
                    {formatNumber(item.volume / 1000, 0)}K
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Trade Table */}
      <div
        className="bg-[#0d0d0d] border border-white/5 overflow-hidden flex flex-col flex-1"
        style={{ minHeight: 'calc(100vh - 500px)' }}
      >
        {/* Table header */}
        <div className="flex items-center px-3 py-1.5 bg-white/[0.02] border-b border-white/5 text-[8px] font-mono uppercase tracking-widest text-gray-500 flex-shrink-0">
          <span className="w-[70px]">Time</span>
          <span className="w-[70px] font-bold text-white">Ticker</span>
          <span className="w-[90px] text-right">Size</span>
          <span className="w-[110px] text-right">Notional ($)</span>
          <span className="w-[80px] text-right">Price</span>
          <span className="w-[90px] text-right">% from Mkt</span>
          <span className="w-[80px] text-center">Venue</span>
          <span className="w-[50px] text-center">Side</span>
        </div>

        {/* Trade rows */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
          {filteredTrades.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
              {connected
                ? filteredTrades.length === 0 && displayTrades.length > 0
                  ? 'No trades match filters'
                  : 'Waiting for dark pool activity...'
                : 'Connecting...'}
            </div>
          ) : (
            filteredTrades.map((trade, idx) => {
              const isAccumulating = displayStats.accumulationTickers.includes(trade.ticker);

              // Side color coding
              const sideColor =
                trade.side === 'above-ask'
                  ? 'bg-emerald-500/[0.08] text-emerald-400'
                  : trade.side === 'below-bid'
                    ? 'bg-red-500/[0.08] text-red-400'
                    : 'bg-gray-500/[0.04] text-gray-400';

              return (
                <div
                  key={`${trade.id}-${idx}`}
                  className={cn(
                    'flex items-center px-3 py-[3px] font-mono text-[10px] border-b border-white/[0.02] transition-colors duration-200 animate-in fade-in slide-in-from-top-1',
                    sideColor
                  )}
                >
                  <span className="w-[70px] text-gray-500 tabular-nums">{formatTime(trade.timestamp)}</span>
                  <span className={cn('w-[70px] font-bold tabular-nums', isAccumulating ? 'text-emerald-400' : 'text-white')}>
                    {trade.ticker}
                    {isAccumulating && <span className="ml-1 text-[7px] bg-emerald-500/30 px-1 py-0.5 rounded text-emerald-400">ACC</span>}
                  </span>
                  <span className="w-[90px] text-right text-gray-300 tabular-nums">
                    {formatNumber(trade.size, 0)}
                  </span>
                  <span className="w-[110px] text-right font-medium text-purple-300 tabular-nums">
                    {formatUsd(trade.notionalValue)}
                  </span>
                  <span className="w-[80px] text-right text-gray-300 tabular-nums">
                    ${formatNumber(trade.price, 2)}
                  </span>
                  <span
                    className={cn('w-[90px] text-right tabular-nums font-medium', {
                      'text-emerald-400': trade.percentFromMarket > 0.1,
                      'text-red-400': trade.percentFromMarket < -0.1,
                      'text-gray-400': trade.percentFromMarket >= -0.1 && trade.percentFromMarket <= 0.1,
                    })}
                  >
                    {trade.percentFromMarket >= 0 ? '+' : ''}{formatNumber(trade.percentFromMarket, 2)}%
                  </span>
                  <span className="w-[80px] text-center text-[9px] text-gray-400 truncate">{trade.venue}</span>
                  <span
                    className={cn(
                      'w-[50px] text-center text-[8px] uppercase font-bold px-1 py-0.5 rounded',
                      trade.side === 'above-ask'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : trade.side === 'below-bid'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-gray-400'
                    )}
                  >
                    {trade.side === 'above-ask' ? 'Ask+' : trade.side === 'below-bid' ? 'Bid-' : 'Mid'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-[#0d0d0d] border border-white/5 border-t-0 px-3 py-2 flex flex-wrap gap-6 text-[9px] font-mono text-gray-400 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded bg-emerald-500/50" />
          <span>Above Ask (Accumulation)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded bg-red-500/50" />
          <span>Below Bid (Distribution)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded bg-gray-500/50" />
          <span>Mid (Neutral)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] bg-emerald-500/30 px-1 py-0.5 rounded text-emerald-400">ACC</span>
          <span>20%+ Accumulation</span>
        </div>
      </div>
    </div>
  );
};
