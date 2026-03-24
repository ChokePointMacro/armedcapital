import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { invalidateCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/admin/reconnect
 * Body: { source?: string }
 *
 * Flushes cached data for the given source (or all sources) and
 * re-fetches to force a fresh connection attempt.
 * Returns the updated status for each reconnected source.
 */

// Map of source names to their cache keys and check functions
const SOURCE_MAP: Record<string, { cacheKeys: string[]; check: () => Promise<any> }> = {
  fred: {
    cacheKeys: ['fred'],
    check: async () => {
      const { fetchFredData } = await import('@/lib/enrichedData');
      const data = await fetchFredData();
      return { name: 'FRED (Federal Reserve)', connected: data.available, error: data.available ? null : 'No data returned' };
    },
  },
  finnhub: {
    cacheKeys: ['finnhub'],
    check: async () => {
      const { fetchFinnhubData } = await import('@/lib/enrichedData');
      const data = await fetchFinnhubData();
      return { name: 'Finnhub', connected: data.available || !!process.env.FINNHUB_API_KEY, error: null };
    },
  },
  'fear-greed': {
    cacheKeys: ['fear-greed'],
    check: async () => {
      const { fetchFearGreedIndex } = await import('@/lib/enrichedData');
      const data = await fetchFearGreedIndex();
      return { name: 'CNN Fear & Greed', connected: !!data, error: data ? null : 'Could not fetch index' };
    },
  },
  coingecko: {
    cacheKeys: ['coingecko'],
    check: async () => {
      const { fetchCoinGeckoData } = await import('@/lib/enrichedData');
      const data = await fetchCoinGeckoData();
      return { name: 'CoinGecko', connected: data.available, error: data.available ? null : 'API returned no data' };
    },
  },
  bls: {
    cacheKeys: ['bls'],
    check: async () => {
      const { fetchBlsData } = await import('@/lib/enrichedData');
      const data = await fetchBlsData();
      return { name: 'BLS (Labor Statistics)', connected: data.available, error: data.available ? null : 'No data returned' };
    },
  },
  cftc: {
    cacheKeys: ['cftc'],
    check: async () => {
      const { fetchCftcData } = await import('@/lib/enrichedData');
      const data = await fetchCftcData();
      return { name: 'CFTC COT Reports', connected: data.available, error: data.available ? null : 'No COT data returned' };
    },
  },
  treasury: {
    cacheKeys: ['treasury'],
    check: async () => {
      const { fetchTreasuryData } = await import('@/lib/enrichedData');
      const data = await fetchTreasuryData();
      return { name: 'Treasury.gov', connected: data.available, error: data.available ? null : 'No fiscal data returned' };
    },
  },
  'defi-llama': {
    cacheKeys: ['defi-llama'],
    check: async () => {
      const { fetchDefiLlamaData } = await import('@/lib/enrichedData');
      const data = await fetchDefiLlamaData();
      return { name: 'DefiLlama', connected: data.available, error: data.available ? null : 'No DeFi data returned' };
    },
  },
  'tv-quotes': {
    cacheKeys: ['tv-quotes'],
    check: async () => {
      const { fetchTVLiveQuotes } = await import('@/lib/enrichedData');
      const data = await fetchTVLiveQuotes();
      return { name: 'TradingView WebSocket', connected: data.connected && data.available, error: data.available ? null : 'No quote data received' };
    },
  },
};

export async function POST(request: NextRequest) {
  const userId = await safeAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { source } = await request.json().catch(() => ({ source: undefined }));

    const sources = source && SOURCE_MAP[source]
      ? { [source]: SOURCE_MAP[source] }
      : SOURCE_MAP;

    const results: Array<{ source: string; connected: boolean; error: string | null }> = [];

    // Invalidate caches first
    await Promise.all(
      Object.values(sources).flatMap(s => s.cacheKeys.map(k => invalidateCache(k)))
    );

    // Clear in-memory L1 caches so re-checks hit the real APIs
    try {
      const { clearAllMemoryCaches } = await import('@/lib/enrichedData');
      clearAllMemoryCaches();
    } catch {}

    // Re-check each source
    for (const [key, src] of Object.entries(sources)) {
      try {
        const status = await src.check();
        results.push({ source: key, connected: status.connected, error: status.error });
      } catch (err) {
        results.push({ source: key, connected: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const connected = results.filter(r => r.connected).length;
    const failed = results.filter(r => !r.connected).length;

    return NextResponse.json({
      success: true,
      message: `Reconnected ${connected}/${results.length} sources${failed > 0 ? ` (${failed} still disconnected)` : ''}`,
      results,
      reconnectedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reconnect failed' },
      { status: 500 }
    );
  }
}
