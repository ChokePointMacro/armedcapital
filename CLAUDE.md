# Project: ArmedCapital (ChokePointMacro)

Full-stack financial intelligence platform: Next.js + Supabase + multi-AI agents + TradingBot + Studio.

## Tech Stack
- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, TradingView widgets
- **Backend:** Next.js API routes, Supabase (auth + database)
- **Auth:** Clerk (`@clerk/nextjs/server`)
- **AI:** Multi-agent system (agentBus, taskQueue) with Claude-only trading AI
- **TradingBot:** Python (separate runtime in `tradingbot/`), Polymarket + Coinbase, paper-first
- **Social:** Instagram integration for publishing
- **Studio:** Python (FastAPI in `studio/`), YouTube Shorts + Twitter/X bot, dual LLM (Ollama/Claude)

## Architecture
- `src/components/` — React components (Markets, Agents, TradingBot, Studio dashboard)
- `src/app/api/` — Next.js API routes (admin, generate, markets, scanner, tradingbot, tradingview, watchlist, webhooks)
- `src/lib/` — Shared libraries (agentBus, taskQueue, anomalyDetector, instagramClient)
- `src/services/` — Business logic (ops-route)
- `src/types/` — Shared TypeScript type exports
- `tradingbot/` — Standalone Python trading bot (DO NYC deployment)
- `studio/` — Content automation service (YouTube Shorts + Twitter/X bot, FastAPI)
- `studio/services/` — YouTube engine, Twitter engine, dual LLM provider
- `studio/api/` — FastAPI server (port 8100)
- `tests/` — Unit and integration tests (vitest)
- `docs/` — Project plans, implementation guides
- `scripts/` — Database migrations and utilities

## Conventions
- Always use `@/` path aliases for imports (maps to `src/`)
- API routes import auth from `@/lib/authHelper` and Supabase from `@/lib/supabase`
- Dynamic imports for agentBus in route handlers to avoid circular deps
- Use vitest for testing; run with `npx vitest`
- Never commit secrets — use environment variables
- Use conventional commits

## Testing
- Unit tests: `tests/unit/`
- Integration tests: `tests/integration/`
- Run: `npx vitest` from project root
- Python bot tests: `cd tradingbot && pytest`
- Studio service: `cd studio && uvicorn studio.api.server:app --port 8100`

## Security
- No secrets in code or logs
- Validate all user inputs
- Use parameterized queries via Supabase client
- Auth required on all admin and user-specific routes
