import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number | null;
  message?: string;
}

async function checkSupabase(): Promise<HealthCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { name: 'Supabase', status: 'down', latencyMs: null, message: 'Env vars missing' };

  const start = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    return { name: 'Supabase', status: res.status < 500 ? 'healthy' : 'degraded', latencyMs: latency };
  } catch {
    return { name: 'Supabase', status: 'down', latencyMs: Date.now() - start, message: 'Connection failed' };
  }
}

async function checkClerck(): Promise<HealthCheck> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return { name: 'Clerk Auth', status: 'down', latencyMs: null, message: 'CLERK_SECRET_KEY missing' };
  return { name: 'Clerk Auth', status: 'healthy', latencyMs: null, message: 'Configured' };
}

function checkEnvVars(): HealthCheck {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY',
  ];
  const optional = [
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
    'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET',
    'X_CLIENT_ID', 'X_CLIENT_SECRET',
    'FRED_API_KEY', 'FINNHUB_API_KEY', 'TV_SESSION_ID',
    'CRON_SECRET', 'RESEND_API_KEY',
  ];
  const missingRequired = required.filter(k => !process.env[k]);
  const configuredOptional = optional.filter(k => !!process.env[k]);

  if (missingRequired.length > 0) {
    return { name: 'Environment', status: 'down', latencyMs: null, message: `Missing required: ${missingRequired.join(', ')}` };
  }
  return {
    name: 'Environment',
    status: 'healthy',
    latencyMs: null,
    message: `${configuredOptional.length}/${optional.length} optional keys configured`,
  };
}

// Production readiness checklist
interface ReadinessItem {
  id: string;
  category: 'security' | 'infrastructure' | 'data' | 'features' | 'performance';
  title: string;
  description: string;
  status: 'done' | 'in_progress' | 'todo' | 'critical';
  priority: 'critical' | 'high' | 'medium' | 'low';
}

function getReadinessChecklist(): ReadinessItem[] {
  return [
    // Security
    { id: 'rate-limiting', category: 'security', title: 'API Rate Limiting', description: 'Add Redis-based rate limiting middleware to all API routes', status: 'todo', priority: 'critical' },
    { id: 'admin-db', category: 'security', title: 'Move Admin Config to DB', description: 'Replace hardcoded admin emails with Supabase roles table', status: 'todo', priority: 'critical' },
    { id: 'public-reports-auth', category: 'security', title: 'Secure Public Reports Endpoint', description: 'Add authentication to /api/public/reports or add API key gating', status: 'todo', priority: 'critical' },
    { id: 'input-validation', category: 'security', title: 'Schema Validation (Zod)', description: 'Add Zod schemas for all API request bodies', status: 'todo', priority: 'high' },
    { id: 'cron-secret', category: 'security', title: 'Require Cron Secret', description: 'Make CRON_SECRET mandatory — reject all requests if unset', status: 'todo', priority: 'high' },
    { id: 'webhook-auth', category: 'security', title: 'Require Webhook Secrets', description: 'Make TV_WEBHOOK_SECRET mandatory for TradingView webhooks', status: 'todo', priority: 'medium' },

    // Infrastructure
    { id: 'error-tracking', category: 'infrastructure', title: 'Sentry Error Tracking', description: 'Configure @sentry/nextjs (already in deps, just needs init)', status: 'todo', priority: 'critical' },
    { id: 'structured-logging', category: 'infrastructure', title: 'Structured Logging', description: 'Replace console.* with Pino logger — levels, timestamps, request IDs', status: 'todo', priority: 'high' },
    { id: 'health-check', category: 'infrastructure', title: 'Deep Health Check', description: 'Health endpoint checks DB, external APIs, dependencies', status: 'done', priority: 'high' },
    { id: 'ws-fix', category: 'infrastructure', title: 'WebSocket Bundling Fix', description: 'Exclude ws from webpack to prevent mask() crash on Vercel', status: 'done', priority: 'critical' },
    { id: 'x-client', category: 'infrastructure', title: 'Shared X/Twitter Client', description: 'Consolidated 3 duplicate posting implementations into xClient.ts', status: 'done', priority: 'high' },
    { id: 'shared-hooks', category: 'infrastructure', title: 'Shared Hooks & Utilities', description: 'useUserData hook + formatters.ts replacing 27 duplicate implementations', status: 'done', priority: 'medium' },
    { id: 'nav-consolidation', category: 'infrastructure', title: 'Nav Consolidation', description: 'Merged 8 standalone pages into 3 hub tabs (Operations, Studio, Markets)', status: 'done', priority: 'medium' },
    { id: 'version-endpoint', category: 'infrastructure', title: 'Version / Build ID Endpoint', description: 'Add build commit hash and deploy timestamp to health check', status: 'todo', priority: 'medium' },

    // Data
    { id: 'db-indexes', category: 'data', title: 'Database Indexes', description: 'Add indexes on user_id, platform, status, created_at in Supabase', status: 'todo', priority: 'high' },
    { id: 'db-transactions', category: 'data', title: 'Database Transactions', description: 'Add locking/transactions to prevent double-post race conditions in cron', status: 'todo', priority: 'high' },
    { id: 'response-caching', category: 'data', title: 'Redis Response Caching', description: 'Cache enriched data (FRED, Finnhub, CoinGecko) — Redis client exists but unused', status: 'todo', priority: 'high' },
    { id: 'soft-deletes', category: 'data', title: 'Soft Deletes', description: 'Replace hard deletes with soft deletes (deleted_at column) for data recovery', status: 'todo', priority: 'medium' },
    { id: 'migrations', category: 'data', title: 'Schema Migrations', description: 'Version-controlled DB schema with migration files', status: 'todo', priority: 'medium' },

    // Features
    { id: 'billing-integration', category: 'features', title: 'Stripe Billing Integration', description: 'Add Stripe for subscription tiers and usage-based billing', status: 'todo', priority: 'critical' },
    { id: 'usage-limits', category: 'features', title: 'Usage Limits / Quotas', description: 'Enforce report generation, API call, and post limits per plan tier', status: 'todo', priority: 'critical' },
    { id: 'rbac', category: 'features', title: 'Role-Based Access Control', description: 'Add workspace roles (owner/editor/viewer) beyond admin flag', status: 'todo', priority: 'high' },
    { id: 'onboarding', category: 'features', title: 'User Onboarding Flow', description: 'Welcome wizard, initial configuration, data source setup', status: 'todo', priority: 'high' },
    { id: 'api-docs', category: 'features', title: 'API Documentation', description: 'OpenAPI/Swagger spec + /docs page for integrations', status: 'todo', priority: 'medium' },
    { id: 'multi-tenant', category: 'features', title: 'Multi-Tenant / Teams', description: 'Organization workspaces with shared access and delegated roles', status: 'todo', priority: 'low' },

    // Performance
    { id: 'bundle-optimization', category: 'performance', title: 'Bundle Optimization', description: 'Dynamic imports for heavy server libs (anthropic, openai, google-genai)', status: 'todo', priority: 'medium' },
    { id: 'sse-cleanup', category: 'performance', title: 'SSE Connection Management', description: 'Add heartbeats and timeouts to prevent memory leaks on SSE streams', status: 'todo', priority: 'medium' },
    { id: 'pagination', category: 'performance', title: 'API Pagination', description: 'Add limit/offset to list endpoints (reports, posts, tokens)', status: 'todo', priority: 'medium' },
  ];
}

export async function GET() {
  const start = Date.now();

  const [supabase, clerk] = await Promise.all([
    checkSupabase(),
    checkClerck(),
  ]);
  const env = checkEnvVars();

  const checks = [supabase, clerk, env];
  const allHealthy = checks.every(c => c.status === 'healthy');
  const anyDown = checks.some(c => c.status === 'down');

  const checklist = getReadinessChecklist();
  const done = checklist.filter(i => i.status === 'done').length;
  const total = checklist.length;
  const criticalTodo = checklist.filter(i => i.status !== 'done' && i.priority === 'critical').length;

  return NextResponse.json({
    status: anyDown ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    responseMs: Date.now() - start,
    checks,
    readiness: {
      score: Math.round((done / total) * 100),
      completed: done,
      total,
      criticalRemaining: criticalTodo,
      checklist,
    },
  });
}
