'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { relativeTime, formatUsd } from '@/lib/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Greeks {
  delta: number;
  gamma: number;
  iv: number;
}

interface SignalAlert {
  ticker: string;
  strike: number;
  expiry: string;
  premium: number;
  volOiRatio: number;
  tradeType: 'Call' | 'Put';
  sentiment: 'Bullish' | 'Bearish';
  score: number;
  greeks: Greeks;
  timestamp: string;
  interpretation: string;
}

interface SignalsResponse {
  source: 'polygon' | 'fallback';
  alerts: SignalAlert[];
  totalUnusualCallPremium: number;
  totalUnusualPutPremium: number;
  topAlertedTickers: { ticker: string; count: number }[];
  lastUpdated: string;
}

interface FilterState {
  minScore: number;
  typeFilter: 'all' | 'calls' | 'puts';
  sectorFilter: string | null;
}

// ─── Sector Mapping ───────────────────────────────────────────────────────────

const TICKER_SECTORS: Record<string, string> = {
  'AAPL': 'Technology',
  'MSFT': 'Technology',
  'NVDA': 'Technology',
  'AMD': 'Technology',
  'META': 'Communications',
  'GOOGL': 'Communications',
  'NFLX': 'Communications',
  'AMZN': 'Consumer',
  'TSLA': 'Consumer',
  'MSTR': 'Technology',
  'SPY': 'Broad Market',
  'QQQ': 'Broad Market',
  'IWM': 'Broad Market',
  'DIA': 'Broad Market',
  'XLK': 'Technology',
  'XLF': 'Finance',
  'XLE': 'Energy',
  'XLV': 'Healthcare',
  'XLI': 'Industrial',
  'XLY': 'Consumer',
  'XLP': 'Staples',
  'XLU': 'Utilities',
  'XLRE': 'Real Estate',
  'XLC': 'Communications',
  'XLB': 'Materials',
};

// ─── Alert Card Component ─────────────────────────────────────────────────────

interface AlertCardProps {
  alert: SignalAlert;
}

function AlertCard({ alert }: AlertCardProps) {
  const isHighScore = alert.score >= 8;
  const isCall = alert.tradeType === 'Call';

  const getScoreBadgeColor = () => {
    if (alert.score >= 7) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (alert.score >= 4) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  return (
    <div
      className={cn(
        'border rounded-lg p-4 bg-[#111118] transition-all',
        isHighScore
          ? 'border-[#f7931a]/40 shadow-[0_0_12px_rgba(247,147,26,0.2)]'
          : 'border-gray-800 hover:border-gray-700'
      )}
    >
      {/* Header: Ticker + Strike + Expiry + Score Badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <h3 className="text-lg font-mono font-bold text-white">
              {alert.ticker}
            </h3>
            <span className="text-sm font-mono text-gray-400">
              ${alert.strike.toFixed(2)}{alert.tradeType === 'Call' ? 'C' : 'P'}
            </span>
            <span className="text-xs font-mono text-gray-500">
              exp {alert.expiry}
            </span>
          </div>
        </div>

        <div className={cn('px-2.5 py-1.5 rounded border text-center text-sm font-mono font-bold', getScoreBadgeColor())}>
          {alert.score.toFixed(1)}
        </div>
      </div>

      {/* Premium + Vol/OI + Trade Type Row */}
      <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-gray-800">
        <div>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">
            Premium
          </p>
          <p className="text-sm font-mono font-bold text-[#f7931a]">
            {formatUsd(alert.premium)}
          </p>
        </div>

        <div>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">
            Vol/OI
          </p>
          <p className="text-sm font-mono font-bold text-gray-300">
            {alert.volOiRatio.toFixed(2)}x
          </p>
        </div>

        <div>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">
            Type
          </p>
          <div className="flex items-center gap-1.5">
            {isCall ? (
              <>
                <TrendingUp size={14} className="text-emerald-400" />
                <span className="text-sm font-mono font-bold text-emerald-400">
                  CALL
                </span>
              </>
            ) : (
              <>
                <TrendingDown size={14} className="text-red-400" />
                <span className="text-sm font-mono font-bold text-red-400">
                  PUT
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Greeks Row */}
      <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-gray-800 text-xs font-mono">
        <div>
          <p className="text-gray-500 mb-1">Δ (Delta)</p>
          <p className="text-gray-300 font-bold">
            {alert.greeks.delta > 0 ? '+' : ''}{alert.greeks.delta.toFixed(3)}
          </p>
        </div>

        <div>
          <p className="text-gray-500 mb-1">Γ (Gamma)</p>
          <p className="text-gray-300 font-bold">
            {alert.greeks.gamma.toFixed(5)}
          </p>
        </div>

        <div>
          <p className="text-gray-500 mb-1">IV</p>
          <p className="text-gray-300 font-bold">
            {(alert.greeks.iv * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Interpretation */}
      <div className="mb-3">
        <p className="text-xs leading-relaxed text-gray-400 italic">
          {alert.interpretation}
        </p>
      </div>

      {/* Footer: Timestamp */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-800">
        <span className="text-[9px] font-mono text-gray-600">
          {relativeTime(alert.timestamp)}
        </span>
        <span className="text-[9px] font-mono text-gray-600">
          {new Date(alert.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}

// ─── Summary Stats Section ────────────────────────────────────────────────────

interface SummaryStatsProps {
  totalCallPremium: number;
  totalPutPremium: number;
  topTickers: { ticker: string; count: number }[];
}

function SummaryStats({ totalCallPremium, totalPutPremium, topTickers }: SummaryStatsProps) {
  const netPremium = totalCallPremium - totalPutPremium;

  return (
    <div className="space-y-3 mb-6">
      {/* Premium Summary */}
      <div className="border border-gray-800 rounded-lg bg-[#111118] p-4">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">
          Unusual Premium Summary
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[9px] font-mono text-gray-500 mb-1">CALL PREMIUM</p>
            <p className="text-sm font-mono font-bold text-emerald-400">
              {formatUsd(totalCallPremium)}
            </p>
          </div>

          <div>
            <p className="text-[9px] font-mono text-gray-500 mb-1">PUT PREMIUM</p>
            <p className="text-sm font-mono font-bold text-red-400">
              {formatUsd(totalPutPremium)}
            </p>
          </div>

          <div>
            <p className="text-[9px] font-mono text-gray-500 mb-1">NET</p>
            <p className={cn(
              'text-sm font-mono font-bold',
              netPremium > 0 ? 'text-emerald-400' : 'text-red-400'
            )}>
              {netPremium > 0 ? '+' : ''}{formatUsd(netPremium)}
            </p>
          </div>
        </div>
      </div>

      {/* Top Alerted Tickers */}
      {topTickers.length > 0 && (
        <div className="border border-gray-800 rounded-lg bg-[#111118] p-4">
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">
            Most Alerted Tickers
          </p>

          <div className="flex flex-wrap gap-2">
            {topTickers.map(({ ticker, count }) => (
              <div
                key={ticker}
                className="px-3 py-1 bg-[#0a0a0f] border border-[#f7931a]/30 rounded-full"
              >
                <span className="text-xs font-mono font-bold text-[#f7931a]">
                  {ticker}
                </span>
                <span className="text-xs font-mono text-gray-500 ml-1">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter Bar Component ─────────────────────────────────────────────────────

interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  sectors: string[];
}

function FilterBar({ filters, onFiltersChange, sectors }: FilterBarProps) {
  return (
    <div className="border border-gray-800 rounded-lg bg-[#111118] p-4 mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Min Score Slider */}
        <div>
          <label className="text-xs font-mono text-gray-500 uppercase tracking-wider block mb-2">
            Min Score
          </label>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="10"
              step="0.5"
              value={filters.minScore}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  minScore: parseFloat(e.target.value),
                })
              }
              className="flex-1 h-2 bg-gray-800 rounded appearance-none cursor-pointer accent-[#f7931a]"
            />

            <span className="text-sm font-mono font-bold text-[#f7931a] w-12 text-right">
              {filters.minScore.toFixed(1)}
            </span>
          </div>
        </div>

        {/* Call/Put Toggle */}
        <div>
          <label className="text-xs font-mono text-gray-500 uppercase tracking-wider block mb-2">
            Type
          </label>

          <div className="flex gap-2">
            {(['all', 'calls', 'puts'] as const).map((type) => (
              <button
                key={type}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    typeFilter: type,
                  })
                }
                className={cn(
                  'flex-1 px-2 py-1 text-xs font-mono uppercase tracking-wide border rounded transition-colors',
                  filters.typeFilter === type
                    ? type === 'calls'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : type === 'puts'
                        ? 'border-red-500/50 bg-red-500/10 text-red-400'
                        : 'border-[#f7931a]/50 bg-[#f7931a]/10 text-[#f7931a]'
                    : 'border-gray-700 text-gray-500 hover:text-gray-300'
                )}
              >
                {type === 'all' ? 'All' : type === 'calls' ? 'Calls' : 'Puts'}
              </button>
            ))}
          </div>
        </div>

        {/* Sector Dropdown */}
        <div>
          <label className="text-xs font-mono text-gray-500 uppercase tracking-wider block mb-2">
            Sector
          </label>

          <select
            value={filters.sectorFilter || ''}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                sectorFilter: e.target.value || null,
              })
            }
            className="w-full px-2 py-1 text-xs font-mono bg-[#0a0a0f] border border-gray-700 text-gray-300 rounded hover:border-gray-600 focus:border-[#f7931a]/50 focus:outline-none transition-colors"
          >
            <option value="">All Sectors</option>
            {sectors.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const FlowAlerts = () => {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    minScore: 4,
    typeFilter: 'all',
    sectorFilter: null,
  });

  // Fetch signals
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/signals');
        const json = (await res.json()) as SignalsResponse;
        setData(json);
        setLastRefresh(new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }));
      } catch (err) {
        console.error('[FlowAlerts] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60_000); // Refresh every 60 seconds

    return () => clearInterval(interval);
  }, []);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    if (!data) return [];

    return data.alerts.filter((alert) => {
      // Score filter
      if (alert.score < filters.minScore) return false;

      // Type filter
      if (filters.typeFilter === 'calls' && alert.tradeType !== 'Call') return false;
      if (filters.typeFilter === 'puts' && alert.tradeType !== 'Put') return false;

      // Sector filter
      if (filters.sectorFilter) {
        const sector = TICKER_SECTORS[alert.ticker];
        if (sector !== filters.sectorFilter) return false;
      }

      return true;
    });
  }, [data, filters]);

  // Get unique sectors from alerts
  const uniqueSectors = useMemo(() => {
    if (!data) return [];
    const sectors = new Set<string>();
    for (const alert of data.alerts) {
      const sector = TICKER_SECTORS[alert.ticker];
      if (sector) sectors.add(sector);
    }
    return Array.from(sectors).sort();
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={24} className="animate-spin text-[#f7931a]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-red-400 font-mono text-sm">
        Failed to load Flow Alerts data
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Fallback Warning Banner */}
      {data.source === 'fallback' && (
        <div className="p-3 border border-yellow-500/40 bg-yellow-500/10 rounded-lg flex items-center gap-3">
          <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-xs font-mono font-bold text-yellow-400">SIMULATED DATA</p>
            <p className="text-[10px] font-mono text-yellow-600">
              Set POLYGON_API_KEY in environment variables for real options flow signals.
            </p>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <SummaryStats
        totalCallPremium={data.totalUnusualCallPremium}
        totalPutPremium={data.totalUnusualPutPremium}
        topTickers={data.topAlertedTickers}
      />

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        sectors={uniqueSectors}
      />

      {/* Alert Cards Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
            Unusual Activity Alerts ({filteredAlerts.length})
          </h3>

          <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
            {lastRefresh && <span>Last refresh: {lastRefresh}</span>}
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="border border-gray-800 rounded-lg bg-[#111118] p-8 text-center">
            <p className="text-sm font-mono text-gray-500">
              {data.alerts.length === 0
                ? 'No unusual activity detected'
                : 'No alerts match current filters'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAlerts.map((alert, idx) => (
              <AlertCard
                key={`${alert.ticker}-${alert.strike}-${alert.expiry}-${idx}`}
                alert={alert}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 pt-4 border-t border-gray-800">
        <span>
          {data.source === 'polygon' ? 'POLYGON.IO' : 'SIMULATED'}
        </span>
        <span>
          {new Date(data.lastUpdated).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
};
