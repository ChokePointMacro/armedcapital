'use client';

import React, { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TermStructureItem {
  expiry: string;
  daysToExpiry: number;
  iv: number;
}

interface VolatilityData {
  symbol: string;
  source: 'polygon' | 'simulated';
  ivRank: number;
  ivPercentile: number;
  currentIV: number;
  hv30d: number;
  hv60d: number;
  ivHvSpread: number;
  termStructure: TermStructureItem[];
  strategyHint: string;
  lastUpdated: string;
}

const IVRankGauge = ({ ivRank }: { ivRank: number }) => {
  // Determine color based on IV Rank
  const getGaugeColor = () => {
    if (ivRank > 70) return '#ef4444'; // red for high IV
    if (ivRank < 30) return '#22c55e'; // green for low IV
    return '#f59e0b'; // orange for neutral
  };

  const getGaugeLabel = () => {
    if (ivRank > 70) return 'High IV';
    if (ivRank < 30) return 'Low IV';
    return 'Neutral IV';
  };

  // Calculate percentile text
  const getPercentile = () => {
    if (ivRank > 70) return 'Upper';
    if (ivRank < 30) return 'Lower';
    return 'Middle';
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="relative w-48 h-32">
        {/* SVG Arc Gauge */}
        <svg
          viewBox="0 0 200 120"
          className="w-full h-full"
          style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))' }}
        >
          {/* Background arc */}
          <path
            d="M 20 110 A 90 90 0 0 1 180 110"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
          />

          {/* Green (Low IV) zone */}
          <path
            d="M 20 110 A 90 90 0 0 1 60 45"
            stroke="rgba(34,197,94,0.4)"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
          />

          {/* Red (High IV) zone */}
          <path
            d="M 140 45 A 90 90 0 0 1 180 110"
            stroke="rgba(239,68,68,0.4)"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
          />

          {/* Active indicator */}
          <path
            d="M 20 110 A 90 90 0 0 1 180 110"
            stroke={getGaugeColor()}
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(ivRank / 100) * (Math.PI * 180)} ${Math.PI * 180}`}
            style={{ opacity: 0.8 }}
          />

          {/* Needle */}
          <line
            x1="100"
            y1="110"
            x2={100 + 75 * Math.cos(((ivRank / 100) * 180 - 90) * (Math.PI / 180))}
            y2={110 + 75 * Math.sin(((ivRank / 100) * 180 - 90) * (Math.PI / 180))}
            stroke="#f7931a"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />

          {/* Center dot */}
          <circle cx="100" cy="110" r="5" fill="#f7931a" />

          {/* Labels */}
          <text x="25" y="35" fontSize="11" fill="rgba(255,255,255,0.5)" fontFamily="monospace" fontWeight="bold">
            LOW
          </text>
          <text x="155" y="35" fontSize="11" fill="rgba(255,255,255,0.5)" fontFamily="monospace" fontWeight="bold" textAnchor="end">
            HIGH
          </text>
        </svg>
      </div>

      <div className="text-center space-y-2 w-full">
        <p className="text-lg font-mono font-bold" style={{ color: getGaugeColor() }}>
          IV Rank: {ivRank}
        </p>
        <p className="text-xs font-mono text-gray-400">
          {getPercentile()} {getPercentile() === 'Upper' ? '70-100%' : getPercentile() === 'Lower' ? '0-30%' : '30-70%'} of 52-week range
        </p>
      </div>
    </div>
  );
};

export const VolatilityTab = ({ symbol }: { symbol: string }) => {
  const [data, setData] = useState<VolatilityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVolatility = async () => {
      try {
        setLoading(true);
        const response = (await apiFetch(`/api/volatility/${symbol}`)) as VolatilityData;
        setData(response);
      } catch (error) {
        console.error(`[VolatilityTab] Error fetching volatility for ${symbol}:`, error);
      } finally {
        setLoading(false);
      }
    };

    if (symbol) {
      fetchVolatility();
    }
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-btc-orange" size={32} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-red-400 font-mono text-sm">
        Failed to load volatility data
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Simulated Data Banner */}
      {data.source === 'simulated' && (
        <div className="p-3 border border-yellow-500/40 bg-yellow-500/10 rounded-lg flex items-center gap-3">
          <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-xs font-mono font-bold text-yellow-400">SIMULATED DATA MODE</p>
            <p className="text-[10px] font-mono text-yellow-600">
              Set POLYGON_API_KEY in environment variables for real options data.
            </p>
          </div>
        </div>
      )}

      {/* IV Rank Gauge */}
      <div className="bg-gray-900/50 border border-gray-800 rounded p-6">
        <IVRankGauge ivRank={data.ivRank} />
      </div>

      {/* IV vs HV Comparison Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900/50 border border-gray-800 rounded p-4 space-y-2">
          <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Current IV</p>
          <p className="text-2xl font-mono font-bold text-btc-orange">
            {data.currentIV.toFixed(1)}%
          </p>
          <p className="text-[10px] font-mono text-gray-600">Implied Volatility</p>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded p-4 space-y-2">
          <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">30D HV</p>
          <p className="text-2xl font-mono font-bold text-blue-400">
            {data.hv30d.toFixed(1)}%
          </p>
          <p className="text-[10px] font-mono text-gray-600">Historical Volatility</p>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded p-4 space-y-2">
          <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">IV-HV Spread</p>
          <p
            className={cn(
              'text-2xl font-mono font-bold',
              data.ivHvSpread > 0 ? 'text-green-400' : data.ivHvSpread < 0 ? 'text-red-400' : 'text-gray-400'
            )}
          >
            {data.ivHvSpread > 0 ? '+' : ''}{data.ivHvSpread.toFixed(1)}%
          </p>
          <p className="text-[10px] font-mono text-gray-600">IV Premium Over HV</p>
        </div>
      </div>

      {/* IV Term Structure Chart */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
          IV Term Structure
        </h3>
        <div className="bg-gray-900/50 border border-gray-800 rounded p-4">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.termStructure}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="expiry" stroke="rgba(255,255,255,0.5)" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <YAxis stroke="rgba(255,255,255,0.5)" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(17, 24, 39)',
                  border: '1px solid rgb(55, 65, 81)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                }}
                formatter={(value) => [`${(value as number).toFixed(1)}%`, 'IV']}
                labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
              />
              <Bar
                dataKey="iv"
                fill="#f7931a"
                isAnimationActive={true}
                animationDuration={800}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Volatility Stats Grid */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
          Volatility Stats
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="IV Rank" value={`${data.ivRank}`} suffix="%" color="btc-orange" />
          <StatCard label="IV Percentile" value={`${data.ivPercentile}`} suffix="%" color="blue" />
          <StatCard label="Current IV" value={`${data.currentIV.toFixed(1)}`} suffix="%" color="green" />
          <StatCard label="30D HV" value={`${data.hv30d.toFixed(1)}`} suffix="%" color="cyan" />
          <StatCard label="60D HV" value={`${data.hv60d.toFixed(1)}`} suffix="%" color="purple" />
          <StatCard
            label="IV/HV Ratio"
            value={`${(data.currentIV / data.hv30d).toFixed(2)}`}
            suffix="x"
            color={data.currentIV / data.hv30d > 1 ? 'green' : 'red'}
          />
        </div>
      </div>

      {/* Strategy Suggestion */}
      <div
        className={cn(
          'border rounded-lg p-4 space-y-2',
          data.ivRank > 70
            ? 'border-red-500/40 bg-red-500/10'
            : data.ivRank < 30
              ? 'border-green-500/40 bg-green-500/10'
              : 'border-amber-500/40 bg-amber-500/10'
        )}
      >
        <p className="text-xs font-mono font-bold text-gray-300">Strategy Suggestion</p>
        <p
          className={cn(
            'text-sm font-mono',
            data.ivRank > 70
              ? 'text-red-400'
              : data.ivRank < 30
                ? 'text-green-400'
                : 'text-amber-400'
          )}
        >
          {data.strategyHint}
        </p>
      </div>

      {/* Footer */}
      <div className="text-[10px] font-mono text-gray-600 text-right pt-4 border-t border-gray-800">
        {data.source === 'polygon' ? 'Polygon.io' : 'Simulated'} • {new Date(data.lastUpdated).toLocaleTimeString()}
      </div>
    </div>
  );
};
