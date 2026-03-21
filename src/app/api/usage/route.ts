import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

// ── Known rate limits per service ────────────────────────────────────────────

interface ServiceStatus {
  name: string;
  category: 'ai' | 'data' | 'infra' | 'social';
  connected: boolean;
  latencyMs: number | null;
  error: string | null;
  limits: {
    label: string;
    tier: string;
    requests?: { used: number | null; max: number | null; window: string };
    tokens?: { used: number | null; max: number | null; window: string };
    notes?: string;
  } | null;
}

async function checkAnthropic(): Promise<ServiceStatus> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { name: 'Anthropic (Claude)', category: 'ai', connected: false, latencyMs: null, error: 'ANTHROPIC_API_KEY not set', limits: null };

  const start = Date.now();
  try {
    // Use a minimal message to check connectivity and get rate limit headers
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const latency = Date.now() - start;

    // Extract rate limit headers
    const reqLimit = res.headers.get('anthropic-ratelimit-requests-limit');
    const reqRemaining = res.headers.get('anthropic-ratelimit-requests-remaining');
    const reqReset = res.headers.get('anthropic-ratelimit-requests-reset');
    const tokLimit = res.headers.get('anthropic-ratelimit-tokens-limit');
    const tokRemaining = res.headers.get('anthropic-ratelimit-tokens-remaining');

    const reqMax = reqLimit ? parseInt(reqLimit) : null;
    const reqUsed = reqMax && reqRemaining ? reqMax - parseInt(reqRemaining) : null;
    const tokMax = tokLimit ? parseInt(tokLimit) : null;
    const tokUsed = tokMax && tokRemaining ? tokMax - parseInt(tokRemaining) : null;

    // Determine tier from limits
    let tier = 'Unknown';
    if (reqMax) {
      if (reqMax <= 50) tier = 'Tier 1 (Free)';
      else if (reqMax <= 1000) tier = 'Tier 2';
      else if (reqMax <= 2000) tier = 'Tier 3';
      else if (reqMax <= 4000) tier = 'Tier 4';
      else tier = 'Tier 5+';
    }

    return {
      name: 'Anthropic (Claude)',
      category: 'ai',
      connected: res.ok || res.status === 200,
      latencyMs: latency,
      error: null,
      limits: {
        label: 'API Rate Limits',
        tier,
        requests: reqMax ? { used: reqUsed, max: reqMax, window: reqReset ? `resets ${reqReset}` : 'per minute' } : undefined,
        tokens: tokMax ? { used: tokUsed, max: tokMax, window: 'per minute' } : undefined,
      },
    };
  } catch (err) {
    return { name: 'Anthropic (Claude)', category: 'ai', connected: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err), limits: null };
  }
}

async function checkOpenAI(): Promise<ServiceStatus> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { name: 'OpenAI (GPT-4o)', category: 'ai', connected: false, latencyMs: null, error: 'OPENAI_API_KEY not set', limits: null };

  const start = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const latency = Date.now() - start;

    const reqLimit = res.headers.get('x-ratelimit-limit-requests');
    const reqRemaining = res.headers.get('x-ratelimit-remaining-requests');
    const tokLimit = res.headers.get('x-ratelimit-limit-tokens');
    const tokRemaining = res.headers.get('x-ratelimit-remaining-tokens');

    const reqMax = reqLimit ? parseInt(reqLimit) : null;
    const reqUsed = reqMax && reqRemaining ? reqMax - parseInt(reqRemaining) : null;
    const tokMax = tokLimit ? parseInt(tokLimit) : null;
    const tokUsed = tokMax && tokRemaining ? tokMax - parseInt(tokRemaining) : null;

    let tier = 'Unknown';
    if (reqMax) {
      if (reqMax <= 500) tier = 'Tier 1';
      else if (reqMax <= 5000) tier = 'Tier 2';
      else if (reqMax <= 10000) tier = 'Tier 3';
      else tier = 'Tier 4+';
    }

    return {
      name: 'OpenAI (GPT-4o)',
      category: 'ai',
      connected: res.ok,
      latencyMs: latency,
      error: res.ok ? null : `HTTP ${res.status}`,
      limits: {
        label: 'API Rate Limits',
        tier,
        requests: reqMax ? { used: reqUsed, max: reqMax, window: 'per minute' } : undefined,
        tokens: tokMax ? { used: tokUsed, max: tokMax, window: 'per minute' } : undefined,
      },
    };
  } catch (err) {
    return { name: 'OpenAI (GPT-4o)', category: 'ai', connected: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err), limits: null };
  }
}

async function checkGemini(): Promise<ServiceStatus> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { name: 'Google Gemini', category: 'ai', connected: false, latencyMs: null, error: 'GEMINI_API_KEY not set', limits: null };

  const start = Date.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const latency = Date.now() - start;

    return {
      name: 'Google Gemini',
      category: 'ai',
      connected: res.ok,
      latencyMs: latency,
      error: res.ok ? null : `HTTP ${res.status}`,
      limits: {
        label: 'Gemini Flash Free Tier',
        tier: 'Free / Pay-as-you-go',
        requests: { used: null, max: 15, window: 'per minute (free)' },
        tokens: { used: null, max: 1000000, window: 'per minute (free)' },
        notes: 'Free tier: 15 RPM / 1M TPM. Paid: 2000 RPM.',
      },
    };
  } catch (err) {
    return { name: 'Google Gemini', category: 'ai', connected: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err), limits: null };
  }
}

async function checkSupabase(): Promise<ServiceStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { name: 'Supabase', category: 'infra', connected: false, latencyMs: null, error: 'Supabase env vars not set', limits: null };

  const start = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const latency = Date.now() - start;

    return {
      name: 'Supabase',
      category: 'infra',
      connected: res.ok || res.status === 200,
      latencyMs: latency,
      error: null,
      limits: {
        label: 'Database',
        tier: 'Free / Pro',
        notes: 'Free: 500MB DB, 5GB bandwidth, 50k MAU. Pro: 8GB DB, 250GB bandwidth.',
      },
    };
  } catch (err) {
    return { name: 'Supabase', category: 'infra', connected: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err), limits: null };
  }
}

async function checkPublicAPI(): Promise<ServiceStatus> {
  const secret = process.env.PUBLIC_SECRET_KEY;
  if (!secret) return { name: 'Public.com', category: 'data', connected: false, latencyMs: null, error: 'PUBLIC_SECRET_KEY not set', limits: null };

  const start = Date.now();
  try {
    const res = await fetch('https://api.public.com/userapiauthservice/personal/access-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validityInMinutes: 60, secret }),
    });
    const latency = Date.now() - start;
    const data = await res.json().catch(() => null);

    return {
      name: 'Public.com',
      category: 'data',
      connected: res.ok && !!data?.token,
      latencyMs: latency,
      error: res.ok ? null : `HTTP ${res.status}`,
      limits: {
        label: 'Market Data API',
        tier: 'Personal',
        notes: 'Token valid 60min. Rate limits undocumented — estimated ~60 req/min.',
      },
    };
  } catch (err) {
    return { name: 'Public.com', category: 'data', connected: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err), limits: null };
  }
}

function checkYahooFinance(): ServiceStatus {
  return {
    name: 'Yahoo Finance',
    category: 'data',
    connected: true, // Unofficial API, no auth needed
    latencyMs: null,
    error: null,
    limits: {
      label: 'Chart Data (Unofficial)',
      tier: 'Public endpoint',
      notes: 'No auth required. Estimated ~100 req/hour before throttling. No official SLA.',
    },
  };
}

function checkResend(): ServiceStatus {
  const key = process.env.RESEND_API_KEY;
  return {
    name: 'Resend',
    category: 'infra',
    connected: !!key,
    latencyMs: null,
    error: key ? null : 'RESEND_API_KEY not set',
    limits: key ? {
      label: 'Email API',
      tier: 'Free / Pro',
      notes: 'Free: 100 emails/day, 3000/month. Pro: 50k/month.',
    } : null,
  };
}

function checkRedis(): ServiceStatus {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return {
    name: 'Upstash Redis',
    category: 'infra',
    connected: !!(url && token),
    latencyMs: null,
    error: url && token ? null : 'Redis env vars not set',
    limits: url && token ? {
      label: 'Cache / Rate Limiting',
      tier: 'Free / Pay-as-you-go',
      notes: 'Free: 10k commands/day. Pro: 500k/day.',
    } : null,
  };
}

function checkPinecone(): ServiceStatus {
  const key = process.env.PINECONE_API_KEY;
  return {
    name: 'Pinecone',
    category: 'infra',
    connected: !!key,
    latencyMs: null,
    error: key ? null : 'PINECONE_API_KEY not set',
    limits: key ? {
      label: 'Vector Database',
      tier: 'Free / Standard',
      notes: 'Free: 100k vectors. Standard: scales with usage.',
    } : null,
  };
}

function checkTwitter(): ServiceStatus {
  const clientId = process.env.X_CLIENT_ID;
  const apiKey = process.env.X_API_KEY;
  return {
    name: 'X (Twitter)',
    category: 'social',
    connected: !!(clientId || apiKey),
    latencyMs: null,
    error: clientId || apiKey ? null : 'X API credentials not set',
    limits: clientId || apiKey ? {
      label: 'Social API',
      tier: apiKey ? 'Basic / Pro' : 'OAuth only',
      notes: 'Free: 1500 posts/month read. Basic ($100/mo): 10k reads, 3k posts. Pro ($5k/mo): 1M reads, 300k posts.',
    } : null,
  };
}

function checkVercel(): ServiceStatus {
  return {
    name: 'Vercel',
    category: 'infra',
    connected: true,
    latencyMs: null,
    error: null,
    limits: {
      label: 'Hosting & Serverless',
      tier: 'Pro Trial',
      requests: { used: null, max: 1000000, window: 'per month (Pro)' },
      notes: 'Hobby: 100GB bandwidth, 100hr serverless. Pro: 1TB bandwidth, 1000hr serverless. Function timeout: 60s (Hobby) / 300s (Pro).',
    },
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await safeAuth();

    // Run live checks in parallel
    const [anthropic, openai, gemini, supabase, publicApi] = await Promise.all([
      checkAnthropic(),
      checkOpenAI(),
      checkGemini(),
      checkSupabase(),
      checkPublicAPI(),
    ]);

    // Static checks (no network call needed)
    const yahoo = checkYahooFinance();
    const resend = checkResend();
    const redis = checkRedis();
    const pinecone = checkPinecone();
    const twitter = checkTwitter();
    const vercel = checkVercel();

    const services: ServiceStatus[] = [
      anthropic, openai, gemini,
      publicApi, yahoo,
      supabase, redis, pinecone, vercel, resend,
      twitter,
    ];

    const summary = {
      total: services.length,
      connected: services.filter(s => s.connected).length,
      disconnected: services.filter(s => !s.connected).length,
      avgLatencyMs: Math.round(
        services.filter(s => s.latencyMs !== null).reduce((a, s) => a + (s.latencyMs ?? 0), 0) /
        (services.filter(s => s.latencyMs !== null).length || 1)
      ),
    };

    return NextResponse.json({ services, summary, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[API] Usage check error:', err);
    return NextResponse.json({ error: 'Failed to check usage' }, { status: 500 });
  }
}
