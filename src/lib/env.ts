/**
 * Centralized environment variable validation.
 * Import this module early (e.g., in instrumentation.ts) to fail fast
 * on missing required config instead of discovering it at runtime.
 */

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[Env] Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

/** Validate all critical env vars at startup. Call from instrumentation.ts */
export function validateEnv(): { missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Critical — app won't function without these
  const critical = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  // Important — features degraded without these
  const important = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ];

  // Optional — individual features disabled without these
  const featureKeys = [
    'FRED_API_KEY',
    'FINNHUB_API_KEY',
    'PUBLIC_SECRET_KEY',
    'RESEND_API_KEY',
    'PINECONE_API_KEY',
    'CRON_SECRET',
    'BLS_API_KEY',
    'INSTAGRAM_APP_ID',
    'INSTAGRAM_APP_SECRET',
    'X_API_KEY',
    'X_CLIENT_ID',
  ];

  for (const key of critical) {
    if (!process.env[key]) missing.push(key);
  }

  for (const key of important) {
    if (!process.env[key]) warnings.push(`${key} not set — some features will be unavailable`);
  }

  return { missing, warnings };
}

/** Typed config accessors — use these instead of raw process.env reads */
export const env = {
  get supabaseUrl() { return required('NEXT_PUBLIC_SUPABASE_URL'); },
  get supabaseAnonKey() { return required('NEXT_PUBLIC_SUPABASE_ANON_KEY'); },
  get supabaseServiceKey() { return optional('SUPABASE_SERVICE_ROLE_KEY'); },
  get anthropicKey() { return optional('ANTHROPIC_API_KEY'); },
  get fredApiKey() { return optional('FRED_API_KEY'); },
  get finnhubApiKey() { return optional('FINNHUB_API_KEY'); },
  get publicSecretKey() { return optional('PUBLIC_SECRET_KEY'); },
  get cronSecret() { return optional('CRON_SECRET'); },
  get appUrl() { return optional('NEXT_PUBLIC_APP_URL', process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'); },
  get isProd() { return process.env.NODE_ENV === 'production'; },
} as const;
