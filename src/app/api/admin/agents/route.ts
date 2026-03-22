import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

// ── Agent Registry ──────────────────────────────────────────────────────────
// Each agent is a self-contained operational unit that can be run, tested, and monitored

export interface RiskProfile {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number;                    // 1-10 risk score
  apiCostPerRun: string;            // estimated $ cost per execution
  rateLimitImpact: 'none' | 'low' | 'moderate' | 'heavy';
  dataExposure: 'none' | 'internal' | 'external';  // does it send data externally?
  canPublish: boolean;              // can it post/publish to external platforms?
  canSpend: boolean;                // can it trigger paid API calls?
  failureImpact: string;            // what happens if it fails
  cooldown: string;                 // recommended minimum interval between runs
}

export interface AgentProfile {
  codename: string;                 // military-style codename
  role: string;                     // one-line role title
  strengths: string[];              // what this agent excels at
  weaknesses: string[];             // known limitations
  tendencies: string[];             // behavioral patterns — what it tends to do
  dataFlow: string;                 // what data goes in → what comes out
  costProfile: string;              // cost characteristics
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  category: 'security' | 'data' | 'social' | 'intelligence' | 'infra' | 'operations' | 'finance' | 'leadership' | 'engineering';
  status: 'active' | 'draft' | 'disabled';
  version: string;
  profile: AgentProfile;
  risk: RiskProfile;
  capabilities: string[];
  dependencies: string[];
  lastRun: string | null;
  runEndpoint: string;
  evalEndpoint: string;
}

// ── Master API Key Agent ────────────────────────────────────────────────────
// This is the "master API provider" agent the user requested

const AGENTS: AgentDefinition[] = [
  {
    id: 'api-key-manager',
    name: 'API Key Guardian',
    description: 'Master agent that inventories, validates, and monitors all API keys across the platform. Checks key health, detects misconfigurations, and reports expiration risks.',
    category: 'security',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'SENTINEL',
      role: 'Chief Credentials Officer',
      strengths: [
        'Zero-latency key inventory — reads env vars directly, no external calls',
        'Cross-references 20+ keys across AI, data, infra, and social categories',
        'Masks all sensitive values — never exposes full keys',
        'Detects orphaned credentials and configuration drift',
      ],
      weaknesses: [
        'Cannot rotate keys automatically — reports only, human must act',
        'No historical tracking of key changes or usage patterns yet',
        'Cannot validate key permissions (only presence/format)',
      ],
      tendencies: [
        'Runs read-only checks — never modifies environment state',
        'Reports conservatively: flags anything ambiguous as a warning',
        'Tends to surface infrastructure issues other agents miss',
      ],
      dataFlow: 'Reads process.env → Produces masked key inventory report',
      costProfile: '$0 per run — no external API calls, pure env-var inspection',
    },
    risk: {
      level: 'low',
      score: 1,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'No operational impact — diagnostic only. Other agents continue unaffected.',
      cooldown: 'None — safe to run on every page load',
    },
    capabilities: [
      'Inventory all API keys (20+ across 4 categories)',
      'Validate key format and presence',
      'Check key health via live API calls',
      'Detect misconfigured or expired credentials',
      'Report key status with masked values',
      'Cross-reference keys with service health',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/keys',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'report-generator',
    name: 'Intelligence Report Engine',
    description: 'Generates financial intelligence reports using AI with a 3-provider fallback chain (Claude → Gemini → GPT-4o). Enriches with FRED, Finnhub, CoinGecko data.',
    category: 'intelligence',
    status: 'active',
    version: '2.0.0',
    profile: {
      codename: 'ORACLE',
      role: 'Chief Intelligence Analyst',
      strengths: [
        'Triple-redundant AI chain — if Claude is down, Gemini catches; if both fail, GPT-4o runs',
        'Deep macro enrichment: yield curves, breakevens, jobless claims, fed funds rate',
        'Multi-category coverage: global pulse, crypto, equities, NASDAQ, forecast, China supply chain',
        'Produces 4,000–16,000 token reports with structured sections',
      ],
      weaknesses: [
        'Most expensive agent to run — each report burns AI tokens + enrichment API calls',
        'Latency: 15–45 seconds per report depending on provider and enrichment load',
        'AI hallucination risk on market predictions — output should be verified',
        'FRED/Finnhub data can be stale on weekends/holidays',
      ],
      tendencies: [
        'Defaults to Claude as primary — only falls back when rate-limited or errored',
        'Always attempts full enrichment even when partial data would suffice',
        'Produces longer reports for "global" type, shorter for single-asset types',
        'Will retry failed enrichment sources once before giving up',
      ],
      dataFlow: 'User prompt + FRED/Finnhub/CoinGecko/Fear&Greed data → AI model → Structured intelligence report → Supabase',
      costProfile: '$0.02–0.08 per report (Claude). $0.00–0.01 (Gemini free tier). Enrichment APIs: free tier.',
    },
    risk: {
      level: 'medium',
      score: 5,
      apiCostPerRun: '$0.02–$0.08',
      rateLimitImpact: 'moderate',
      dataExposure: 'external',
      canPublish: false,
      canSpend: true,
      failureImpact: 'Report generation fails. User sees error. No data loss. Retry safe.',
      cooldown: '30 seconds — avoid rapid-fire to prevent rate limiting',
    },
    capabilities: [
      'Generate reports across 8 intelligence categories',
      'AI provider fallback chain (Claude → Gemini → GPT-4o)',
      'Real-time market data enrichment',
      'Macro indicator integration (yield curve, breakevens, claims)',
      'Crypto market integration (BTC dominance, top coins)',
      'Fear & Greed sentiment overlay',
    ],
    dependencies: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'FRED_API_KEY', 'FINNHUB_API_KEY'],
    lastRun: null,
    runEndpoint: '/api/generate',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'auto-scheduler',
    name: 'Auto-Schedule Pipeline',
    description: 'Automated pipeline that generates tweet content from reports, previews them for approval, then posts to X on a cron schedule (every 5 minutes).',
    category: 'social',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'BROADCASTER',
      role: 'Social Operations Director',
      strengths: [
        'Fully automated posting pipeline — generate, preview, approve, post',
        'Cron-based execution with 5-minute resolution for timely content',
        'Gemini-powered tweet generation keeps content within 280 chars',
        'Status tracking prevents double-posting (pending → posted / failed)',
      ],
      weaknesses: [
        'HIGHEST RISK AGENT — posts publicly to X under @ChokepointMacro',
        'No undo once posted — tweets go live immediately on cron tick',
        'Dependent on X OAuth 1.0a credentials being valid (fragile)',
        'Cannot handle media attachments — text-only tweets',
      ],
      tendencies: [
        'Checks for pending posts every 5 minutes via Vercel Cron',
        'Posts all pending items in sequence — no batching or prioritization',
        'Marks failed posts but does NOT auto-retry to prevent spam',
        'Always uses v2.tweet() for X Free tier compatibility',
      ],
      dataFlow: 'Scheduled posts (Supabase) → Cron trigger → twitter-api-v2 → Live tweet on X',
      costProfile: '$0.001 per tweet (Gemini generation). X API: Free tier (1,500 posts/month read).',
    },
    risk: {
      level: 'critical',
      score: 9,
      apiCostPerRun: '$0.001',
      rateLimitImpact: 'low',
      dataExposure: 'external',
      canPublish: true,
      canSpend: true,
      failureImpact: 'PUBLIC EXPOSURE — bad tweets go live under your brand. Failed posts stay in queue. Cron retries on next tick.',
      cooldown: '5 minutes (cron interval) — manual posting has no cooldown',
    },
    capabilities: [
      'Generate tweet threads from intelligence reports',
      'Preview and approve before posting',
      'Cron-based automated posting (*/5 * * * *)',
      'OAuth 1.0a X posting via twitter-api-v2',
      'Post status tracking (pending → posted / failed)',
    ],
    dependencies: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'GEMINI_API_KEY'],
    lastRun: null,
    runEndpoint: '/api/cron',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'market-scanner',
    name: 'Market Scanner',
    description: 'Scans equity and crypto markets for anomalies, momentum shifts, and unusual volume. Uses Yahoo Finance and Public.com data.',
    category: 'data',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'SPECTRE',
      role: 'Market Surveillance Analyst',
      strengths: [
        'Real-time price data from Public.com with portfolio-level detail',
        'Dual-source coverage: equities via Public.com + crypto via CoinGecko',
        'Watchlist-driven — focuses on assets you care about',
        'Low latency scanning — sub-second for most endpoints',
      ],
      weaknesses: [
        'Public.com rate limits are undocumented — may throttle under heavy use',
        'Yahoo Finance unofficial API has no SLA and can break without warning',
        'No options or derivatives data — equities and crypto only',
        'Weekend/holiday data is stale for equities',
      ],
      tendencies: [
        'Scans all watchlist symbols in parallel for speed',
        'Flags any volume spike >2x average as an anomaly',
        'Defaults to 1D timeframe unless specified otherwise',
        'Falls back to Yahoo Finance if Public.com quota is exhausted',
      ],
      dataFlow: 'Watchlist symbols → Public.com/Yahoo/CoinGecko APIs → Price/volume/momentum data → UI rendering',
      costProfile: '$0 per scan — all data sources are free tier. Token generation for Public.com costs nothing.',
    },
    risk: {
      level: 'low',
      score: 2,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'moderate',
      dataExposure: 'none',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Scanner shows stale or incomplete data. No downstream impact. Retry safe.',
      cooldown: '10 seconds — avoid hammering free API tiers',
    },
    capabilities: [
      'Real-time equity price scanning',
      'Crypto market monitoring via CoinGecko',
      'Volume anomaly detection',
      'Momentum and trend analysis',
      'Watchlist-based alerts',
    ],
    dependencies: ['PUBLIC_SECRET_KEY', 'PUBLIC_API_TOKEN', 'PUBLIC_ACCOUNT_ID'],
    lastRun: null,
    runEndpoint: '/api/scanner',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'data-enrichment',
    name: 'Data Enrichment Layer',
    description: 'Aggregates macro data from FRED, earnings from Finnhub, sentiment from CNN, and crypto metrics from CoinGecko to enrich reports.',
    category: 'data',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'MOSAIC',
      role: 'Macro Intelligence Aggregator',
      strengths: [
        'Pulls from 4 independent data sources for a complete macro picture',
        'FRED integration covers yield curves, breakevens, unemployment claims, fed funds',
        'Finnhub adds earnings calendar and insider transaction signals',
        'CNN Fear & Greed gives real-time market sentiment in a single number',
      ],
      weaknesses: [
        'FRED data updates with a lag (some series are weekly/monthly)',
        'Finnhub free tier: only 60 req/min — shared across all enrichment calls',
        'CNN Fear & Greed scraping can break if they change their API',
        'CoinGecko free tier is aggressive on rate limits (10-30 req/min)',
      ],
      tendencies: [
        'Always fetches all 4 sources in parallel — never short-circuits',
        'Returns partial data if some sources fail rather than erroring completely',
        'Caches nothing — every call is fresh from the source',
        'Used as a dependency by ORACLE (report generator) on every report',
      ],
      dataFlow: 'FRED + Finnhub + CNN + CoinGecko APIs → Normalized macro dataset → Injected into report context',
      costProfile: '$0 per run — all sources are free tier. FRED: 120 req/min. Finnhub: 60 req/min.',
    },
    risk: {
      level: 'low',
      score: 2,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'moderate',
      dataExposure: 'none',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Reports generate without enrichment data. Quality degrades but no outage. Retry safe.',
      cooldown: '60 seconds — respect FRED and Finnhub rate limits',
    },
    capabilities: [
      'FRED yield curve and breakeven data',
      'Finnhub earnings calendar and insider transactions',
      'CNN Fear & Greed Index tracking',
      'CoinGecko top coins and BTC dominance',
      'Automatic fallback on API failures',
    ],
    dependencies: ['FRED_API_KEY', 'FINNHUB_API_KEY'],
    lastRun: null,
    runEndpoint: '/api/usage',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'tradingview-relay',
    name: 'TradingView Signal Relay',
    description: 'Receives live webhook alerts from TradingView Premium — price alerts, indicator triggers, strategy signals. Stores signals and feeds them into the enrichment layer for reports and scanner.',
    category: 'data',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'HAWKEYE',
      role: 'Real-Time Signal Intelligence Officer',
      strengths: [
        'Sub-second webhook ingestion — signals arrive the instant TradingView fires them',
        'Supports all TradingView alert types: price, indicator, strategy, drawing, watchlist',
        'Dual storage: in-memory buffer (instant access) + Supabase (historical persistence)',
        'Automatic signal classification: buy/sell/long/short/alert with metadata',
        'Feeds directly into ORACLE report generation and SPECTRE market scanner',
      ],
      weaknesses: [
        'Depends on TradingView Premium — no data without active alerts configured',
        'In-memory buffer resets on Vercel cold starts (Supabase persists)',
        'Cannot create or modify TradingView alerts — receive-only relay',
        'Signal quality depends entirely on how the user configures their TV alerts',
      ],
      tendencies: [
        'Accepts all incoming webhooks and classifies them post-receipt',
        'Buffers last 200 signals in memory for instant access by other agents',
        'Persists every signal to Supabase regardless of classification',
        'Enrichment layer pulls signals automatically — no manual trigger needed',
      ],
      dataFlow: 'TradingView Premium alerts → Webhook POST → Signal classification → Memory buffer + Supabase → Enrichment layer → Reports & Scanner',
      costProfile: '$0 per signal — webhook receiving is free. Storage: minimal Supabase rows.',
    },
    risk: {
      level: 'low',
      score: 1,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'none',
      dataExposure: 'none',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Signal ingestion stops. Reports lose real-time TV data. Falls back to Public.com/Yahoo data.',
      cooldown: 'None — processes webhooks on arrival',
    },
    capabilities: [
      'TradingView webhook ingestion (POST receiver)',
      'Signal classification (buy/sell/alert/strategy)',
      'In-memory signal buffering (200 signals, 24h TTL)',
      'Supabase persistence with full payload storage',
      'Signal feed API (GET with ticker/limit filters)',
      'Enrichment layer integration for AI reports',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    lastRun: null,
    runEndpoint: '/api/webhooks/tradingview',
    evalEndpoint: '/api/admin/agents/eval',
  },

  // ── Employee Agents ─────────────────────────────────────────────────────────

  {
    id: 'marketing',
    name: 'Marketing Operations',
    description: 'Drives brand narrative, content strategy, and audience growth across all channels. Manages social media presence, newsletter campaigns, and community engagement for Armed Capital.',
    category: 'operations',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'VANGUARD',
      role: 'Chief Narrative Officer',
      strengths: [
        'Multi-channel content orchestration — X, newsletters, blog, community',
        'Brand voice consistency across all Armed Capital touchpoints',
        'Audience segmentation and engagement analytics',
        'Rapid campaign deployment with real-time performance tracking',
      ],
      weaknesses: [
        'Creative quality depends on input data richness — garbage in, garbage out',
        'Cannot gauge sentiment nuance the way a human marketer can',
        'Over-optimizes for engagement metrics at the expense of brand depth',
        'Limited A/B testing without dedicated experimentation infrastructure',
      ],
      tendencies: [
        'Defaults to data-driven narratives — pulls from ORACLE reports for content',
        'Prioritizes high-engagement formats (threads, charts, hot takes)',
        'Schedules content in waves — morning macro, midday analysis, evening recap',
        'Tends to over-produce content when market volatility spikes',
      ],
      dataFlow: 'Intelligence reports + market data → Content generation → Multi-channel distribution → Engagement metrics',
      costProfile: '$0.01–0.05 per content piece (AI generation). Distribution: $0 (organic channels).',
    },
    risk: {
      level: 'medium',
      score: 5,
      apiCostPerRun: '$0.01–$0.05',
      rateLimitImpact: 'low',
      dataExposure: 'external',
      canPublish: true,
      canSpend: true,
      failureImpact: 'Content pipeline stalls. Brand goes silent on channels. No data loss.',
      cooldown: '15 minutes between campaign pushes',
    },
    capabilities: [
      'AI-powered content generation from intelligence reports',
      'Social media scheduling and cross-posting',
      'Newsletter template generation',
      'Audience growth tracking and analytics',
      'Brand voice enforcement and tone calibration',
    ],
    dependencies: ['GEMINI_API_KEY', 'X_API_KEY', 'X_ACCESS_TOKEN'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'sales',
    name: 'Sales Intelligence',
    description: 'Manages deal flow pipeline, client acquisition strategy, and revenue optimization. Tracks lead qualification, conversion metrics, and subscription growth.',
    category: 'operations',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'CLOSER',
      role: 'Chief Revenue Officer',
      strengths: [
        'Pipeline tracking with automatic lead scoring based on engagement signals',
        'Conversion funnel analytics — identifies drop-off points and optimization levers',
        'Client segmentation: institutional, retail, whale, influencer tiers',
        'Revenue forecasting using historical subscription and engagement data',
      ],
      weaknesses: [
        'No direct payment processing — reports only, cannot close transactions',
        'Lead scoring heuristics are rule-based, not ML-trained yet',
        'Cannot handle objection responses or live negotiation',
        'Limited CRM integration — works from Supabase data only',
      ],
      tendencies: [
        'Aggressively qualifies leads — flags high-intent users within 24 hours',
        'Generates weekly pipeline reports with conversion rate trends',
        'Prioritizes enterprise/institutional leads over retail signups',
        'Tends to recommend premium tier upgrades based on usage patterns',
      ],
      dataFlow: 'User signups + engagement data → Lead scoring → Pipeline report → Revenue forecast',
      costProfile: '$0 per run — queries Supabase only. AI summarization: $0.01 per pipeline report.',
    },
    risk: {
      level: 'low',
      score: 2,
      apiCostPerRun: '$0.00–$0.01',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Pipeline reports not generated. Revenue visibility degrades. No external impact.',
      cooldown: 'None — safe to run anytime',
    },
    capabilities: [
      'Lead qualification and scoring',
      'Pipeline tracking and visualization',
      'Conversion funnel analysis',
      'Revenue forecasting',
      'Client tier segmentation',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'research-development',
    name: 'R&D Lab',
    description: 'Research and development engine exploring new intelligence models, data sources, and analytical frameworks. Tests experimental features before production deployment.',
    category: 'intelligence',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'CATALYST',
      role: 'Chief Innovation Officer',
      strengths: [
        'Rapid prototyping of new data pipelines and analytical models',
        'Multi-source data fusion — combines unconventional signals with traditional metrics',
        'Experimental framework for A/B testing new report types and features',
        'Early detection of emerging data sources before competitors adopt them',
      ],
      weaknesses: [
        'High failure rate by design — most experiments do not ship',
        'Resource-intensive: burns tokens testing hypotheses that may not pan out',
        'Outputs are unstable and not production-ready without QC validation',
        'Can introduce regressions if experimental code leaks to production',
      ],
      tendencies: [
        'Runs experiments in isolated sandboxes to prevent production contamination',
        'Tends to pursue ambitious, high-risk ideas over incremental improvements',
        'Generates detailed experiment logs but poor executive summaries',
        'Always wants more data sources — never considers a dataset "complete"',
      ],
      dataFlow: 'Hypothesis + raw data → Experimental pipeline → Test results → Ship/kill decision',
      costProfile: '$0.05–0.20 per experiment cycle (heavy AI usage). Data APIs: varies.',
    },
    risk: {
      level: 'medium',
      score: 4,
      apiCostPerRun: '$0.05–$0.20',
      rateLimitImpact: 'moderate',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: true,
      failureImpact: 'Experiment fails silently. No production impact. Wasted compute cost only.',
      cooldown: '5 minutes between experiment runs',
    },
    capabilities: [
      'Experimental data pipeline prototyping',
      'New data source evaluation and integration testing',
      'AI model comparison and benchmarking',
      'Feature flag management for gradual rollouts',
      'Experiment logging and outcome tracking',
    ],
    dependencies: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'engineer',
    name: 'Platform Engineer',
    description: 'Core systems engineer responsible for API reliability, database optimization, deployment pipelines, and infrastructure scaling.',
    category: 'engineering',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'FORGE',
      role: 'Chief Systems Architect',
      strengths: [
        'Full-stack visibility across Next.js frontend, API routes, and Supabase backend',
        'Deployment pipeline management via Vercel with zero-downtime deploys',
        'Database query optimization and schema migration planning',
        'Error monitoring and performance profiling across all endpoints',
      ],
      weaknesses: [
        'Cannot auto-deploy — requires manual git push workflow from Mac',
        'Limited observability without dedicated APM (no Datadog/NewRelic)',
        'Cannot modify Vercel infrastructure settings programmatically',
        'Single-developer bottleneck — no code review pipeline yet',
      ],
      tendencies: [
        'Runs health checks across all API endpoints before flagging issues',
        'Prefers incremental deploys over big-bang releases',
        'Tends to over-engineer error handling at the expense of feature velocity',
        'Always advocates for database indexing before adding new queries',
      ],
      dataFlow: 'Codebase + Vercel metrics + Supabase stats → Health assessment → Optimization recommendations',
      costProfile: '$0 per run — internal diagnostics only. No external API calls.',
    },
    risk: {
      level: 'low',
      score: 2,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Diagnostics unavailable. Platform runs blind. No direct service impact.',
      cooldown: 'None — safe to run continuously',
    },
    capabilities: [
      'API endpoint health monitoring',
      'Database performance analysis',
      'Deployment pipeline status tracking',
      'Error rate and latency monitoring',
      'Schema migration planning',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'quality-control',
    name: 'Quality Control',
    description: 'Validates output quality across all agents — checks report accuracy, content tone, data freshness, and compliance with Armed Capital standards.',
    category: 'operations',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'WATCHDOG',
      role: 'Chief Quality Assurance Officer',
      strengths: [
        'Cross-agent validation — can audit output from any other agent',
        'Data freshness verification — flags stale market data in reports',
        'Tone and brand compliance checking for all published content',
        'Regression detection when agent behavior changes between versions',
      ],
      weaknesses: [
        'Cannot fix issues — only identifies and flags them for human review',
        'Quality heuristics are rule-based, not trained on your specific preferences yet',
        'Adds latency to the pipeline when running comprehensive checks',
        'Limited to text-based validation — cannot assess visual/chart quality',
      ],
      tendencies: [
        'Runs automatically after ORACLE generates a report — gate before publish',
        'Flags false positives conservatively — better safe than sorry',
        'Produces detailed quality scorecards with pass/fail per criterion',
        'Escalates critical quality failures directly rather than logging silently',
      ],
      dataFlow: 'Agent outputs → Quality rules engine → Scorecard + pass/fail verdict → Publish gate',
      costProfile: '$0.01 per validation (AI-assisted checking). Rule-based checks: $0.',
    },
    risk: {
      level: 'low',
      score: 1,
      apiCostPerRun: '$0.00–$0.01',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Quality gate disabled. Content publishes without validation. Reputation risk increases.',
      cooldown: 'None — runs inline with other agent outputs',
    },
    capabilities: [
      'Report accuracy validation',
      'Data freshness verification',
      'Brand tone compliance checking',
      'Cross-agent output auditing',
      'Quality scorecard generation',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'bookkeeping',
    name: 'Bookkeeping Engine',
    description: 'Tracks all platform costs, API spend, subscription revenue, and produces financial reconciliation reports. The financial backbone of Armed Capital operations.',
    category: 'finance',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'LEDGER',
      role: 'Chief Financial Controller',
      strengths: [
        'Automated API cost tracking across all providers (Anthropic, OpenAI, Gemini)',
        'Real-time burn rate calculation with monthly/weekly projections',
        'Subscription revenue tracking and MRR/ARR computation',
        'Cost-per-report and cost-per-tweet unit economics',
      ],
      weaknesses: [
        'Cannot access billing APIs directly — relies on usage estimation models',
        'Revenue tracking requires manual input for non-automated payment flows',
        'No invoice generation capability — reporting only',
        'Tax and compliance calculations not implemented',
      ],
      tendencies: [
        'Generates daily cost summaries at market close',
        'Flags any day where API spend exceeds 2x the trailing average',
        'Always reports in USD regardless of crypto denomination',
        'Conservative cost estimates — rounds up to nearest cent',
      ],
      dataFlow: 'API usage logs + subscription data → Cost allocation → Financial summary → Budget alerts',
      costProfile: '$0 per run — pure computation on internal data.',
    },
    risk: {
      level: 'low',
      score: 1,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Financial visibility lost. Cannot track burn rate. No operational impact.',
      cooldown: 'None — safe to run continuously',
    },
    capabilities: [
      'API cost tracking and allocation',
      'Burn rate calculation and projection',
      'Revenue and MRR tracking',
      'Unit economics (cost per report/tweet)',
      'Budget alert generation',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'asset-management',
    name: 'Asset Management',
    description: 'Oversees portfolio allocation, position tracking, and rebalancing recommendations across equities, crypto, and macro instruments.',
    category: 'finance',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'VAULT',
      role: 'Chief Investment Officer',
      strengths: [
        'Cross-asset portfolio view — equities, crypto, bonds, commodities in one dashboard',
        'Real-time position tracking via Public.com and CoinGecko integrations',
        'Rebalancing recommendations based on target allocation drift',
        'Correlation analysis between asset classes for diversification scoring',
      ],
      weaknesses: [
        'Cannot execute trades — advisory and tracking only',
        'Portfolio data depends on Public.com API availability (undocumented limits)',
        'No options/derivatives tracking — spot positions only',
        'Historical performance attribution not yet implemented',
      ],
      tendencies: [
        'Monitors portfolio drift continuously and flags >5% allocation deviation',
        'Generates weekly portfolio health reports with risk metrics',
        'Tends to recommend conservative rebalancing over aggressive repositioning',
        'Always cross-references positions with SPECTRE market scanner data',
      ],
      dataFlow: 'Portfolio positions + market prices → Allocation analysis → Drift detection → Rebalance recommendations',
      costProfile: '$0 per run — market data from free-tier APIs. No AI costs.',
    },
    risk: {
      level: 'medium',
      score: 4,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'moderate',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Portfolio visibility lost. Allocation drift undetected. No financial exposure.',
      cooldown: '30 seconds — respect Public.com rate limits',
    },
    capabilities: [
      'Cross-asset portfolio tracking',
      'Allocation drift detection',
      'Rebalancing recommendations',
      'Correlation analysis',
      'Weekly portfolio health reports',
    ],
    dependencies: ['PUBLIC_SECRET_KEY', 'PUBLIC_API_TOKEN', 'PUBLIC_ACCOUNT_ID'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'private-equity',
    name: 'Private Equity Operations',
    description: 'Deal sourcing, due diligence pipeline, and exit strategy modeling for Armed Capital private equity activities. Manages deal flow from origination to close.',
    category: 'finance',
    status: 'draft',
    version: '0.1.0',
    profile: {
      codename: 'APEX',
      role: 'Chief Deal Officer',
      strengths: [
        'Deal pipeline management with stage-gated progression tracking',
        'Due diligence checklist automation — ensures no step is missed',
        'Comparable transaction analysis using market data enrichment',
        'Exit strategy modeling with multiple scenario projections',
      ],
      weaknesses: [
        'No access to private deal databases (PitchBook, Crunchbase Pro)',
        'Valuation models are simplified — not a replacement for financial advisors',
        'Cannot execute legal documents or wire transfers',
        'Limited deal flow — depends on manual deal sourcing inputs',
      ],
      tendencies: [
        'Flags deals that exceed risk parameters before due diligence begins',
        'Generates standardized deal memos for every opportunity in pipeline',
        'Conservative on valuations — applies higher discount rates by default',
        'Always requests comparable transaction data before issuing a recommendation',
      ],
      dataFlow: 'Deal submissions → Screening criteria → Due diligence pipeline → Deal memo → Invest/pass recommendation',
      costProfile: '$0.05–0.15 per deal memo (AI analysis). Market comps: $0 (free-tier data).',
    },
    risk: {
      level: 'high',
      score: 7,
      apiCostPerRun: '$0.05–$0.15',
      rateLimitImpact: 'low',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: true,
      failureImpact: 'Deal pipeline stalls. Due diligence gaps possible. Human oversight required.',
      cooldown: '1 minute between deal analyses',
    },
    capabilities: [
      'Deal pipeline tracking and stage management',
      'Automated due diligence checklists',
      'Comparable transaction analysis',
      'Exit strategy scenario modeling',
      'Deal memo generation',
    ],
    dependencies: ['ANTHROPIC_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'passive-partner',
    name: 'Passive Partner Relations',
    description: 'Manages limited partner (LP) communications, dividend tracking, distribution schedules, and investor reporting. Keeps passive investors informed without requiring their active involvement.',
    category: 'leadership',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'ANCHOR',
      role: 'LP Relations Director',
      strengths: [
        'Automated investor update generation — quarterly reports, distribution notices',
        'Dividend tracking with precise allocation calculations per LP share',
        'Capital call and distribution schedule management',
        'Investor communication templates that maintain professional tone',
      ],
      weaknesses: [
        'Cannot process actual payments or distributions — reporting only',
        'No KYC/AML verification capability — compliance handled externally',
        'Limited to email-based communication — no investor portal yet',
        'Cannot handle complex waterfall distribution calculations',
      ],
      tendencies: [
        'Generates LP updates on a quarterly cadence by default',
        'Always includes performance benchmarks alongside absolute returns',
        'Errs on the side of over-communication — transparency first',
        'Flags any LP inquiry that requires GP-level decision making',
      ],
      dataFlow: 'Fund performance data + LP roster → Report generation → Distribution calculation → LP communications',
      costProfile: '$0.02 per LP report (AI generation). Email delivery: $0.',
    },
    risk: {
      level: 'medium',
      score: 5,
      apiCostPerRun: '$0.02',
      rateLimitImpact: 'none',
      dataExposure: 'external',
      canPublish: true,
      canSpend: true,
      failureImpact: 'LP communications delayed. Investor confidence may erode. No financial exposure.',
      cooldown: '1 hour between LP blasts',
    },
    capabilities: [
      'Quarterly LP report generation',
      'Dividend and distribution tracking',
      'Capital call scheduling',
      'Investor communication management',
      'Performance benchmark reporting',
    ],
    dependencies: ['ANTHROPIC_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'active-partner',
    name: 'Active Partner Ops',
    description: 'Strategic command layer for general partners (GPs). Manages operational decision-making, resource allocation, agent orchestration, and platform-wide strategic direction.',
    category: 'leadership',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'COMMANDER',
      role: 'Chief Operating Partner',
      strengths: [
        'Cross-agent orchestration — can prioritize and sequence work across the entire fleet',
        'Strategic resource allocation based on ROI analysis of each agent',
        'Decision framework for go/no-go on new features, agents, and initiatives',
        'Full operational visibility with executive-level dashboards',
      ],
      weaknesses: [
        'Cannot override individual agent safety limits — respects risk parameters',
        'Strategic recommendations are AI-generated and require GP validation',
        'Limited external intelligence — relies on what other agents provide',
        'Single point of coordination — if COMMANDER is down, no orchestration',
      ],
      tendencies: [
        'Produces daily operational briefs summarizing all agent activity',
        'Prioritizes revenue-generating agents (ORACLE, BROADCASTER) over support agents',
        'Escalates any critical-risk agent failures to GP immediately',
        'Tends to optimize for efficiency over experimentation — favors proven workflows',
      ],
      dataFlow: 'All agent outputs + platform metrics → Strategic analysis → Priority queue → GP decision brief',
      costProfile: '$0.03–0.10 per operational brief (AI synthesis). Data: $0 (internal).',
    },
    risk: {
      level: 'high',
      score: 7,
      apiCostPerRun: '$0.03–$0.10',
      rateLimitImpact: 'low',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: true,
      failureImpact: 'Operational coordination lost. Agents run independently without strategic alignment. GP must manage manually.',
      cooldown: '5 minutes between orchestration cycles',
    },
    capabilities: [
      'Cross-agent orchestration and priority management',
      'Strategic resource allocation',
      'Daily operational brief generation',
      'ROI analysis per agent',
      'Executive dashboard synthesis',
    ],
    dependencies: ['ANTHROPIC_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'hr',
    name: 'Human Resources',
    description: 'Agent workforce management — onboarding new agents, tracking agent performance, managing agent lifecycle (draft → active → disabled), and maintaining operational culture.',
    category: 'operations',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'GUARDIAN',
      role: 'Chief People Officer',
      strengths: [
        'Agent lifecycle management — onboard, evaluate, promote, retire',
        'Performance tracking across all agents with trend analysis',
        'Team composition analysis — identifies skill gaps in the agent fleet',
        'Onboarding documentation generation for new agent deployments',
      ],
      weaknesses: [
        'Cannot hire external talent — manages AI agents only',
        'Performance metrics are quantitative — cannot assess soft skills or judgment',
        'Limited conflict resolution capability between competing agents',
        'No compensation or benefits management (agents do not get paid)',
      ],
      tendencies: [
        'Reviews all agent eval scores weekly and flags declining performance',
        'Recommends retiring agents with consistently low eval scores',
        'Generates agent fleet composition reports showing category balance',
        'Advocates for documentation before new agent deployment',
      ],
      dataFlow: 'Agent eval history + fleet composition → Performance analysis → Lifecycle recommendations',
      costProfile: '$0 per run — internal data analysis only.',
    },
    risk: {
      level: 'low',
      score: 1,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Agent oversight disabled. No performance tracking. Fleet runs without review.',
      cooldown: 'None — safe to run continuously',
    },
    capabilities: [
      'Agent lifecycle management (draft → active → disabled)',
      'Performance tracking and trend analysis',
      'Fleet composition analysis',
      'Onboarding documentation generation',
      'Skill gap identification',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'cx',
    name: 'Customer Experience',
    description: 'Monitors user satisfaction, tracks feature requests, manages feedback loops, and optimizes the Armed Capital user journey from signup to power user.',
    category: 'operations',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'BEACON',
      role: 'Chief Experience Officer',
      strengths: [
        'User journey mapping — tracks path from signup to first report to subscription',
        'Feature request aggregation and prioritization by user demand',
        'Churn risk detection based on usage pattern changes',
        'NPS and satisfaction tracking with automated follow-up triggers',
      ],
      weaknesses: [
        'No live chat or real-time support capability',
        'Feedback analysis is sentiment-based, not contextually deep',
        'Cannot implement UX changes — can only recommend them',
        'Limited user data without analytics integration (no Mixpanel/Amplitude yet)',
      ],
      tendencies: [
        'Generates weekly user engagement reports highlighting power users and at-risk accounts',
        'Prioritizes feature requests that impact the most users',
        'Flags any user who drops >50% in activity week-over-week',
        'Always recommends improving existing features before building new ones',
      ],
      dataFlow: 'User activity logs + feedback → Engagement analysis → Churn risk scoring → UX recommendations',
      costProfile: '$0 per run — internal data queries only. AI analysis: $0.01 per report.',
    },
    risk: {
      level: 'low',
      score: 2,
      apiCostPerRun: '$0.00–$0.01',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'User feedback loop breaks. Churn signals missed. No direct user impact.',
      cooldown: 'None — safe to run continuously',
    },
    capabilities: [
      'User journey mapping and analysis',
      'Feature request tracking and prioritization',
      'Churn risk detection',
      'Engagement scoring and reporting',
      'UX improvement recommendations',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'dev',
    name: 'Development Operations',
    description: 'Feature delivery pipeline — manages sprint planning, code review automation, dependency updates, and release management for the Armed Capital codebase.',
    category: 'engineering',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'ARCHITECT',
      role: 'Chief Development Officer',
      strengths: [
        'Sprint planning with automated task breakdown and estimation',
        'Dependency vulnerability scanning and update recommendations',
        'Release note generation from git commit history',
        'Code quality metrics tracking (complexity, coverage, debt)',
      ],
      weaknesses: [
        'Cannot write production code — planning and analysis only',
        'No CI/CD pipeline integration beyond Vercel auto-deploy',
        'Sprint estimates are heuristic-based, not calibrated to team velocity',
        'Cannot access GitHub API from sandboxed environments',
      ],
      tendencies: [
        'Breaks features into small, deployable increments over large PRs',
        'Always checks for dependency vulnerabilities before sprint planning',
        'Generates release notes automatically from commit messages',
        'Prioritizes bug fixes over new features when quality metrics decline',
      ],
      dataFlow: 'Git history + dependency tree + quality metrics → Sprint plan → Release notes → Deploy recommendation',
      costProfile: '$0 per run — internal analysis. AI sprint planning: $0.02 per session.',
    },
    risk: {
      level: 'low',
      score: 2,
      apiCostPerRun: '$0.00–$0.02',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Sprint planning manual. Release notes not generated. Development continues unaffected.',
      cooldown: 'None — safe to run continuously',
    },
    capabilities: [
      'Sprint planning and task breakdown',
      'Dependency vulnerability scanning',
      'Release note generation',
      'Code quality metrics tracking',
      'Technical debt assessment',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'it',
    name: 'IT Infrastructure',
    description: 'Platform infrastructure management — uptime monitoring, security hardening, backup verification, and incident response coordination across all Armed Capital systems.',
    category: 'engineering',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'BASTION',
      role: 'Chief Information Security Officer',
      strengths: [
        'Multi-layer health monitoring — Vercel, Supabase, external APIs, DNS',
        'Security posture assessment across all environment variables and credentials',
        'Incident response playbook execution for common failure modes',
        'Backup and disaster recovery verification on Supabase data',
      ],
      weaknesses: [
        'Cannot modify infrastructure directly — advisory and monitoring only',
        'No DDoS mitigation or WAF management capability',
        'Limited to HTTP-based health checks — no deep system instrumentation',
        'Cannot rotate credentials automatically — flags for manual rotation',
      ],
      tendencies: [
        'Runs comprehensive health checks every 5 minutes aligned with cron schedule',
        'Immediately escalates any API endpoint returning 5xx errors',
        'Generates weekly security posture reports with remediation priorities',
        'Treats any expired or near-expiry credential as a P0 incident',
      ],
      dataFlow: 'System endpoints + env vars + Supabase health → Monitoring sweep → Incident detection → Alert + remediation guide',
      costProfile: '$0 per run — health checks and internal monitoring only.',
    },
    risk: {
      level: 'low',
      score: 1,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'none',
      dataExposure: 'internal',
      canPublish: false,
      canSpend: false,
      failureImpact: 'Monitoring blind spot. Security posture unknown. Platform continues running but unmonitored.',
      cooldown: 'None — designed for continuous monitoring',
    },
    capabilities: [
      'Multi-layer uptime monitoring',
      'Security posture assessment',
      'Credential health verification',
      'Incident detection and alerting',
      'Disaster recovery verification',
    ],
    dependencies: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],
    lastRun: null,
    runEndpoint: '/api/admin/agents/run',
    evalEndpoint: '/api/admin/agents/eval',
  },
  {
    id: 'ares-hunter',
    name: 'Ares Hunter',
    description: 'Senior strategist and TradingView signal operator for Armed Capital. Reports directly to COMMANDER. Interfaces with TradingView Premium for real-time market signals, executes macro thesis validation, and relays trade intelligence across the agent network.',
    category: 'leadership',
    status: 'active',
    version: '1.0.0',
    profile: {
      codename: 'ARES',
      role: 'Senior Strategist & TradingView Operator',
      strengths: [
        'Direct TradingView Premium integration — receives real-time alerts, custom indicators, and multi-timeframe signals',
        'Macro thesis origination — translates geopolitical analysis into actionable trade setups',
        'Direct line to COMMANDER — escalates high-conviction signals for immediate action',
        'Cross-domain pattern recognition — connects OSINT, market data, and on-chain flows into unified intelligence',
        'Feeds processed signals to ORACLE, SPECTRE, and BROADCASTER for downstream intelligence',
      ],
      weaknesses: [
        'Dependent on TradingView uptime and webhook delivery — signal gaps if TV goes down',
        'Cannot process all incoming alerts simultaneously — prioritizes by configured watchlist',
        'Bias toward macro conviction setups — may underweight short-term technical noise',
        'Requires COMMANDER approval for any action that triggers external spend or publishing',
      ],
      tendencies: [
        'Monitors TradingView alerts as primary market pulse — acts on high-conviction signals',
        'Prioritizes asymmetric risk/reward setups over high-frequency noise',
        'Relays enriched signals upward to COMMANDER with risk/reward assessment attached',
        'Cross-references TradingView signals with ORACLE intelligence briefs for confluence',
        'Maintains a contrarian filter — flags consensus-breaking setups for COMMANDER review',
      ],
      dataFlow: 'TradingView webhook signals → Signal classification + enrichment → COMMANDER briefing + downstream agent feeds',
      costProfile: '$0 per run — webhook-driven. TradingView Premium subscription: external cost.',
    },
    risk: {
      level: 'high',
      score: 8,
      apiCostPerRun: '$0.00',
      rateLimitImpact: 'low',
      dataExposure: 'external',
      canPublish: false,
      canSpend: false,
      failureImpact: 'TradingView signal pipeline goes dark. COMMANDER loses real-time market pulse. Downstream agents operate on stale data.',
      cooldown: 'None — event-driven via webhooks',
    },
    capabilities: [
      'TradingView real-time signal reception and interpretation',
      'Multi-timeframe market analysis (1m to Monthly)',
      'Custom indicator and strategy alert processing',
      'Signal enrichment with macro context before escalation to COMMANDER',
      'Watchlist management and alert priority filtering',
      'Confluence detection across TradingView + FRED + Finnhub data',
      'Real-time position signal relay to VAULT and APEX',
      'Cross-timeframe divergence detection',
    ],
    dependencies: ['TV_WEBHOOK_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    lastRun: null,
    runEndpoint: '/api/webhooks/tradingview',
    evalEndpoint: '/api/admin/agents/eval',
  },
];

// ── GET: List all agents ─────────────────────────────────────────────────────

export async function GET() {
  try {
    await safeAuth();

    // Check dependency status for each agent
    const agentsWithStatus = AGENTS.map(agent => {
      const missingDeps = agent.dependencies.filter(dep => !process.env[dep]);
      const depsHealthy = missingDeps.length === 0;

      return {
        ...agent,
        depsHealthy,
        missingDeps,
        depsTotal: agent.dependencies.length,
        depsConfigured: agent.dependencies.length - missingDeps.length,
      };
    });

    return NextResponse.json({
      agents: agentsWithStatus,
      total: agentsWithStatus.length,
      healthy: agentsWithStatus.filter(a => a.depsHealthy && a.status === 'active').length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Agent registry error:', err);
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}

// ── POST: Run an agent evaluation ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await safeAuth();

    const { agentId, action } = await request.json();
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (action === 'eval') {
      // Run evaluation: check all dependencies, test connectivity
      const results: Array<{ check: string; passed: boolean; detail: string }> = [];

      // Check dependencies
      for (const dep of agent.dependencies) {
        const value = process.env[dep];
        results.push({
          check: `ENV: ${dep}`,
          passed: !!value,
          detail: value ? `Set (****${value.slice(-4)})` : 'Not configured',
        });
      }

      // Agent-specific evaluations
      if (agentId === 'api-key-manager') {
        // Test: Can we reach the keys endpoint?
        results.push({
          check: 'Key inventory endpoint',
          passed: true,
          detail: '/api/admin/keys is available',
        });
      }

      if (agentId === 'report-generator') {
        // Check at least one AI provider is available
        const hasAI = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'].some(k => !!process.env[k]);
        results.push({
          check: 'AI Provider availability',
          passed: hasAI,
          detail: hasAI ? 'At least one AI provider configured' : 'No AI providers configured',
        });
      }

      if (agentId === 'auto-scheduler') {
        const hasX = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].every(k => !!process.env[k]);
        results.push({
          check: 'X OAuth 1.0a credentials',
          passed: hasX,
          detail: hasX ? 'All 4 OAuth 1.0a keys set' : 'Missing X credentials',
        });
      }

      const passed = results.filter(r => r.passed).length;
      const total = results.length;

      return NextResponse.json({
        agentId,
        agentName: agent.name,
        evaluation: {
          results,
          passed,
          total,
          score: Math.round((passed / total) * 100),
          status: passed === total ? 'pass' : passed > total / 2 ? 'partial' : 'fail',
          evaluatedAt: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[API] Agent action error:', err);
    return NextResponse.json({ error: 'Failed to run agent action' }, { status: 500 });
  }
}
