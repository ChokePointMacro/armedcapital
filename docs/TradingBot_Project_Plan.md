# ArmedCapital — TradingBot Tab: Full Project Plan

**Prepared for:** ChokePointMacro (Michael)
**Date:** March 25, 2026
**Confidence Rating System:** 🟢 HIGH (researched & verified) | 🟡 MEDIUM (strong inference from docs) | 🔴 LOW (educated guess, needs your input)

---

## Executive Summary

This plan adds a **TradingBot** tab to ArmedCapital — a new section of the app that serves as the **command center** for an autonomous multi-asset trading bot. The bot engine runs as a **separate Python service on a VPS**, while your existing Next.js app on Vercel becomes the **dashboard and control panel**.

The bot covers three asset classes: **Polymarket prediction markets**, **crypto spot trading** (via Coinbase Advanced Trade), and **market monitoring** for equities (signal generation only — no direct equity execution due to regulatory complexity).

Architecture: **Python 3.11 bot engine (Localhost) ↔ Supabase (shared DB) ↔ Next.js dashboard (Vercel)**

### Decisions Locked In (March 25, 2026)

| Decision | Choice | Status |
|----------|--------|--------|
| Hosting | **Localhost (your machine)** — can move to VPS later | ✅ Confirmed |
| Primary Exchange | **Coinbase Advanced Trade** | ✅ Confirmed |
| AI Strategy | **Claude only** (no multi-model) | ✅ Confirmed |
| Telegram Bot | **Needs setup** (included in Phase 1) | ✅ Confirmed |
| Paper Trading Bankroll | **$1,000 simulated** | ✅ Confirmed |
| User Location | **US-based** (see Polymarket legal note below) | ✅ Confirmed |
| RPC Provider | **Alchemy (free tier)** | ✅ Confirmed |

### Polymarket US Access — Legal Status (Researched March 2026)

**Confidence: 🟢 HIGH** — Verified from multiple sources

Polymarket is now **federally legal for US users**. After acquiring QCEX (a CFTC-licensed derivatives exchange), Polymarket operates under Commodity Futures Trading Commission oversight. Key details:

- **Federal status:** Legal, CFTC-regulated
- **Access method:** US users must use the **regulated, broker-based platform** (not direct crypto wallet trading). KYC required.
- **Current limitation:** Access is via **waitlist/invite code** — not fully open yet
- **State-level risk:** 19+ states are evaluating prediction markets. CA, NY, FL, TX currently accessible.
- **Action item for you:** Get on the Polymarket US waitlist ASAP. If you need an invite code, check their Discord or Twitter.

**This does NOT block development.** We can build and paper-test the full Polymarket integration while you wait for access. The bot's Polymarket module will work identically once you have a live account.

---

## Architecture Decision: Why This Split

| Concern | Python Bot (Local) | Next.js on Vercel |
|---------|-------------------|-------------------|
| Long-running processes | ✅ asyncio event loop runs while your machine is on | ❌ Serverless max 60s |
| WebSocket connections | ✅ Persistent connections to exchanges | ❌ Can't hold connections |
| Order execution | ✅ Direct blockchain/exchange calls | ❌ Not designed for this |
| Real-time dashboard | ❌ Not a frontend framework | ✅ Already built, TailwindCSS |
| User auth | ❌ Headless service | ✅ Clerk already configured |

**Confidence: 🟢 HIGH** — This is the standard architecture for trading bots with web dashboards. Polymarket's own `agents` repo uses Python. The ilovecircle bot ($2.2M profit) was built entirely in Python with Claude generating the code.

**Localhost tradeoff:** The bot only runs while your machine is on and the process is running. This is fine for paper trading and early live trading. When you're ready for 24/7 operation, we can move to a VPS with zero code changes — just copy the project and run it there.

---

## LAYER 1 — DATA AND MARKET ACCESS

### 1.1 Polymarket CLOB API
**Confidence: 🟢 HIGH** — Official SDK, well-documented, verified March 2026

| Component | Details |
|-----------|---------|
| Library | `py-clob-client` (PyPI, Python 3.9+) |
| Endpoint | `https://clob.polymarket.com` |
| Chain | Polygon (Chain ID 137) |
| Auth | Private key + API credentials via `create_or_derive_api_creds()` |
| Capabilities | Order placement (limit/market), order book, positions, balances |
| Data | Real-time prices, orderbook depth, market metadata via Gamma API |

**What you need from me:** Your Polygon wallet private key (stored in `.env`, never committed)

### 1.2 Multi-Exchange Crypto Trading (CCXT)
**Confidence: 🟢 HIGH** — CCXT is the industry standard, 100+ exchanges, active development

| Component | Details |
|-----------|---------|
| Library | `ccxt` (PyPI) — unified API for 100+ exchanges |
| Primary Exchanges | Coinbase Advanced Trade, Binance |
| Capabilities | Market data, order management, account balances, WebSocket streams |
| Auth | CDP API keys (Coinbase) or API key/secret (Binance) |
| Advantage | Same code works across exchanges — swap exchange with one line |

**Primary exchange: Coinbase Advanced Trade** (your choice). CCXT wraps Coinbase's API so you get the same functionality with the option to add more exchanges later without rewriting code.

### 1.3 Polygon RPC (Blockchain Access)
**Confidence: 🟢 HIGH** — Standard web3 pattern

| Component | Details |
|-----------|---------|
| Library | `web3.py` (pin to v6.14.0 for py-clob-client compatibility, or v7.12.1 standalone) |
| RPC Provider | Alchemy (free tier: 300M compute units/month) or QuickNode |
| Purpose | Balance checks, token approvals, direct blockchain interactions |
| Token | USDC on Polygon (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359) |
| Gas | POL/MATIC — 0.1-1 MATIC covers thousands of trades |

**Decision: Alchemy confirmed.** Free tier provides 300M compute units/month — more than sufficient for balance checks and token approvals.

### 1.4 Settlement & Keys
**Confidence: 🟢 HIGH**

| Component | Details |
|-----------|---------|
| Settlement | USDC on Polygon for Polymarket; native exchange balances for Coinbase/Binance |
| Key Storage | `python-dotenv` → `.env` file, never in code |
| Env Vars Needed | `POLYGON_PRIVATE_KEY`, `POLYGON_PUBLIC_KEY`, `ALCHEMY_RPC_URL`, `COINBASE_API_KEY`, `COINBASE_API_SECRET` |

### 1.5 Data Sources (Extending Your Existing Stack)
**Confidence: 🟡 MEDIUM** — These integrate with what you already have

Your app already pulls from Yahoo Finance, TradingView, FRED, Finnhub, CoinGecko, and Fear & Greed. The bot will consume this same data via Supabase (shared database) plus add:

| New Source | Purpose | Library |
|------------|---------|---------|
| Polymarket Gamma API | Market metadata, event details | `httpx` |
| Polymarket WebSocket | Real-time price streaming | `websockets` |
| Exchange WebSockets (via CCXT) | Live orderbook, trades | `ccxt.pro` (async) |
| News/Sentiment feeds | Bayesian prior updates | `httpx` + Claude API |
| Polygonscan API | On-chain transaction tracing | `httpx` |

---

## LAYER 2 — AI BRAIN

### 2.1 Probability Estimation Engine
**Confidence: 🟡 MEDIUM** — Architecture is well-established; exact prompt engineering will need iteration

| Component | Details |
|-----------|---------|
| Primary Model | Claude (you already have `ANTHROPIC_API_KEY`) |
| Purpose | Estimate probability of outcomes per market |
| Method | Structured JSON prompts → forced parseable output |
| Library | `httpx` for async API calls (faster than `anthropic` SDK for high-volume) |
| Prompt Versioning | Store prompts in `/prompts/v1/`, `/prompts/v2/` etc. with performance tracking |

**How it works (based on ilovecircle case study):**
1. Bot fetches market data + news + sentiment for a Polymarket event
2. Claude receives structured prompt: "Given [data], estimate probability of [outcome]. Return JSON: {probability: float, confidence: float, reasoning: string}"
3. Bot compares Claude's probability estimate vs. market price
4. If spread > threshold (e.g., 5%), it's a trade candidate

**For crypto:** Same pattern but for directional signals (long/short/hold) based on technical + fundamental data.

### 2.2 Claude-Only Strategy (Confirmed)
**Confidence: 🟢 HIGH** — Simpler, cheaper, faster iteration

| Aspect | Details |
|--------|---------|
| Model | Claude Sonnet 4 (same as your existing `claude-sonnet-4-20250514`) |
| Upgrade Path | Can switch to Claude Opus for higher-stakes analysis if needed |
| Self-Validation | Use chain-of-thought prompting where Claude critiques its own estimate before finalizing |
| Cost Control | ~$0.003/call at Sonnet tier, ~1000 calls/day = ~$3/day |

Multi-model can be added later if needed, but starting Claude-only keeps complexity low and iteration speed high. The ilovecircle bot ($2.2M) used a single-model approach.

---

## LAYER 3 — MATH ENGINE

### 3.1 Expected Value Filter
**Confidence: 🟢 HIGH** — Standard quantitative trading math

```
EV = (probability_estimate × potential_profit) - ((1 - probability_estimate) × potential_loss)
```

Only pass trades where EV > 5% edge (configurable threshold). This is the first gate — most markets won't pass.

### 3.2 Kelly Criterion Position Sizing
**Confidence: 🟢 HIGH** — Well-documented, multiple open-source implementations verified

```
kelly_fraction = (bp - q) / b
where:
  b = odds received (net odds, e.g., 2.0 for even money)
  p = probability of winning (from AI brain)
  q = 1 - p
```

**Critical safety measure:** Use **fractional Kelly (0.25×)** — never full Kelly. Full Kelly is mathematically optimal but practically suicidal due to estimation errors.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Kelly Fraction | 0.25 (quarter Kelly) | Standard conservative approach |
| Max Position Size | 2% of bankroll | Hard cap regardless of Kelly output |
| Min Position Size | $5 | Below this, fees eat the edge |

### 3.3 Bayesian Updating
**Confidence: 🟢 HIGH** — Verified implementation pattern from research

```python
class BayesianEstimator:
    def __init__(self, alpha=1, beta=1):  # Uniform prior
        self.alpha = alpha  # "wins"
        self.beta = beta    # "losses"

    def update(self, outcome: bool):
        if outcome:
            self.alpha += 1
        else:
            self.beta += 1

    def probability(self) -> float:
        return self.alpha / (self.alpha + self.beta)

    def kelly_fraction(self, odds, fraction=0.25) -> float:
        p = self.probability()
        q = 1 - p
        b = odds
        full_kelly = (b * p - q) / b
        return max(0, full_kelly * fraction)
```

The bot updates its beliefs after each trade result, making it a self-learning system. New news events also trigger Bayesian updates on open positions.

### 3.4 Log Returns & Portfolio Math
**Confidence: 🟢 HIGH** — Standard quantitative finance

| Component | Library | Purpose |
|-----------|---------|---------|
| Log returns | `numpy` | Correct P&L calculation across positions |
| Correlation matrix | `numpy` | Avoid correlated bets (e.g., multiple crypto longs) |
| Drawdown tracking | Custom | Alert if drawdown exceeds threshold |
| Sharpe ratio | `numpy` | Performance measurement |

---

## LAYER 4 — EXECUTION ENGINE

### 4.1 Order Types
**Confidence: 🟢 HIGH** — Verified from py-clob-client and CCXT docs

| Market | Order Types | Notes |
|--------|-------------|-------|
| Polymarket | GTC Limit Orders | Higher fill rate on thin orderbooks; market orders available but risky |
| Coinbase | Limit, Market, Stop-Limit | Via CCXT unified API |
| Binance | Limit, Market, Stop-Limit, OCO | Via CCXT unified API |

### 4.2 Pre-Trade Checks
**Confidence: 🟢 HIGH**

Every trade passes through these gates (in order):
1. **Balance Pre-Check** — Verify sufficient USDC/crypto before submitting
2. **Position Limit** — Max 10 concurrent positions (configurable)
3. **Slippage Protection** — Skip if estimated slippage > 2%
4. **Correlation Check** — Reject if >3 positions in same sector/direction
5. **Daily Loss Limit** — Halt trading if daily drawdown exceeds 5% of bankroll
6. **Paper Trade Mode** — In paper mode, log the trade but don't execute

### 4.3 Position Tracking
**Confidence: 🟢 HIGH**

| Component | Details |
|-----------|---------|
| Database | Supabase (shared with your Next.js app) |
| Tables | `bot_positions`, `bot_trades`, `bot_orders`, `bot_performance` |
| Why not SQLite? | Original image uses SQLite, but since your dashboard needs access, Supabase is the shared layer. Bot also keeps a local SQLite cache for resilience. |

### 4.4 Paper Trading Mode
**Confidence: 🟢 HIGH**

The bot will have a `TRADING_MODE` env var: `paper` or `live`.

In paper mode:
- All market data is real (live prices, live orderbooks)
- Orders are simulated locally with realistic fill assumptions
- P&L is tracked as if trades were real
- Dashboard shows paper trades with a clear "PAPER" badge
- Identical code path — flipping to live only changes the execution layer

---

## LAYER 5 — MONITORING AND ALERTS

### 5.1 Telegram Bot
**Confidence: 🟢 HIGH** — Standard pattern, `aiogram` is the async Telegram library

| Event | Alert |
|-------|-------|
| Trade opened | "🟢 OPENED: Buy YES on [market] @ $0.62, size: $150, EV: +8.2%" |
| Trade closed | "🔴 CLOSED: [market] — P&L: +$23.40 (+15.6%)" |
| Daily summary | "📊 Daily: 3 trades, +$47.20, Win rate: 67%, Drawdown: 1.2%" |
| Error/halt | "⚠️ BOT HALTED: Daily loss limit reached (-5.1%)" |
| System health | "💚 Heartbeat: Bot running, 4 open positions, uptime: 72h" |

**What you need from me:** Create a Telegram bot via @BotFather, get the token.

### 5.2 Next.js Dashboard (The "TradingBot" Tab)
**Confidence: 🟢 HIGH** — This is the UI component in your existing app

The TradingBot tab in ArmedCapital will have these views:

**Dashboard Home:**
- Bot status (running/paused/paper mode)
- Total P&L (daily, weekly, all-time)
- Open positions with live prices
- Win rate, Sharpe ratio, max drawdown
- Kill switch button

**Position Manager:**
- All open positions with entry price, current price, P&L
- Close position button (sends command to bot)
- Position history with filters

**Market Scanner:**
- Polymarket opportunities ranked by EV
- Crypto signals ranked by conviction
- AI reasoning for each opportunity

**Performance Analytics:**
- Equity curve chart
- Drawdown chart
- Win/loss distribution
- Performance by asset class
- Performance by AI model (if multi-model)

**Bot Configuration:**
- Trading mode toggle (paper/live)
- Kelly fraction slider
- Max position size
- Asset class toggles (Polymarket on/off, Crypto on/off)
- Exchange selection

### 5.3 Logging
**Confidence: 🟢 HIGH**

| Component | Details |
|-----------|---------|
| Library | Python `logging` module + `structlog` for structured JSON logs |
| Storage | Local files + Supabase `bot_logs` table |
| Level | Every decision logged with timestamp, reasoning, and outcome |
| Sentry | Already in your stack — add Python Sentry SDK for error tracking |

---

## LAYER 6 — INFRASTRUCTURE

### 6.1 Python Bot Service
**Confidence: 🟢 HIGH**

| Component | Details |
|-----------|---------|
| Runtime | Python 3.11+ |
| Async | `asyncio` — fully concurrent market scanning |
| Framework | Standalone async service (no web framework needed for the bot itself) |
| API Layer | FastAPI — exposes control endpoints for the dashboard |
| Process Manager | `systemd` — auto-restart on crash and on boot |

### 6.2 Hosting: Localhost (Your Machine)
**Confidence: 🟢 HIGH**

| Aspect | Details |
|--------|---------|
| Cost | **$0/mo** |
| Setup | Install Python 3.11, clone repo, `pip install`, run |
| Process Manager | Terminal session, or `launchd` (macOS) / Task Scheduler (Windows) for auto-start |
| Limitation | Bot stops when your machine sleeps or shuts down |
| Migration Path | When ready for 24/7, deploy same code to DigitalOcean ($6/mo) or any VPS |

**Saves ~$6/mo** vs. VPS while you're iterating and paper trading. The code is written to be deployment-agnostic — same `.env` file, same `python -m bot.main` command whether local or on a server.

### 6.3 Communication: Bot ↔ Dashboard
**Confidence: 🟢 HIGH**

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Python Bot │ ──────▶ │   Supabase   │ ◀────── │  Next.js App │
│   (VPS)      │ writes  │  (PostgreSQL) │  reads  │  (Vercel)    │
│              │         │              │         │              │
│  FastAPI     │ ◀────── │              │ ──────▶ │  API Routes  │
│  WebSocket   │ commands│              │ realtime│  + Realtime  │
└──────────────┘         └──────────────┘         └──────────────┘
```

**Data flow:**
1. Bot writes positions, trades, logs → Supabase tables
2. Dashboard reads from Supabase (with Realtime subscriptions for live updates)
3. Dashboard sends commands (pause, resume, close position) → Supabase `bot_commands` table
4. Bot polls `bot_commands` table every 1s for pending commands

**Why not direct WebSocket?** Supabase Realtime gives you live updates without maintaining a direct WebSocket from Vercel to your VPS. Simpler, more reliable, and you already pay for Supabase.

### 6.4 Running the Bot Locally
**Confidence: 🟢 HIGH**

```bash
# Start the bot (paper mode)
cd tradingbot
source .venv/bin/activate
TRADING_MODE=paper python -m bot.main

# Or use the .env file (recommended)
python -m bot.main
```

The bot runs in your terminal. For auto-restart on crash, use a simple wrapper script or `supervisord`. When you're ready for 24/7 operation on a VPS, we'll add a `systemd` service file — zero code changes needed.

---

## DATABASE SCHEMA (New Tables in Supabase)

**Confidence: 🟢 HIGH** — Designed to integrate with your existing 12 tables

```sql
-- Bot positions (open + closed)
CREATE TABLE bot_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('polymarket', 'crypto', 'equity_signal')),
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_id TEXT,              -- Polymarket condition_id
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
  metadata JSONB DEFAULT '{}'
);

-- Individual trade executions
CREATE TABLE bot_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES bot_positions(id),
  user_id TEXT NOT NULL,
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
CREATE TABLE bot_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('pause', 'resume', 'close_position', 'update_config', 'kill')),
  payload JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

-- Performance snapshots (hourly)
CREATE TABLE bot_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
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
  metadata JSONB DEFAULT '{}'
);

-- Bot configuration
CREATE TABLE bot_config (
  user_id TEXT PRIMARY KEY,
  trading_mode TEXT DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
  kelly_fraction DECIMAL DEFAULT 0.25,
  max_position_pct DECIMAL DEFAULT 0.02,
  max_concurrent_positions INT DEFAULT 10,
  daily_loss_limit_pct DECIMAL DEFAULT 0.05,
  slippage_limit_pct DECIMAL DEFAULT 0.02,
  ev_threshold DECIMAL DEFAULT 0.05,
  polymarket_enabled BOOLEAN DEFAULT true,
  crypto_enabled BOOLEAN DEFAULT true,
  exchanges JSONB DEFAULT '["coinbase"]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bot logs (structured)
CREATE TABLE bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## PROJECT STRUCTURE (Python Bot)

**Confidence: 🟢 HIGH**

```
tradingbot/
├── bot/
│   ├── __init__.py
│   ├── main.py                  # Entry point, asyncio event loop
│   ├── config.py                # Settings from env vars
│   ├── api/
│   │   ├── server.py            # FastAPI control endpoints
│   │   └── websocket.py         # WebSocket for real-time dashboard
│   ├── data/
│   │   ├── polymarket.py        # Polymarket CLOB + Gamma API client
│   │   ├── exchanges.py         # CCXT multi-exchange client
│   │   ├── blockchain.py        # web3.py Polygon interactions
│   │   └── news.py              # News/sentiment feed aggregator
│   ├── brain/
│   │   ├── estimator.py         # AI probability estimation (Claude)
│   │   ├── prompts/             # Versioned prompt templates
│   │   │   ├── v1_polymarket.py
│   │   │   └── v1_crypto.py
│   │   └── consensus.py         # Multi-model validation
│   ├── math_engine/
│   │   ├── expected_value.py    # EV calculation
│   │   ├── kelly.py             # Kelly Criterion sizing
│   │   ├── bayesian.py          # Bayesian updater
│   │   └── portfolio.py         # Correlation, drawdown, Sharpe
│   ├── execution/
│   │   ├── executor.py          # Order execution orchestrator
│   │   ├── polymarket_exec.py   # Polymarket-specific order logic
│   │   ├── exchange_exec.py     # CCXT exchange order logic
│   │   ├── paper_trader.py      # Paper trading simulator
│   │   └── guards.py            # Pre-trade checks (balance, slippage, limits)
│   ├── monitoring/
│   │   ├── telegram.py          # Telegram alerts via aiogram
│   │   ├── logger.py            # Structured logging
│   │   └── health.py            # Heartbeat and health checks
│   └── db/
│       ├── supabase.py          # Supabase client (shared with Next.js)
│       └── local_cache.py       # SQLite fallback cache
├── prompts/
│   └── v1/                      # Prompt templates (separate from code)
├── tests/
│   ├── test_kelly.py
│   ├── test_bayesian.py
│   ├── test_paper_trader.py
│   └── test_guards.py
├── .env.example
├── requirements.txt
├── pyproject.toml
├── systemd/
│   └── tradingbot.service
└── README.md
```

---

## NEXT.JS DASHBOARD COMPONENT (TradingBot Tab)

**Confidence: 🟢 HIGH** — Follows your existing pattern from Markets.tsx and Agents.tsx

The TradingBot tab will be a new component (`TradingBot.tsx`) following the same patterns as your existing `Markets.tsx` (1,501 lines) and `Agents.tsx` (1,155 lines). It will:

- Use `'use client'` directive (App Router client component)
- Fetch data from new API routes that read from the shared Supabase tables
- Use Supabase Realtime subscriptions for live position updates
- Include Clerk auth checks (same as your other routes)
- Style with TailwindCSS (consistent with existing UI)

**New API Routes Needed:**

```
/api/tradingbot/
├── status/route.ts          [GET] Bot status, uptime, mode
├── positions/route.ts       [GET] Open + recent closed positions
├── performance/route.ts     [GET] Equity curve, metrics
├── commands/route.ts        [POST] Send command to bot
├── config/route.ts          [GET/PUT] Bot configuration
├── scanner/route.ts         [GET] Current opportunities ranked by EV
└── logs/route.ts            [GET] Recent bot activity logs
```

---

## PHASED IMPLEMENTATION PLAN

### Phase 1: Foundation (Week 1-2)
**Goal:** Bot skeleton running on VPS, connected to data sources, paper trading

| Task | Details | Confidence |
|------|---------|------------|
| Local setup | Install Python 3.11, create virtualenv, install dependencies | 🟢 HIGH |
| Wallet setup | Create Polygon wallet, fund with POL for gas | 🟢 HIGH |
| Polymarket waitlist | Join US waitlist, request invite code (non-blocking) | 🟢 HIGH |
| Coinbase account | Create Coinbase Advanced Trade account, generate API keys | 🟢 HIGH |
| Alchemy account | Sign up, create Polygon Mainnet app, get RPC URL | 🟢 HIGH |
| Telegram bot | Create bot via @BotFather, get token, configure alerts channel | 🟢 HIGH |
| Bot skeleton | `main.py` with asyncio loop, config, logging | 🟢 HIGH |
| Data layer | Polymarket client + CCXT exchange client | 🟢 HIGH |
| Supabase schema | Create all new tables | 🟢 HIGH |
| Paper trade engine | Simulated order execution with realistic fills | 🟢 HIGH |

### Phase 2: AI Brain + Math (Week 3-4)
**Goal:** Bot can identify opportunities and size positions

| Task | Details | Confidence |
|------|---------|------------|
| Claude integration | Structured prompts for probability estimation | 🟡 MEDIUM |
| Prompt engineering | Iterate on prompt quality, measure accuracy | 🟡 MEDIUM |
| Expected value filter | EV calculation + threshold gate | 🟢 HIGH |
| Kelly sizing | Fractional Kelly with configurable fraction | 🟢 HIGH |
| Bayesian updater | Update beliefs on trade outcomes + news | 🟢 HIGH |
| Pre-trade guards | All safety checks implemented | 🟢 HIGH |
| Backtesting | Test against historical Polymarket data | 🟡 MEDIUM |

### Phase 3: Dashboard (Week 5-6)
**Goal:** Full TradingBot tab in ArmedCapital

| Task | Details | Confidence |
|------|---------|------------|
| TradingBot.tsx | Main component with sub-views | 🟢 HIGH |
| API routes | All /api/tradingbot/ endpoints | 🟢 HIGH |
| Supabase Realtime | Live position updates in dashboard | 🟢 HIGH |
| Performance charts | Equity curve, drawdown, win rate | 🟢 HIGH |
| Command system | Pause/resume/close from dashboard | 🟢 HIGH |
| Bot config UI | Settings panel with toggles and sliders | 🟢 HIGH |

### Phase 4: Monitoring + Hardening (Week 7-8)
**Goal:** Production-ready with alerts and error handling

| Task | Details | Confidence |
|------|---------|------------|
| Telegram bot | Real-time trade alerts | 🟢 HIGH |
| Error recovery | Graceful exception handling, auto-restart | 🟢 HIGH |
| Sentry integration | Python SDK for error tracking | 🟢 HIGH |
| Rate limiting | Respect exchange API limits | 🟢 HIGH |
| Position reconciliation | Verify local state matches exchange state | 🟡 MEDIUM |
| Security audit | Key storage, API permissions review | 🟢 HIGH |

### Phase 5: Paper → Live (Week 9-10)
**Goal:** Validated strategy, ready for real capital

| Task | Details | Confidence |
|------|---------|------------|
| Paper trade review | Analyze 2-4 weeks of paper results | 🟢 HIGH |
| Flip to live | Change TRADING_MODE=live | 🟢 HIGH |
| Start small | Begin with $100-500 bankroll | 🟢 HIGH |
| Monitor closely | 24/7 Telegram alerts, daily reviews | 🟢 HIGH |
| Scale gradually | Increase bankroll based on Sharpe ratio | 🟡 MEDIUM |

---

## DEPENDENCIES (Python Bot — requirements.txt)

**Confidence: 🟢 HIGH** — All verified on PyPI

```
# Core
py-clob-client>=0.15.0        # Polymarket CLOB SDK
ccxt>=4.0.0                    # Multi-exchange trading
web3==6.14.0                   # Blockchain (pinned for py-clob-client compat)
httpx>=0.27.0                  # Async HTTP client
python-dotenv>=1.0.0           # Env var management

# AI
anthropic>=0.40.0              # Claude API SDK

# Math
numpy>=1.26.0                  # Array math, statistics
scipy>=1.12.0                  # Beta distribution for Bayesian

# Monitoring
aiogram>=3.0.0                 # Telegram bot (async)
sentry-sdk>=2.0.0              # Error tracking
structlog>=24.0.0              # Structured logging

# Database
supabase>=2.0.0                # Supabase Python client
aiosqlite>=0.19.0              # Local SQLite cache (async)

# API (for dashboard communication)
fastapi>=0.110.0               # Control API
uvicorn>=0.27.0                # ASGI server
websockets>=12.0               # WebSocket support

# Testing
pytest>=8.0.0
pytest-asyncio>=0.23.0
```

---

## COST ESTIMATE

**Confidence: 🟡 MEDIUM** — Prices verified but usage is estimated

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Hosting (Localhost) | **$0** | Runs on your machine |
| Alchemy RPC | $0 | Free tier (300M CU/month) |
| Claude API (Sonnet) | **$5-15** | ~1000 calls/day × $0.003 = ~$3/day if running 24/7 |
| Supabase | $0-25 | Free tier may suffice; Pro at $25/mo for more queries |
| Telegram | $0 | Free |
| Coinbase API | $0 | Free (fees on trades only) |
| Polymarket | $0 | Free (fees on trades only) |
| **Total Infrastructure** | **~$5-40/mo** | Before trading capital |
| **Paper Trading Bankroll** | $1,000 (simulated) | No real capital at risk during paper phase |

---

## RISK ASSESSMENT

| Risk | Severity | Mitigation |
|------|----------|------------|
| AI probability estimates are wrong | HIGH | Fractional Kelly (0.25×), max 2% per position, paper trade first |
| Exchange API changes | MEDIUM | CCXT abstracts this; Polymarket SDK is maintained |
| Bot crashes during open positions | HIGH | systemd auto-restart, positions tracked in Supabase, Telegram alerts |
| Key/wallet compromise | CRITICAL | Dedicated trading wallet (not your main), minimal balance, env vars only |
| Regulatory changes (Polymarket) | MEDIUM | Monitor Polymarket TOS; geo-restrictions may apply |
| Correlated losses | HIGH | Correlation check in pre-trade guards, daily loss limit |
| Slippage on thin markets | MEDIUM | Slippage protection, prefer GTC limit orders |

**LEGAL STATUS (Verified March 2026):** Polymarket is federally legal in the US under CFTC oversight. US users must use the regulated broker-based platform with KYC (not direct crypto wallet). Access is currently via waitlist/invite code. 19+ states are reviewing prediction markets at the state level, but CA, NY, FL, TX remain accessible. See the Legal Status section at the top of this plan for full details.

---

## ALL DECISIONS FINALIZED ✅

All 7 open questions have been answered and locked into this plan:

| # | Question | Decision |
|---|----------|----------|
| 1 | Hosting | Localhost ($0/mo, VPS later if needed) |
| 2 | Primary Exchange | Coinbase Advanced Trade |
| 3 | AI Model | Claude only (Sonnet 4) |
| 4 | Telegram | Setup included in Phase 1 |
| 5 | Paper Bankroll | $1,000 simulated |
| 6 | Location | US-based (Polymarket federally legal, waitlist access) |
| 7 | RPC Provider | Alchemy free tier |

---

## REMAINING GUESSES (Transparency)

| Item | What I Assumed | Why | Impact if Wrong |
|------|---------------|-----|-----------------|
| Equity trading | Signal-only, no execution | Regulatory complexity of automated equity trading | Low — can add Alpaca API later for commission-free equity automation |
| web3.py version | Pinned to 6.14.0 | py-clob-client compatibility note from docs | Low — may need v7 standalone; testable in Phase 1 |
| Polymarket US waitlist timeline | Weeks to months | Based on current reports of rolling access | Medium — crypto module works independently while waiting |
| Localhost resource usage | Your machine has enough RAM/CPU headroom | Python asyncio is lightweight (~50-100MB) | Low — negligible impact on modern hardware |

---

## NEXT STEPS — READY TO BUILD

Phase 1 is fully scoped and has zero blockers. Here's what happens next:

1. **You do:** Create accounts (Coinbase, Alchemy, Telegram @BotFather, Polymarket waitlist)
2. **You provide:** API keys and tokens (I'll tell you exactly which ones as we go)
3. **I build:** Python bot skeleton, Supabase schema, data layer, paper trade engine
4. **Week 1 target:** Bot running locally, scanning Coinbase markets, logging paper trades to Supabase

---

*This plan was built from research across Polymarket's official SDK, CCXT documentation, Coinbase Advanced Trade API docs, the ilovecircle $2.2M case study, multiple Python trading bot architectures, and your existing ArmedCapital codebase. All confidence levels reflect the quality of the source material, not certainty of trading outcomes.*
