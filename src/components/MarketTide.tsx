'use client';

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SectorData {
  sector: string;
  etf: string;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  sentimentScore: number;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
}

interface TopTicker {
  symbol: string;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  totalVolume: number;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sector: string | null;
}

interface IndexItem {
  symbol: string;
  price: number | null;
  change: number | null;
  sentiment: string;
}

interface MarketTideData {
  source: 'polygon' | 'fallback';
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sentimentStrength: string;
  netPremium: number;
  callPct: number;
  putPct: number;
  totalCallPremium: number;
  totalPutPremium: number;
  vix: number | null;
  totalOptionsVolume: number;
  sectors: SectorData[];
  topTickers: TopTicker[];
  indexStrip: IndexItem[];
  lastUpdated: string;
}

// ─── Sentiment Arc Gauge ──────────────────────────────────────────────────────

interface SentimentGaugeProps {
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  strength: string;
  netPremium: number;
}

function SentimentGauge({ sentiment, strength, netPremium }: SentimentGaugeProps) {
  // Parse strength percentage
  const strengthNum = parseInt(strength, 10) || 0;
  const angle = sentiment === 'Bullish' ? -45 + (strengthNum / 100) * 90 :
                sentiment === 'Bearish' ? 225 - (strengthNum / 100) * 90 : 0;

  const gaugeColor =
    sentiment === 'Bullish' ? 'from-green-500 to-green-600' :
    sentiment === 'Bearish' ? 'from-red-500 to-red-600' :
    'from-amber-500 to-amber-600';

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-40 h-20">
        {/* SVG Arc Gauge */}
        <svg
          viewBox="0 0 200 110"
          className="w-full h-full"
          style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))' }}
        >
          {/* Background arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />

          {/* Green (Bullish) zone */}
          <path
            d="M 100 100 A 80 80 0 0 1 180 100"
            stroke="rgba(34,197,94,0.4)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />

          {/* Red (Bearish) zone */}
          <path
            d="M 20 100 A 80 80 0 0 1 100 100"
            stroke="rgba(239,68,68,0.4)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />

          {/* Active gauge indicator */}
          <path
            d="M 100 100 A 80 80 0 0 1 180 100"
            stroke={sentiment === 'Bullish' ? '#22c55e' : sentiment === 'Bearish' ? '#ef4444' : '#f59e0b'}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(180 / 360) * (Math.PI * 160)} ${(Math.PI * 160)}`}
            strokeDashoffset={sentiment === 'Bullish' ? 0 : sentiment === 'Bearish' ? -(180 / 360) * (Math.PI * 160) : 0}
            style={{ opacity: 0.7 }}
          />

          {/* Needle */}
          <line
            x1="100"
            y1="100"
            x2={100 + 70 * Math.cos((angle - 90) * (Math.PI / 180))}
            y2={100 + 70 * Math.sin((angle - 90) * (Math.PI / 180))}
            stroke="#f7931a"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />

          {/* Center dot */}
          <circle cx="100" cy="100" r="4" fill="#f7931a" />

          {/* Labels */}
          <text x="30" y="25" fontSize="10" fill="rgba(255,255,255,0.5)" fontFamily="monospace">
            BEARISH
          </text>
          <text x="150" y="25" fontSize="10" fill="rgba(255,255,255,0.5)" fontFamily="monospace" textAnchor="end">
            BULLISH
          </text>
        </svg>
      </div>

      <div className="text-center space-y-1">
        <p className="text-xs font-mono text-gray-400">Net Premium</p>
        <p className={cn(
          'text-lg font-mono font-bold',
          netPremium > 0 ? 'text-green-400' : netPremium < 0 ? 'text-red-400' : 'text-amber-400'
        )}>
          ${netPremium >= 0 ? '+' : ''}{netPremium.toFixed(1)}M
        </p>
      </div>
    </div>
  );
}

// ─── Index Strip ──────────────────────────────────────────────────────────────

interface IndexStripProps {
  indices: IndexItem[];
}

function IndexStrip({ indices }: IndexStripProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {indices.map(idx => (
        <div
          key={idx.symbol}
          className="border border-gray-700 rounded-lg p-3 bg-gray-900/50"
        >
          <p className="text-xs font-mono text-gray-400 mb-2">{idx.symbol}</p>
          <p className="text-sm font-mono font-bold text-white mb-2">
            {idx.price ? `$${idx.price.toFixed(2)}` : '—'}
          </p>
          <div className="flex items-center gap-1">
            {idx.sentiment === 'Bullish' ? (
              <>
                <TrendingUp size={12} className="text-green-400" />
                <span className="text-xs font-mono text-green-400">BULLISH</span>
              </>
            ) : idx.sentiment === 'Bearish' ? (
              <>
                <TrendingDown size={12} className="text-red-400" />
                <span className="text-xs font-mono text-red-400">BEARISH</span>
              </>
            ) : (
              <span className="text-xs font-mono text-amber-400">NEUTRAL</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── VIX + Volume Cards ───────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  color: 'green' | 'red' | 'yellow' | 'blue' | 'gray';
}

function StatCard({ label, value, color }: StatCardProps) {
  const colorMap = {
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    blue: 'text-blue-400',
    gray: 'text-gray-400',
  };

  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
      <p className="text-xs font-mono text-gray-500 mb-1">{label}</p>
      <p className={cn('text-sm font-mono font-bold', colorMap[color])}>
        {value}
      </p>
    </div>
  );
}

// ─── Sector Heatmap ────────────────────────────────────────────────────────────

interface SectorHeatmapProps {
  sectors: SectorData[];
  selectedSector: string | null;
  onSelectSector: (sector: string | null) => void;
}

function SectorHeatmap({ sectors, selectedSector, onSelectSector }: SectorHeatmapProps) {
  const getSentimentColor = (sentiment: string, strength: number) => {
    const opacity = 0.2 + Math.abs(strength) * 0.8;
    if (sentiment === 'Bullish') return `rgba(34, 197, 94, ${opacity})`;
    if (sentiment === 'Bearish') return `rgba(239, 68, 68, ${opacity})`;
    return `rgba(245, 158, 11, ${opacity})`;
  };

  const getBgClass = (sentiment: string, selected: boolean) => {
    if (selected) {
      if (sentiment === 'Bullish') return 'bg-green-500/30 border-green-500';
      if (sentiment === 'Bearish') return 'bg-red-500/30 border-red-500';
      return 'bg-amber-500/30 border-amber-500';
    }
    return 'bg-gray-900/50 border-gray-700 hover:border-gray-600';
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {sectors.map(sector => (
        <button
          key={sector.sector}
          onClick={() => onSelectSector(selectedSector === sector.sector ? null : sector.sector)}
          className={cn(
            'border rounded-lg p-3 text-left transition-all',
            getBgClass(sector.sentiment, selectedSector === sector.sector)
          )}
        >
          <p className="text-xs font-mono text-gray-400 mb-1">{sector.etf}</p>
          <p className="text-xs font-mono font-bold mb-2">
            {sector.sector.substring(0, 12)}
          </p>
          <p className={cn(
            'text-xs font-mono font-bold',
            sector.sentiment === 'Bullish' ? 'text-green-400' :
            sector.sentiment === 'Bearish' ? 'text-red-400' :
            'text-amber-400'
          )}>
            {sector.sentiment}
          </p>
        </button>
      ))}
    </div>
  );
}

// ─── Top Tickers Table ─────────────────────────────────────────────────────────

interface TopTickersProps {
  tickers: TopTicker[];
  filterSector: string | null;
}

function TopTickers({ tickers, filterSector }: TopTickersProps) {
  const filtered = filterSector
    ? tickers.filter(t => t.sector === filterSector)
    : tickers;

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-900/50">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-900/80">
            <th className="px-3 py-2 text-left text-gray-400">SYMBOL</th>
            <th className="px-3 py-2 text-right text-gray-400">CALL</th>
            <th className="px-3 py-2 text-right text-gray-400">PUT</th>
            <th className="px-3 py-2 text-right text-gray-400">NET</th>
            <th className="px-3 py-2 text-right text-gray-400">VOL</th>
            <th className="px-3 py-2 text-center text-gray-400">SENTIMENT</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 10).map((ticker, idx) => (
            <tr key={ticker.symbol} className={idx % 2 === 0 ? 'bg-gray-900/30' : ''}>
              <td className="px-3 py-2 text-white font-bold">{ticker.symbol}</td>
              <td className="px-3 py-2 text-right text-green-400">
                ${(ticker.callPremium / 1_000_000).toFixed(1)}M
              </td>
              <td className="px-3 py-2 text-right text-red-400">
                ${(ticker.putPremium / 1_000_000).toFixed(1)}M
              </td>
              <td className={cn(
                'px-3 py-2 text-right font-bold',
                ticker.netPremium > 0 ? 'text-green-400' : 'text-red-400'
              )}>
                ${(ticker.netPremium / 1_000_000).toFixed(1)}M
              </td>
              <td className="px-3 py-2 text-right text-gray-400">
                {(ticker.totalVolume / 1000).toFixed(0)}K
              </td>
              <td className="px-3 py-2 text-center">
                <span className={cn(
                  'px-2 py-1 rounded text-xs font-bold',
                  ticker.sentiment === 'Bullish' ? 'bg-green-500/20 text-green-400' :
                  ticker.sentiment === 'Bearish' ? 'bg-red-500/20 text-red-400' :
                  'bg-amber-500/20 text-amber-400'
                )}>
                  {ticker.sentiment.substring(0, 1)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export const MarketTide = () => {
  const [data, setData] = useState<MarketTideData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/market-tide');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('[MarketTide] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60_000); // Refresh every 60 seconds

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={24} className="animate-spin text-btc-orange" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-red-400 font-mono text-sm">
        Failed to load Market Tide data
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
            <p className="text-xs font-mono font-bold text-yellow-400">ESTIMATED DATA MODE</p>
            <p className="text-[10px] font-mono text-yellow-600">
              Set POLYGON_API_KEY in Vercel environment variables for real options flow data.
            </p>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Sentiment Gauge */}
        <div className="lg:col-span-1">
          <SentimentGauge
            sentiment={data.sentiment}
            strength={data.sentimentStrength}
            netPremium={data.netPremium}
          />
        </div>

        {/* Right: Stats */}
        <div className="lg:col-span-2 space-y-4">
          {/* Index Strip */}
          <IndexStrip indices={data.indexStrip} />

          {/* VIX + Volume */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="VIX"
              value={data.vix ? data.vix.toFixed(2) : '—'}
              color={
                !data.vix ? 'gray' :
                data.vix < 15 ? 'green' :
                data.vix < 25 ? 'yellow' :
                'red'
              }
            />
            <StatCard
              label="Options Vol"
              value={`${(data.totalOptionsVolume / 1_000_000).toFixed(1)}M`}
              color="blue"
            />
            <StatCard
              label="Call %"
              value={`${data.callPct.toFixed(0)}%`}
              color="green"
            />
            <StatCard
              label="Put %"
              value={`${data.putPct.toFixed(0)}%`}
              color="red"
            />
          </div>
        </div>
      </div>

      {/* Sector Heatmap */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
          Sector Sentiment
        </h3>
        <SectorHeatmap
          sectors={data.sectors}
          selectedSector={selectedSector}
          onSelectSector={setSelectedSector}
        />
      </div>

      {/* Top Tickers Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
            Top Tickers by Premium
          </h3>
          {selectedSector && (
            <button
              onClick={() => setSelectedSector(null)}
              className="text-xs font-mono text-btc-orange hover:text-orange-300"
            >
              Clear filter
            </button>
          )}
        </div>
        <TopTickers tickers={data.topTickers} filterSector={selectedSector} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 pt-4 border-t border-gray-800">
        <span>
          {data.source === 'polygon' ? 'POLYGON.IO' : 'ESTIMATED'}
        </span>
        <span>
          {new Date(data.lastUpdated).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};
