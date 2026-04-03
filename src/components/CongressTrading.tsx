'use client';

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Users,
  RefreshCw,
  Loader2,
  Search,
  Filter,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CongressTrade {
  id: string;
  politician: string;
  party: 'D' | 'R';
  chamber: 'House' | 'Senate';
  ticker: string;
  transactionType: 'Purchase' | 'Sale';
  amountRange: string;
  transactionDate: string;
  disclosureDate: string;
}

interface InsiderTrade {
  id: string;
  insiderName: string;
  title: string;
  ticker: string;
  transactionType: 'Buy' | 'Sale';
  shares: number;
  value: number;
  transactionDate: string;
  formType: 'Form 4' | 'Form 5';
}

interface CongressDataResponse {
  source: 'quiver' | 'fallback';
  congressionalTrades: CongressTrade[];
  insiderTrades: InsiderTrade[];
  lastUpdated: string;
}

// ─── Stats Bar ─────────────────────────────────────────────────────────────

interface StatsBarProps {
  trades: CongressTrade[];
}

function StatsBar({ trades }: StatsBarProps) {
  // Count buys and sells this month
  const now = new Date();
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const monthTrades = trades.filter(
    t => new Date(t.disclosureDate) >= monthAgo,
  );

  const buys = monthTrades.filter(t => t.transactionType === 'Purchase').length;
  const sells = monthTrades.filter(t => t.transactionType === 'Sale').length;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
        <p className="text-xs font-mono text-gray-400 mb-1">BUY (This Month)</p>
        <p className="text-lg font-mono font-bold text-green-400">{buys}</p>
      </div>
      <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
        <p className="text-xs font-mono text-gray-400 mb-1">SELL (This Month)</p>
        <p className="text-lg font-mono font-bold text-red-400">{sells}</p>
      </div>
    </div>
  );
}

// ─── Most Traded Badges ────────────────────────────────────────────────────

interface MostTradedProps {
  trades: CongressTrade[];
}

function MostTraded({ trades }: MostTradedProps) {
  // Count trades per ticker
  const tickerCounts: Record<string, number> = {};
  for (const trade of trades) {
    tickerCounts[trade.ticker] = (tickerCounts[trade.ticker] || 0) + 1;
  }

  const top5 = Object.entries(tickerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-2">
      <p className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
        Most Traded by Congress
      </p>
      <div className="flex flex-wrap gap-2">
        {top5.map(([ticker, count]) => (
          <div
            key={ticker}
            className="px-3 py-1 rounded-full border border-btc-orange/40 bg-btc-orange/10"
          >
            <span className="text-xs font-mono text-btc-orange">
              {ticker} ({count})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Congressional Trades Table ────────────────────────────────────────────

interface CongressTableProps {
  trades: CongressTrade[];
  filters: {
    party?: 'D' | 'R' | null;
    chamber?: 'House' | 'Senate' | null;
    type?: 'Purchase' | 'Sale' | null;
    ticker?: string;
  };
}

function CongressTable({ trades, filters }: CongressTableProps) {
  let filtered = trades;

  if (filters.party) filtered = filtered.filter(t => t.party === filters.party);
  if (filters.chamber) filtered = filtered.filter(t => t.chamber === filters.chamber);
  if (filters.type) filtered = filtered.filter(t => t.transactionType === filters.type);
  if (filters.ticker) {
    const query = filters.ticker.toUpperCase();
    filtered = filtered.filter(
      t =>
        t.ticker.includes(query) ||
        t.politician.toUpperCase().includes(query),
    );
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-900/50">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-900/80">
            <th className="px-3 py-2 text-left text-gray-400">DATE</th>
            <th className="px-3 py-2 text-left text-gray-400">POLITICIAN</th>
            <th className="px-3 py-2 text-center text-gray-400">PARTY</th>
            <th className="px-3 py-2 text-center text-gray-400">CHAMBER</th>
            <th className="px-3 py-2 text-left text-gray-400">TICKER</th>
            <th className="px-3 py-2 text-center text-gray-400">TYPE</th>
            <th className="px-3 py-2 text-left text-gray-400">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 30).map((trade, idx) => (
            <tr
              key={trade.id}
              className={idx % 2 === 0 ? 'bg-gray-900/30' : ''}
            >
              <td className="px-3 py-2 text-gray-400">
                {new Date(trade.disclosureDate).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-white">{trade.politician}</td>
              <td className="px-3 py-2 text-center">
                <span
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-bold',
                    trade.party === 'D'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-red-500/20 text-red-400',
                  )}
                >
                  {trade.party}
                </span>
              </td>
              <td className="px-3 py-2 text-center text-gray-400">
                {trade.chamber.substring(0, 1)}
              </td>
              <td className="px-3 py-2 font-bold text-white">{trade.ticker}</td>
              <td className="px-3 py-2 text-center">
                {trade.transactionType === 'Purchase' ? (
                  <div className="flex items-center justify-center gap-1">
                    <TrendingUp size={12} className="text-green-400" />
                    <span className="text-green-400">BUY</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1">
                    <TrendingDown size={12} className="text-red-400" />
                    <span className="text-red-400">SELL</span>
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-gray-300">{trade.amountRange}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <div className="p-6 text-center text-gray-400 text-xs font-mono">
          No trades match filters
        </div>
      )}
    </div>
  );
}

// ─── Insider Trades Table with Cluster Detection ────────────────────────────

interface InsiderTableProps {
  trades: InsiderTrade[];
}

function InsiderTable({ trades }: InsiderTableProps) {
  // Detect clusters: 3+ insider buys in 30 days per ticker
  const tickerBuyClusters: Set<string> = new Set();
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentBuys = trades.filter(
    t =>
      t.transactionType === 'Buy' &&
      new Date(t.transactionDate) >= thirtyDaysAgo,
  );

  const buysByTicker: Record<string, number> = {};
  for (const buy of recentBuys) {
    buysByTicker[buy.ticker] = (buysByTicker[buy.ticker] || 0) + 1;
  }

  for (const [ticker, count] of Object.entries(buysByTicker)) {
    if (count >= 3) {
      tickerBuyClusters.add(ticker);
    }
  }

  return (
    <div className="space-y-4">
      {tickerBuyClusters.size > 0 && (
        <div className="p-3 border border-amber-500/40 bg-amber-500/10 rounded-lg flex items-start gap-3">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono font-bold text-amber-400">CLUSTER ALERT</p>
            <p className="text-[10px] font-mono text-amber-600">
              Multiple insider buys detected: {Array.from(tickerBuyClusters).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-900/50">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900/80">
              <th className="px-3 py-2 text-left text-gray-400">DATE</th>
              <th className="px-3 py-2 text-left text-gray-400">INSIDER</th>
              <th className="px-3 py-2 text-left text-gray-400">TITLE</th>
              <th className="px-3 py-2 text-left text-gray-400">TICKER</th>
              <th className="px-3 py-2 text-center text-gray-400">TYPE</th>
              <th className="px-3 py-2 text-right text-gray-400">SHARES</th>
              <th className="px-3 py-2 text-right text-gray-400">VALUE</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 30).map((trade, idx) => (
              <tr
                key={trade.id}
                className={cn(
                  idx % 2 === 0 ? 'bg-gray-900/30' : '',
                  tickerBuyClusters.has(trade.ticker) ? 'border-l-2 border-amber-400' : '',
                )}
              >
                <td className="px-3 py-2 text-gray-400">
                  {new Date(trade.transactionDate).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-white">{trade.insiderName}</td>
                <td className="px-3 py-2 text-gray-300 text-[10px]">{trade.title}</td>
                <td className="px-3 py-2 font-bold text-white">{trade.ticker}</td>
                <td className="px-3 py-2 text-center">
                  {trade.transactionType === 'Buy' ? (
                    <span className="text-green-400 font-bold">BUY</span>
                  ) : (
                    <span className="text-red-400 font-bold">SELL</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-300">
                  {(trade.shares / 1000).toFixed(0)}K
                </td>
                <td className="px-3 py-2 text-right text-gray-300">
                  ${(trade.value / 1_000_000).toFixed(1)}M
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export const CongressTrading = () => {
  const [data, setData] = useState<CongressDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'congress' | 'insider'>('congress');

  // Congress filters
  const [congressFilters, setCongressFilters] = useState({
    party: null as 'D' | 'R' | null,
    chamber: null as 'House' | 'Senate' | null,
    type: null as 'Purchase' | 'Sale' | null,
    ticker: '',
  });

  // Insider filters (simplified)
  const [insiderSearch, setInsiderSearch] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/congress');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('[CongressTrading] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300_000); // Refresh every 5 minutes

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
        Failed to load Congressional Trading data
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Fallback Banner */}
      {data.source === 'fallback' && (
        <div className="p-3 border border-yellow-500/40 bg-yellow-500/10 rounded-lg flex items-center gap-3">
          <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-xs font-mono font-bold text-yellow-400">SIMULATED DATA</p>
            <p className="text-[10px] font-mono text-yellow-600">
              Displaying realistic sample data. Real Quiver Quant feed unavailable.
            </p>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-800 pb-px">
        <button
          onClick={() => setActiveTab('congress')}
          className={`flex items-center gap-1.5 text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors ${
            activeTab === 'congress'
              ? 'border-btc-orange text-btc-orange'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Users size={12} /> Congressional Trades
        </button>
        <button
          onClick={() => setActiveTab('insider')}
          className={`flex items-center gap-1.5 text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors ${
            activeTab === 'insider'
              ? 'border-btc-orange text-btc-orange'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Users size={12} /> Insider Trades
        </button>
      </div>

      {/* Congressional Tab */}
      {activeTab === 'congress' && (
        <div className="space-y-6">
          {/* Stats */}
          <StatsBar trades={data.congressionalTrades} />

          {/* Most Traded */}
          <MostTraded trades={data.congressionalTrades} />

          {/* Filters */}
          <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50 space-y-3">
            <p className="text-xs font-mono font-bold text-gray-400 uppercase">Filters</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Ticker Search */}
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2.5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Ticker or Name..."
                  value={congressFilters.ticker}
                  onChange={e =>
                    setCongressFilters({ ...congressFilters, ticker: e.target.value })
                  }
                  className="w-full pl-7 pr-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-btc-orange"
                />
              </div>

              {/* Party */}
              <select
                value={congressFilters.party || ''}
                onChange={e =>
                  setCongressFilters({
                    ...congressFilters,
                    party: (e.target.value as any) || null,
                  })
                }
                className="px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs font-mono text-white focus:outline-none focus:border-btc-orange"
              >
                <option value="">All Parties</option>
                <option value="D">Democrat</option>
                <option value="R">Republican</option>
              </select>

              {/* Chamber */}
              <select
                value={congressFilters.chamber || ''}
                onChange={e =>
                  setCongressFilters({
                    ...congressFilters,
                    chamber: (e.target.value as any) || null,
                  })
                }
                className="px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs font-mono text-white focus:outline-none focus:border-btc-orange"
              >
                <option value="">All Chambers</option>
                <option value="House">House</option>
                <option value="Senate">Senate</option>
              </select>

              {/* Type */}
              <select
                value={congressFilters.type || ''}
                onChange={e =>
                  setCongressFilters({
                    ...congressFilters,
                    type: (e.target.value as any) || null,
                  })
                }
                className="px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs font-mono text-white focus:outline-none focus:border-btc-orange"
              >
                <option value="">All Types</option>
                <option value="Purchase">Purchase</option>
                <option value="Sale">Sale</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <CongressTable trades={data.congressionalTrades} filters={congressFilters} />
        </div>
      )}

      {/* Insider Tab */}
      {activeTab === 'insider' && (
        <div className="space-y-4">
          <InsiderTable trades={data.insiderTrades} />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 pt-4 border-t border-gray-800">
        <span>
          {data.source === 'quiver' ? 'QUIVER QUANT' : 'SIMULATED'}
        </span>
        <span>
          {new Date(data.lastUpdated).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};
