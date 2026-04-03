-- ============================================================================
-- Supabase Migration: Markets & TradingView tables
-- Run this in the Supabase SQL Editor before deploying the API routes.
-- ============================================================================

-- ── TradingView signals (webhook ingestion) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS tv_signals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker      TEXT NOT NULL,
  action      TEXT,
  price       DOUBLE PRECISION,
  close       DOUBLE PRECISION,
  time        TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  interval    TEXT,
  raw_payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_tv_signals_ticker
  ON tv_signals (ticker);
CREATE INDEX IF NOT EXISTS idx_tv_signals_received
  ON tv_signals (received_at DESC);

-- ── Watchlist ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  name       TEXT,
  type       TEXT DEFAULT 'Equity',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user
  ON watchlist (user_id);

-- ── Market insights cache ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_insights_cache (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text         TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep only last 10 cached insights (optional cleanup policy)
-- You can set up a cron job or Supabase Edge Function to prune old rows.

-- ============================================================================
-- RLS Policies (adjust to your auth setup)
-- ============================================================================

ALTER TABLE tv_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_insights_cache ENABLE ROW LEVEL SECURITY;

-- tv_signals: service role can read/write, authenticated users can read
CREATE POLICY "Service role full access on tv_signals"
  ON tv_signals FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read tv_signals"
  ON tv_signals FOR SELECT
  USING (auth.role() = 'authenticated');

-- watchlist: users can manage their own rows
CREATE POLICY "Users manage own watchlist"
  ON watchlist FOR ALL
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role full access on watchlist"
  ON watchlist FOR ALL
  USING (auth.role() = 'service_role');

-- market_insights_cache: service role writes, anyone can read
CREATE POLICY "Service role manages insights cache"
  ON market_insights_cache FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Anyone can read insights cache"
  ON market_insights_cache FOR SELECT
  USING (true);
