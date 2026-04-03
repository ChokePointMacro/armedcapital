import { redis } from './redis';

/**
 * Sliding-window rate limiter using Upstash Redis.
 * Returns { allowed, remaining, resetInSeconds }.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Prefix for the Redis key (e.g. 'api', 'cron') */
  prefix?: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  limit: 60,
  windowSeconds: 60,
  prefix: 'rl',
};

/**
 * Check rate limit for an identifier (userId, IP, etc.)
 */
export async function rateLimit(
  identifier: string,
  config: Partial<RateLimitConfig> = {}
): Promise<RateLimitResult> {
  const { limit, windowSeconds, prefix } = { ...DEFAULT_CONFIG, ...config };
  const key = `${prefix}:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  try {
    // Use a pipeline for atomicity
    const pipe = redis.pipeline();
    // Remove entries outside the window
    pipe.zremrangebyscore(key, 0, windowStart);
    // Add current request
    pipe.zadd(key, { score: now, member: `${now}:${Math.random().toString(36).slice(2, 8)}` });
    // Count requests in window
    pipe.zcard(key);
    // Set TTL so keys auto-expire
    pipe.expire(key, windowSeconds);

    const results = await pipe.exec();
    const count = (results[2] as number) || 0;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds: windowSeconds,
    };
  } catch (error) {
    // If Redis is down, fail open (allow the request) but log it
    console.error('[RateLimit] Redis error, failing open:', error);
    return { allowed: true, remaining: limit, resetInSeconds: windowSeconds };
  }
}

/**
 * Rate limit headers to attach to responses
 */
export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetInSeconds),
  };
}

// ── Preset configs for different route types ─────────────────────────────────

/** Standard API routes: 60 req/min per user */
export const API_LIMIT = { limit: 60, windowSeconds: 60, prefix: 'rl:api' };

/** Report generation: 10 req/min (expensive) */
export const REPORT_LIMIT = { limit: 10, windowSeconds: 60, prefix: 'rl:report' };

/** Auth endpoints: 10 req/min to prevent brute force */
export const AUTH_LIMIT = { limit: 10, windowSeconds: 60, prefix: 'rl:auth' };

/** Public endpoints: 30 req/min per IP */
export const PUBLIC_LIMIT = { limit: 30, windowSeconds: 60, prefix: 'rl:pub' };

/** Cron: 5 req/min (should only fire once) */
export const CRON_LIMIT = { limit: 5, windowSeconds: 60, prefix: 'rl:cron' };
