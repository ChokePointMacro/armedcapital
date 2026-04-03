import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

// In-memory cache with TTL
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const cache = new Map<string, { data: any; ts: number }>();

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

// Sentiment keywords for simple classification
const BULLISH_KEYWORDS = [
  'surge', 'rally', 'beat', 'upgrade', 'gain', 'profit', 'growth', 'bull',
  'soar', 'boost', 'momentum', 'strong', 'outperform', 'overweight',
  'breakout', 'bullish', 'positive', 'record', 'ipo', 'acquisition'
];

const BEARISH_KEYWORDS = [
  'crash', 'miss', 'downgrade', 'plunge', 'loss', 'decline', 'bear',
  'bearish', 'selloff', 'weakness', 'underperform', 'underweight',
  'bankruptcy', 'default', 'negative', 'recession', 'layoffs', 'downside'
];

function detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();

  let bullishScore = 0;
  let bearishScore = 0;

  for (const word of BULLISH_KEYWORDS) {
    if (lower.includes(word)) bullishScore++;
  }

  for (const word of BEARISH_KEYWORDS) {
    if (lower.includes(word)) bearishScore++;
  }

  if (bullishScore > bearishScore && bullishScore > 0) return 'positive';
  if (bearishScore > bullishScore && bearishScore > 0) return 'negative';
  return 'neutral';
}

async function fetchPolygonNews(ticker?: string, limit = 50): Promise<NewsItem[]> {
  try {
    const key = process.env.POLYGON_API_KEY;
    if (!key) return [];

    const params = new URLSearchParams({
      apiKey: key,
      limit: limit.toString(),
      sort: 'published_utc',
      order: 'desc',
    });

    if (ticker) {
      params.append('ticker', ticker.toUpperCase());
    }

    const url = `https://api.polygon.io/v2/reference/news?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) return [];

    const data = await res.json() as any;
    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results.map((item: any) => ({
      title: item.title || '',
      author: item.author || 'Polygon',
      publishedAt: item.published_utc || new Date().toISOString(),
      tickers: item.tickers || [],
      articleUrl: item.article_url || item.url || '',
      imageUrl: item.image_url || null,
      sentiment: detectSentiment(item.title || ''),
    }));
  } catch (error) {
    console.error('[News API] Error fetching from Polygon:', error);
    return [];
  }
}

function generateSimulatedNews(limit = 50): NewsItem[] {
  const tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BTC', 'ETH'];
  const headlines = [
    { title: 'Tech stocks surge on earnings beat', sentiment: 'positive' as const },
    { title: 'Fed signals rate pause, rally extends', sentiment: 'positive' as const },
    { title: 'Recession fears weigh on markets', sentiment: 'negative' as const },
    { title: 'AI momentum drives upgrades across sector', sentiment: 'positive' as const },
    { title: 'Geopolitical tensions create volatility', sentiment: 'negative' as const },
    { title: 'Strong jobs report boosts economic outlook', sentiment: 'positive' as const },
    { title: 'Earnings miss, guidance cuts hit growth stocks', sentiment: 'negative' as const },
    { title: 'Merger deal announced, shares rally', sentiment: 'positive' as const },
    { title: 'Crypto regulatory clarity fuels rally', sentiment: 'positive' as const },
    { title: 'Macro headwinds intensify sell-off', sentiment: 'negative' as const },
  ];

  const items: NewsItem[] = [];

  for (let i = 0; i < Math.min(limit, 50); i++) {
    const headline = headlines[i % headlines.length];
    const tickerCount = Math.floor(Math.random() * 3) + 1;
    const selectedTickers = [];

    for (let j = 0; j < tickerCount; j++) {
      selectedTickers.push(tickers[Math.floor(Math.random() * tickers.length)]);
    }

    const publishedAt = new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000);

    items.push({
      title: headline.title,
      author: 'Financial Times',
      publishedAt: publishedAt.toISOString(),
      tickers: [...new Set(selectedTickers)],
      articleUrl: `https://example.com/article/${i}`,
      imageUrl: null,
      sentiment: headline.sentiment,
    });
  }

  return items;
}

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const userId = await safeAuth();

    // Get query params
    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    // Build cache key
    const cacheKey = `news:${ticker || 'all'}:${limit}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    // Fetch news from Polygon
    let news = await fetchPolygonNews(ticker, limit);
    let source: 'polygon' | 'simulated' = 'polygon';

    // Fallback to simulated data if no API key or no results
    if (news.length === 0) {
      news = generateSimulatedNews(limit);
      source = 'simulated';
    }

    // Sort by date descending
    news.sort((a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    const response: NewsResponse = {
      source,
      data: news,
      lastUpdated: new Date().toISOString(),
    };

    // Cache response
    cache.set(cacheKey, { data: response, ts: Date.now() });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[News API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch news' },
      { status: 500 }
    );
  }
}
