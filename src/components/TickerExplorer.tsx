'use client';

import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

interface TickerData {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;
  high52w: number | null;
  low52w: number | null;
  options: {
    callVolume: number;
    putVolume: number;
    putCallRatio: number;
    totalOI: number;
    ivRank: number | null;
  } | null;
  news: Array<{
    title: string;
    url: string;
    published: string;
    source: string;
  }>;
  source: 'polygon' | 'yahoo' | 'unavailable';
}

type TabKey = 'overview' | 'flow' | 'volatility' | 'fundamentals' | 'news';

interface StatCard {
  label: string;
  value: string | number | null;
  suffix?: string;
}

const formatNumber = (num: number | null | undefined, decimals = 2): string => {
  if (num === null || num === undefined) return 'N/A';
  return num.toFixed(decimals);
};

const formatLargeNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
};

const timeAgo = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const seconds = (now.getTime() - date.getTime()) / 1000;

    if (seconds < 60) return 'now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  } catch {
    return 'unknown';
  }
};

export const TickerExplorer = ({ symbol }: { symbol: string }) => {
  const [data, setData] = useState<TickerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const tickerData = await apiFetch(`/api/ticker/${symbol}`);
        setData(tickerData);
      } catch (error) {
        console.error('Error fetching ticker data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (symbol) {
      fetchData();
    }
  }, [symbol]);

  const handleGenerateBrief = async () => {
    if (!data) return;
    try {
      setGenerating(true);
      const response = await apiFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            ticker: data.symbol,
            name: data.name,
            price: data.price,
            change: data.change,
            changePercent: data.changePercent,
            volume: data.volume,
            high52w: data.high52w,
            low52w: data.low52w,
            options: data.options,
            recentNews: data.news.slice(0, 5),
          },
          prompt: `Generate a concise intelligence brief for ${data.symbol} (${data.name}). Include price action, volume, key levels, and any notable news. Keep it to 3-4 paragraphs.`,
        }),
      });
      setBrief(response.text || response.brief);
    } catch (error) {
      console.error('Error generating brief:', error);
      setBrief('Failed to generate brief');
    } finally {
      setGenerating(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-btc-orange" size={40} />
      </div>
    );
  }

  const isUp = (data.change ?? 0) >= 0;

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="space-y-4">
        {/* Title and Price */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-mono font-bold text-white tracking-tight">
              {data.symbol}
            </h1>
            <p className="text-sm font-mono text-gray-400">{data.name}</p>
          </div>
          <button
            onClick={handleGenerateBrief}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {generating ? 'Generating...' : 'Intelligence Brief'}
          </button>
        </div>

        {/* Price Display */}
        <div className="flex items-baseline gap-3">
          <div className="text-4xl font-mono font-bold text-white">
            ${data.price !== null ? formatNumber(data.price, 2) : 'N/A'}
          </div>
          <div
            className={cn(
              'flex items-center gap-2 text-lg font-mono font-bold',
              isUp ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {isUp ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            <span>
              {data.change !== null ? (isUp ? '+' : '') + formatNumber(data.change, 2) : 'N/A'}
            </span>
            <span className="text-sm">
              ({data.changePercent !== null ? (isUp ? '+' : '') + formatNumber(data.changePercent, 2) : 'N/A'}%)
            </span>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCardComponent
            label="IV Rank"
            value={data.options?.ivRank !== null ? formatNumber(data.options?.ivRank, 1) : 'N/A'}
            suffix={data.options?.ivRank !== null ? '%' : undefined}
          />
          <StatCardComponent
            label="Put/Call"
            value={data.options ? formatNumber(data.options.putCallRatio, 2) : 'N/A'}
          />
          <StatCardComponent
            label="Options Vol"
            value={data.options ? `${(data.options.totalOI / 1000).toFixed(0)}K` : 'N/A'}
          />
          <StatCardComponent
            label="52W Range"
            value={
              data.high52w && data.low52w
                ? `$${formatNumber(data.low52w, 0)}-$${formatNumber(data.high52w, 0)}`
                : 'N/A'
            }
          />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-800 pb-px flex-wrap">
        {[
          { key: 'overview' as TabKey, label: 'Overview' },
          { key: 'flow' as TabKey, label: 'Flow' },
          { key: 'volatility' as TabKey, label: 'Volatility' },
          { key: 'fundamentals' as TabKey, label: 'Fundamentals' },
          { key: 'news' as TabKey, label: 'News' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors uppercase tracking-widest',
              activeTab === tab.key
                ? 'border-btc-orange text-btc-orange'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <OverviewTab data={data} />
        )}
        {activeTab === 'flow' && (
          <div className="bg-gray-900/50 border border-gray-800 rounded p-4 text-center text-gray-400 text-sm font-mono">
            Options flow for <span className="text-btc-orange font-bold">{data.symbol}</span> — requires enhanced data.{' '}
            <a href="/markets-hub" className="text-btc-orange hover:underline">
              View on Market Tide →
            </a>
          </div>
        )}
        {activeTab === 'volatility' && (
          <div className="bg-gray-900/50 border border-gray-800 rounded p-4 space-y-3">
            <div className="text-sm font-mono text-gray-400">
              <p className="mb-2">Available Volatility Metrics:</p>
              {data.options ? (
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="text-gray-500">Call Volume:</span> <span className="text-gray-300">{data.options.callVolume.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Put Volume:</span> <span className="text-gray-300">{data.options.putVolume.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Put/Call Ratio:</span> <span className="text-gray-300">{data.options.putCallRatio.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total OI:</span> <span className="text-gray-300">{data.options.totalOI.toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">No options data available for {data.symbol}</p>
              )}
            </div>
          </div>
        )}
        {activeTab === 'fundamentals' && (
          <FundamentalsTab data={data} />
        )}
        {activeTab === 'news' && (
          <NewsTab data={data} />
        )}
      </div>

      {/* Intelligence Brief Modal */}
      {brief && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded max-w-2xl w-full max-h-[80vh] overflow-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-mono font-bold text-btc-orange">Intelligence Brief</h2>
              <button
                onClick={() => setBrief(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="text-sm font-mono text-gray-300 whitespace-pre-wrap">
              {brief}
            </div>
            <button
              onClick={() => setBrief(null)}
              className="w-full px-4 py-2 bg-btc-orange text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCardComponent = ({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string | number | null;
  suffix?: string;
}) => (
  <div className="bg-gray-900/50 border border-gray-800 rounded p-3 space-y-1">
    <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">{label}</p>
    <p className="text-sm font-mono font-bold text-white">
      {value}
      {suffix && <span className="text-gray-500">{suffix}</span>}
    </p>
  </div>
);

const OverviewTab = ({ data }: { data: TickerData }) => (
  <div className="space-y-6">
    {/* TradingView Chart Embed */}
    <div className="rounded overflow-hidden border border-gray-800">
      <div className="bg-gray-950" style={{ height: 400 }}>
        <iframe
          src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview&symbol=${data.symbol}&interval=D&theme=dark&style=1&locale=en&enable_publishing=false&hide_top_toolbar=false&hide_side_toolbar=false&allow_symbol_change=true&save_image=false&studies=[]&show_popup_button=false&popup_width=1000&popup_height=650`}
          style={{ width: '100%', height: '100%', border: 'none' }}
          allowTransparency={true}
        />
      </div>
    </div>

    {/* Key Metrics Grid */}
    <div>
      <h3 className="text-xs font-mono uppercase tracking-widest text-btc-orange/70 mb-3">
        Key Metrics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Volume"
          value={data.volume ? formatLargeNumber(data.volume) : 'N/A'}
        />
        <MetricCard
          label="Market Cap"
          value={data.marketCap ? formatLargeNumber(data.marketCap) : 'N/A'}
        />
        <MetricCard
          label="52W High"
          value={data.high52w ? `$${formatNumber(data.high52w, 2)}` : 'N/A'}
        />
        <MetricCard
          label="52W Low"
          value={data.low52w ? `$${formatNumber(data.low52w, 2)}` : 'N/A'}
        />
      </div>
    </div>

    {/* Recent Options Activity */}
    {data.options && (
      <div>
        <h3 className="text-xs font-mono uppercase tracking-widest text-btc-orange/70 mb-3">
          Options Summary
        </h3>
        <div className="bg-gray-900/50 border border-gray-800 rounded p-4 space-y-2 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-gray-500">Call Volume:</span>
            <span className="text-gray-300">{data.options.callVolume.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Put Volume:</span>
            <span className="text-gray-300">{data.options.putVolume.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Put/Call Ratio:</span>
            <span className="text-btc-orange font-bold">{data.options.putCallRatio.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total Open Interest:</span>
            <span className="text-gray-300">{data.options.totalOI.toLocaleString()}</span>
          </div>
        </div>
      </div>
    )}

    {/* Recent News */}
    {data.news.length > 0 && (
      <div>
        <h3 className="text-xs font-mono uppercase tracking-widest text-btc-orange/70 mb-3">
          Recent News
        </h3>
        <div className="space-y-2">
          {data.news.slice(0, 5).map((item, idx) => (
            <a
              key={idx}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-gray-900/50 border border-gray-800 rounded p-3 hover:border-btc-orange/50 transition-colors group"
            >
              <p className="text-xs font-mono text-gray-300 group-hover:text-btc-orange transition-colors line-clamp-2 mb-1">
                {item.title}
              </p>
              <div className="flex items-center justify-between text-[9px] font-mono text-gray-600">
                <span>{item.source}</span>
                <span>{timeAgo(item.published)}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    )}
  </div>
);

const FundamentalsTab = ({ data }: { data: TickerData }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <MetricCard label="Price" value={`$${formatNumber(data.price, 2)}`} />
      <MetricCard label="Volume" value={formatLargeNumber(data.volume)} />
      <MetricCard label="Market Cap" value={formatLargeNumber(data.marketCap)} />
      <MetricCard label="52W High" value={`$${formatNumber(data.high52w, 2)}`} />
      <MetricCard label="52W Low" value={`$${formatNumber(data.low52w, 2)}`} />
      <MetricCard
        label="52W Change"
        value={
          data.high52w && data.low52w && data.price
            ? `${(((data.price - data.low52w) / (data.high52w - data.low52w)) * 100).toFixed(1)}%`
            : 'N/A'
        }
      />
    </div>
  </div>
);

const NewsTab = ({ data }: { data: TickerData }) => (
  <div className="space-y-2">
    {data.news.length > 0 ? (
      data.news.map((item, idx) => (
        <a
          key={idx}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-gray-900/50 border border-gray-800 rounded p-4 hover:border-btc-orange/50 transition-colors group"
        >
          <p className="text-xs font-mono text-gray-300 group-hover:text-btc-orange transition-colors mb-2">
            {item.title}
          </p>
          <div className="flex items-center justify-between text-[9px] font-mono text-gray-600">
            <span>{item.source}</span>
            <span>{timeAgo(item.published)}</span>
          </div>
        </a>
      ))
    ) : (
      <div className="text-center py-8 text-gray-400 text-sm font-mono">
        No news available for {data.symbol}
      </div>
    )}
  </div>
);

const MetricCard = ({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) => (
  <div className="bg-gray-900/50 border border-gray-800 rounded p-4 space-y-1">
    <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">{label}</p>
    <p className="text-sm font-mono font-bold text-white">{value}</p>
  </div>
);
