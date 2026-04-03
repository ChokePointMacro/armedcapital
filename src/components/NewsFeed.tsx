'use client';

import React, { useState, useEffect } from 'react';
import { Search, AlertTriangle, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface NewsItem {
  title: string;
  author: string;
  publishedAt: string;
  tickers: string[];
  articleUrl: string;
  imageUrl: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
}

interface NewsResponse {
  source: 'polygon' | 'simulated';
  data: NewsItem[];
  lastUpdated: string;
}

type NewsFilter = 'all' | 'earnings' | 'fed' | 'crypto' | 'geopolitical';

const EARNINGS_KEYWORDS = ['earnings', 'beat', 'miss', 'guidance', 'eps'];
const FED_KEYWORDS = ['fed', 'fomc', 'rate', 'inflation', 'macro', 'recession', 'gdp'];
const CRYPTO_KEYWORDS = ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto', 'blockchain'];
const GEO_KEYWORDS = ['geopolitical', 'sanctions', 'trade', 'war', 'conflict'];

function matchesFilter(title: string, filter: NewsFilter): boolean {
  const lower = title.toLowerCase();

  if (filter === 'earnings') {
    return EARNINGS_KEYWORDS.some(k => lower.includes(k));
  }
  if (filter === 'fed') {
    return FED_KEYWORDS.some(k => lower.includes(k));
  }
  if (filter === 'crypto') {
    return CRYPTO_KEYWORDS.some(k => lower.includes(k));
  }
  if (filter === 'geopolitical') {
    return GEO_KEYWORDS.some(k => lower.includes(k));
  }
  return true;
}

function timeAgo(dateStr: string): string {
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
}

interface TrendingTicker {
  symbol: string;
  count: number;
}

function getTrendingTickers(news: NewsItem[]): TrendingTicker[] {
  const tickerMap = new Map<string, number>();

  for (const item of news) {
    for (const ticker of item.tickers) {
      tickerMap.set(ticker, (tickerMap.get(ticker) || 0) + 1);
    }
  }

  return Array.from(tickerMap.entries())
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export const NewsFeed = () => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<NewsFilter>('all');
  const [searchTicker, setSearchTicker] = useState('');
  const [source, setSource] = useState<'polygon' | 'simulated'>('polygon');
  const [newHeadlines, setNewHeadlines] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchNews = async () => {
      try {
        setLoading(true);
        const response = (await apiFetch('/api/news')) as NewsResponse;
        const previousHeadlines = new Set(news.map(n => n.title));
        const newTitles = response.data
          .filter(n => !previousHeadlines.has(n.title))
          .map(n => n.title);

        setNewHeadlines(new Set(newTitles));
        setNews(response.data);
        setSource(response.source);

        // Clear flash animation after 3 seconds
        if (newTitles.length > 0) {
          setTimeout(() => setNewHeadlines(new Set()), 3000);
        }
      } catch (error) {
        console.error('[NewsFeed] Error fetching news:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
    const interval = setInterval(fetchNews, 60_000); // Refresh every 60 seconds

    return () => clearInterval(interval);
  }, []);

  // Filter news
  const filteredNews = news
    .filter(item => matchesFilter(item.title, activeFilter))
    .filter(item => {
      if (!searchTicker) return true;
      return item.tickers.some(t => t.includes(searchTicker.toUpperCase()));
    });

  // Get trending tickers
  const trendingTickers = getTrendingTickers(news);

  return (
    <div className="space-y-6">
      {/* Simulated Data Banner */}
      {source === 'simulated' && (
        <div className="p-3 border border-yellow-500/40 bg-yellow-500/10 rounded-lg flex items-center gap-3">
          <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-xs font-mono font-bold text-yellow-400">SIMULATED DATA MODE</p>
            <p className="text-[10px] font-mono text-yellow-600">
              Set POLYGON_API_KEY in environment variables for real financial news.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main News Feed - Left 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filter Tabs */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 'earnings', 'fed', 'crypto', 'geopolitical'] as NewsFilter[]).map(
              (filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={cn(
                    'text-[11px] font-mono px-3 py-1.5 border-b-2 transition-colors uppercase tracking-widest',
                    activeFilter === filter
                      ? 'border-btc-orange text-btc-orange'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  )}
                >
                  {filter === 'all'
                    ? 'All News'
                    : filter === 'earnings'
                      ? 'Earnings'
                      : filter === 'fed'
                        ? 'Fed/Macro'
                        : filter === 'crypto'
                          ? 'Crypto'
                          : 'Geopolitical'}
                </button>
              )
            )}
          </div>

          {/* Ticker Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-3 text-gray-500" />
            <input
              type="text"
              placeholder="Filter by ticker symbol..."
              value={searchTicker}
              onChange={(e) => setSearchTicker(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded pl-9 pr-4 py-2 text-xs font-mono text-gray-300 placeholder-gray-600 focus:outline-none focus:border-btc-orange transition-colors"
            />
          </div>

          {/* News List */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-btc-orange" size={32} />
            </div>
          )}

          {!loading && filteredNews.length === 0 ? (
            <div className="text-center py-12 text-gray-500 font-mono text-sm">
              {searchTicker
                ? `No news found for ${searchTicker}`
                : `No ${activeFilter !== 'all' ? activeFilter : ''} news available`}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredNews.map((item) => {
                const isNew = newHeadlines.has(item.title);
                return (
                  <div
                    key={item.title}
                    className={cn(
                      'border rounded-lg p-4 transition-all',
                      isNew
                        ? 'bg-btc-orange/20 border-btc-orange animate-pulse'
                        : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                    )}
                  >
                    {/* Title */}
                    <a
                      href={item.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:text-btc-orange transition-colors mb-2"
                    >
                      <p className="text-sm font-mono text-gray-200 line-clamp-2">
                        {item.title}
                      </p>
                    </a>

                    {/* Meta + Sentiment Badge */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                        <span>{item.author}</span>
                        <span className="text-gray-700">•</span>
                        <span>{timeAgo(item.publishedAt)}</span>
                      </div>

                      <div
                        className={cn(
                          'px-2 py-1 rounded text-[9px] font-mono font-bold',
                          item.sentiment === 'positive'
                            ? 'bg-green-500/20 text-green-400'
                            : item.sentiment === 'negative'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-gray-700/50 text-gray-400'
                        )}
                      >
                        {item.sentiment === 'positive'
                          ? 'BULLISH'
                          : item.sentiment === 'negative'
                            ? 'BEARISH'
                            : 'NEUTRAL'}
                      </div>
                    </div>

                    {/* Ticker Badges */}
                    {item.tickers.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {item.tickers.map((ticker) => (
                          <Link
                            key={ticker}
                            href={`/ticker/${ticker}`}
                            className="inline-block px-2 py-1 bg-btc-orange/10 border border-btc-orange/30 rounded text-[9px] font-mono font-bold text-btc-orange hover:bg-btc-orange/20 transition-colors"
                          >
                            ${ticker}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Trending Tickers Sidebar - Right 1 col */}
        <div>
          <h3 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider mb-4">
            Trending Tickers
          </h3>

          {trendingTickers.length === 0 ? (
            <div className="text-xs font-mono text-gray-600 p-3 bg-gray-900/50 border border-gray-800 rounded">
              No trending data
            </div>
          ) : (
            <div className="space-y-2">
              {trendingTickers.map((ticker) => (
                <Link
                  key={ticker.symbol}
                  href={`/ticker/${ticker.symbol}`}
                  className="block p-3 bg-gray-900/50 border border-gray-800 rounded hover:border-btc-orange/50 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-mono font-bold text-btc-orange group-hover:text-orange-300 transition-colors">
                      ${ticker.symbol}
                    </p>
                    <span className="text-[9px] font-mono text-gray-500 bg-gray-800/50 px-2 py-0.5 rounded">
                      {ticker.count} mentions
                    </span>
                  </div>
                  <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-btc-orange/60 transition-all"
                      style={{
                        width: `${(ticker.count / Math.max(...trendingTickers.map(t => t.count))) * 100}%`,
                      }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
