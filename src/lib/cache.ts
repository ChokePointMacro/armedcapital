import { redis } from './redis';

/**
 * Redis-backed cache with automatic fallback.
 * Survives serverless cold starts, unlike in-memory caches.
 *
 * Usage:
 *   const data = await cached('fred-data', 3600, () => fetchFredSeries());
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cacheKey = `cache:${key}`;

  // 1. Try Redis first
  try {
    const raw = await redis.get(cacheKey);
    if (raw !== null && raw !== undefined) {
      // Upstash returns parsed JSON automatically for objects
      return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
    }
  } catch (err) {
    // Redis down — fall through to fetcher
    console.warn(`[Cache] Redis read failed for ${key}:`, err instanceof Error ? err.message : err);
  }

  // 2. Fetch fresh data
  const data = await fetcher();

  // 3. Store in Redis (non-blocking, don't await)
  try {
    await redis.set(cacheKey, JSON.stringify(data), { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[Cache] Redis write failed for ${key}:`, err instanceof Error ? err.message : err);
  }

  return data;
}

/**
 * Invalidate a specific cache key.
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(`cache:${key}`);
  } catch (err) {
    console.warn(`[Cache] Redis del failed for ${key}:`, err instanceof Error ? err.message : err);
  }
}

// ── TTL presets (seconds) ────────────────────────────────────────────────────

/** FRED, BLS, Treasury — government data, slow-moving */
export const TTL_GOVERNMENT = 3600; // 1 hour

/** Finnhub earnings/insider — changes throughout the day */
export const TTL_MARKET_DATA = 1800; // 30 min

/** CoinGecko — tight rate limits, cache aggressively */
export const TTL_CRYPTO = 600; // 10 min

/** Fear & Greed — updates once/day */
export const TTL_SENTIMENT = 3600; // 1 hour

/** CFTC COT — weekly report */
export const TTL_WEEKLY = 43200; // 12 hours

/** DefiLlama — moderate update frequency */
export const TTL_DEFI = 900; // 15 min

/** TradingView signals — near real-time */
export const TTL_REALTIME = 300; // 5 min

/** TradingView quotes — live prices */
export const TTL_QUOTES = 60; // 1 min
