import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

interface ApiKeyInfo {
  name: string;
  service: string;
  category: 'ai' | 'data' | 'infra' | 'social';
  isSet: boolean;
  lastFour: string;
  setVia: 'env';
}

const KEY_REGISTRY: Array<{
  envVar: string;
  name: string;
  service: string;
  category: 'ai' | 'data' | 'infra' | 'social';
}> = [
  // AI Providers
  { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic API Key', service: 'Anthropic (Claude)', category: 'ai' },
  { envVar: 'OPENAI_API_KEY', name: 'OpenAI API Key', service: 'OpenAI (GPT-4o)', category: 'ai' },
  { envVar: 'GEMINI_API_KEY', name: 'Gemini API Key', service: 'Google Gemini', category: 'ai' },

  // Data APIs
  { envVar: 'FRED_API_KEY', name: 'FRED API Key', service: 'Federal Reserve (FRED)', category: 'data' },
  { envVar: 'FINNHUB_API_KEY', name: 'Finnhub API Key', service: 'Finnhub', category: 'data' },

  // Public.com
  { envVar: 'PUBLIC_SECRET_KEY', name: 'Public.com Secret Key', service: 'Public.com', category: 'data' },
  { envVar: 'PUBLIC_API_TOKEN', name: 'Public.com API Token', service: 'Public.com', category: 'data' },
  { envVar: 'PUBLIC_ACCOUNT_ID', name: 'Public.com Account ID', service: 'Public.com', category: 'data' },

  // Supabase
  { envVar: 'NEXT_PUBLIC_SUPABASE_URL', name: 'Supabase URL', service: 'Supabase', category: 'infra' },
  { envVar: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', name: 'Supabase Anon Key', service: 'Supabase', category: 'infra' },

  // Redis
  { envVar: 'UPSTASH_REDIS_REST_URL', name: 'Redis REST URL', service: 'Upstash Redis', category: 'infra' },
  { envVar: 'UPSTASH_REDIS_REST_TOKEN', name: 'Redis REST Token', service: 'Upstash Redis', category: 'infra' },

  // Vector DB
  { envVar: 'PINECONE_API_KEY', name: 'Pinecone API Key', service: 'Pinecone', category: 'infra' },

  // Email
  { envVar: 'RESEND_API_KEY', name: 'Resend API Key', service: 'Resend', category: 'infra' },

  // X (Twitter) OAuth 1.0a
  { envVar: 'X_API_KEY', name: 'X API Key (OAuth 1.0a)', service: 'X (Twitter)', category: 'social' },
  { envVar: 'X_API_SECRET', name: 'X API Secret (OAuth 1.0a)', service: 'X (Twitter)', category: 'social' },
  { envVar: 'X_ACCESS_TOKEN', name: 'X Access Token (OAuth 1.0a)', service: 'X (Twitter)', category: 'social' },
  { envVar: 'X_ACCESS_SECRET', name: 'X Access Secret (OAuth 1.0a)', service: 'X (Twitter)', category: 'social' },

  // X (Twitter) OAuth 2.0
  { envVar: 'X_CLIENT_ID', name: 'X Client ID (OAuth 2.0)', service: 'X (Twitter)', category: 'social' },
  { envVar: 'X_CLIENT_SECRET', name: 'X Client Secret (OAuth 2.0)', service: 'X (Twitter)', category: 'social' },

  // TradingView
  { envVar: 'TV_WEBHOOK_SECRET', name: 'TradingView Webhook Secret', service: 'TradingView', category: 'data' },
];

export async function GET() {
  try {
    await safeAuth();

    const keys: ApiKeyInfo[] = KEY_REGISTRY.map(({ envVar, name, service, category }) => {
      const value = process.env[envVar];
      const isSet = !!value;
      const lastFour = isSet && value ? `****${value.slice(-4)}` : '****XXXX';

      return {
        name,
        service,
        category,
        isSet,
        lastFour,
        setVia: 'env',
      };
    });

    return NextResponse.json({ keys, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[API] API key check error:', err);
    return NextResponse.json({ error: 'Failed to check API keys' }, { status: 500 });
  }
}
