-- ===========================================
-- ArmedCapital TradingBot — Supabase Schema
-- ===========================================
-- Run this in your Supabase SQL editor to create all bot tables.
-- These tables live alongside your existing ArmedCapital tables.

-- Bot positions (open + closed)
CREATE TABLE IF NOT EXISTS bot_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'bot',
  asset_class TEXT NOT NULL CHECK (asset_class IN ('polymarket', 'crypto', 'equity_signal')),
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_id TEXT,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'yes', 'no')),
  entry_price DECIMAL NOT NULL,
  current_price DECIMAL,
  quantity DECIMAL NOT NULL,
  position_size_usd DECIMAL NOT NULL,
  kelly_fraction DECIMAL,
  ev_at_entry DECIMAL,
  ai_probability DECIMAL,
  ai_reasoning TEXT,
  ai_model TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'pending')),
  pnl DECIMAL DEFAULT 0,
  pnl_percent DECIMAL DEFAULT 0,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Individual trade executions
CREATE TABLE IF NOT EXISTS bot_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES bot_positions(id),
  user_id TEXT NOT NULL DEFAULT 'bot',
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  price DECIMAL NOT NULL,
  quantity DECIMAL NOT NULL,
  fee DECIMAL DEFAULT 0,
  slippage DECIMAL DEFAULT 0,
  is_paper BOOLEAN DEFAULT true,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  raw_response JSONB
);

-- Bot commands from dashboard
CREATE TABLE IF NOT EXISTS bot_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'bot',
  command TEXT NOT NULL CHECK (command IN ('pause', 'resume', 'close_position', 'update_config', 'kill')),
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

-- Performance snapshots (hourly)
CREATE TABLE IF NOT EXISTS bot_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'bot',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  total_equity DECIMAL,
  daily_pnl DECIMAL,
  weekly_pnl DECIMAL,
  total_pnl DECIMAL,
  win_rate DECIMAL,
  sharpe_ratio DECIMAL,
  max_drawdown DECIMAL,
  open_positions INT,
  total_trades INT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Bot configuration
CREATE TABLE IF NOT EXISTS bot_config (
  user_id TEXT PRIMARY KEY DEFAULT 'bot',
  trading_mode TEXT DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
  kelly_fraction DECIMAL DEFAULT 0.25,
  max_position_pct DECIMAL DEFAULT 0.02,
  max_concurrent_positions INT DEFAULT 10,
  daily_loss_limit_pct DECIMAL DEFAULT 0.05,
  slippage_limit_pct DECIMAL DEFAULT 0.02,
  ev_threshold DECIMAL DEFAULT 0.05,
  polymarket_enabled BOOLEAN DEFAULT true,
  crypto_enabled BOOLEAN DEFAULT true,
  exchanges JSONB DEFAULT '["coinbase"]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bot logs (structured)
CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'bot',
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bot_positions_status ON bot_positions(status);
CREATE INDEX IF NOT EXISTS idx_bot_positions_opened ON bot_positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_trades_position ON bot_trades(position_id);
CREATE INDEX IF NOT EXISTS idx_bot_trades_executed ON bot_trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_commands_status ON bot_commands(status);
CREATE INDEX IF NOT EXISTS idx_bot_performance_ts ON bot_performance(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created ON bot_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(level);

-- ─── Enable Realtime (for dashboard live updates) ───────────────

ALTER PUBLICATION supabase_realtime ADD TABLE bot_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_performance;

-- ─── Insert default config row ──────────────────────────────────

INSERT INTO bot_config (user_id) VALUES ('bot')
ON CONFLICT (user_id) DO NOTHING;
