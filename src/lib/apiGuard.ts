import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from './authHelper';
import { rateLimit, rateLimitHeaders, API_LIMIT, PUBLIC_LIMIT, REPORT_LIMIT, AUTH_LIMIT, CRON_LIMIT } from './rateLimit';

export type RateLimitTier = 'api' | 'public' | 'report' | 'auth' | 'cron';

const TIER_CONFIG = {
  api: API_LIMIT,
  public: PUBLIC_LIMIT,
  report: REPORT_LIMIT,
  auth: AUTH_LIMIT,
  cron: CRON_LIMIT,
} as const;

interface GuardOptions {
  /** Require authentication? Default true */
  requireAuth?: boolean;
  /** Rate limit tier. Default 'api' */
  tier?: RateLimitTier;
}

interface GuardResult {
  userId: string | null;
  ip: string;
}

/**
 * Unified API guard: auth check + rate limiting in one call.
 * Returns userId + ip, or throws a NextResponse if blocked.
 *
 * Usage:
 *   const guard = await apiGuard(request, { requireAuth: true, tier: 'api' });
 *   if (guard instanceof NextResponse) return guard;
 *   const { userId } = guard;
 */
export async function apiGuard(
  request: NextRequest,
  options: GuardOptions = {}
): Promise<GuardResult | NextResponse> {
  const { requireAuth = true, tier = 'api' } = options;

  // 1. Get IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  // 2. Auth check
  let userId: string | null = null;
  if (requireAuth) {
    userId = await safeAuth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // 3. Rate limiting (keyed on userId if authed, otherwise IP)
  const identifier = userId || ip;
  const config = TIER_CONFIG[tier];
  const result = await rateLimit(identifier, config);

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(result, config.limit),
          'Retry-After': String(result.resetInSeconds),
        },
      }
    );
  }

  return { userId, ip };
}
