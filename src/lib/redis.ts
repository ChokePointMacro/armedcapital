import { Redis } from '@upstash/redis';

/**
 * Upstash Redis client — used for caching, rate limiting, and distributed locks.
 * Falls back to a no-op stub if env vars are missing so the app still boots.
 */

const hasCredentials =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

const noopRedis = {
  get: async () => null,
  set: async () => 'OK',
  del: async () => 0,
  pipeline: () => ({
    zremrangebyscore: function () { return this; },
    zadd: function () { return this; },
    zcard: function () { return this; },
    expire: function () { return this; },
    exec: async () => [null, null, 0, null],
  }),
} as unknown as Redis;

export const redis: Redis = hasCredentials
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : noopRedis;
