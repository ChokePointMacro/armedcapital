-- Supabase Schema Migration for Global Intelligence Brief
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard > SQL Editor

-- Users table (Clerk handles auth, this stores app-specific data)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                -- Clerk user ID
  x_id TEXT UNIQUE,                   -- X/Twitter OAuth ID
  email TEXT,
  username TEXT,
  display_name TEXT,
  profile_image TEXT,
  access_token TEXT,                  -- X OAuth access token
  refresh_token TEXT,                 -- X OAuth refresh token
  expires_at BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Intelligence reports
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  type TEXT,
  content JSONB,
  custom_topic TEXT,
  auto_generated BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth pending auth state (for social platform connections)
CREATE TABLE IF NOT EXISTS pending_auth (
  state TEXT PRIMARY KEY,
  code_verifier TEXT,
  platform TEXT DEFAULT 'x',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled social media posts
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  content TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Automated report schedules
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id SERIAL PRIMARY KEY,
  report_type TEXT NOT NULL,
  custom_topic TEXT,
  schedule_time TEXT NOT NULL,        -- HH:MM format
  days TEXT DEFAULT '1,2,3,4,5',      -- Comma-separated day numbers (0=Sun, 6=Sat)
  enabled BOOLEAN DEFAULT TRUE,
  last_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Social platform OAuth tokens (X, LinkedIn, Instagram, Threads, Bluesky)
CREATE TABLE IF NOT EXISTS platform_tokens (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  handle TEXT,
  person_urn TEXT,
  expires_at BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Platform API credentials (stored per-platform, not per-user)
CREATE TABLE IF NOT EXISTS platform_credentials (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  key_name TEXT NOT NULL,
  key_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, key_name)
);

-- Market watchlist
CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  symbol TEXT NOT NULL,
  name TEXT,
  type TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- App-wide settings (key-value store)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Context files (knowledge base, previously stored on disk)
CREATE TABLE IF NOT EXISTS context_files (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TradingView webhook signals
CREATE TABLE IF NOT EXISTS tradingview_signals (
  id SERIAL PRIMARY KEY,
  ticker TEXT,
  exchange TEXT,
  action TEXT DEFAULT 'alert',           -- buy, sell, alert, long, short, close
  strategy TEXT,                          -- strategy or indicator name
  message TEXT,                           -- free-form signal description
  interval_tf TEXT,                       -- timeframe (1, 5, 15, 60, D, W, M)
  price_close NUMERIC,
  price_open NUMERIC,
  price_high NUMERIC,
  price_low NUMERIC,
  volume NUMERIC,
  payload JSONB,                          -- full raw webhook payload
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tv_signals_ticker ON tradingview_signals(ticker);
CREATE INDEX IF NOT EXISTS idx_tv_signals_received ON tradingview_signals(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_tv_signals_action ON tradingview_signals(action);

CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_updated ON reports(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_at ON scheduled_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_platform_tokens_user ON platform_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

-- Enable Row Level Security (but allow all access for now via anon key)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradingview_signals ENABLE ROW LEVEL SECURITY;

-- Permissive policies (tighten later once auth is fully wired)
CREATE POLICY "Allow all" ON users FOR ALL USING (true);
CREATE POLICY "Allow all" ON reports FOR ALL USING (true);
CREATE POLICY "Allow all" ON scheduled_posts FOR ALL USING (true);
CREATE POLICY "Allow all" ON scheduled_reports FOR ALL USING (true);
CREATE POLICY "Allow all" ON platform_tokens FOR ALL USING (true);
CREATE POLICY "Allow all" ON platform_credentials FOR ALL USING (true);
CREATE POLICY "Allow all" ON watchlist FOR ALL USING (true);
CREATE POLICY "Allow all" ON app_settings FOR ALL USING (true);
CREATE POLICY "Allow all" ON context_files FOR ALL USING (true);
CREATE POLICY "Allow all" ON pending_auth FOR ALL USING (true);
CREATE POLICY "Allow all" ON tradingview_signals FOR ALL USING (true);

-- Agent Tasks (task queue, approvals, completed work)
CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,                          -- matches agent registry id
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'queued'
    CHECK (status IN ('queued', 'approved', 'running', 'completed', 'ignored', 'failed')),
  priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  source TEXT DEFAULT 'system'
    CHECK (source IN ('system', 'manual')),
  result_summary TEXT,
  files_modified TEXT[],
  estimated_cost TEXT,
  actual_cost TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at DESC);

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON agent_tasks FOR ALL USING (true);
