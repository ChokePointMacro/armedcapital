# ArmedCapital Code Audit

**Date:** 2026-03-29
**Scope:** `src/` — 83 API routes, 15+ components, 12 lib modules
**Focus:** Security, architecture, reliability, type safety

---

## Critical Issues

### 1. Unprotected API Routes (9 routes missing auth)
These routes have no `authHelper` or Clerk import — anyone can hit them:

| Route | Risk |
|-------|------|
| `/api/studio/twitter` | Could trigger tweets without auth |
| `/api/studio/llm` | Could burn LLM tokens without auth |
| `/api/scheduled-posts` | Could read/write scheduled posts |
| `/api/sse/tasks` | Leaks internal task state |
| `/api/sse/markets` | Low risk (public data), but SSE connection abuse |

**Markets routes** (`/api/markets`, `/api/markets/insights`, `/api/markets/options`, `/api/markets/lookup`, `/api/markets/history`) are likely intentionally public — verify this is intended.

**Fix:** Add `safeAuth()` guard to studio and scheduled-posts routes at minimum.

---

### 2. Duplicate Fetch Logic (DRY violation)

**FRED API** is fetched independently in both:
- `src/lib/enrichedData.ts:47` (shared fetcher with Redis cache)
- `src/app/api/scanner/route.ts:149` (local re-implementation)

The scanner route has its own FRED fetcher instead of using the shared `fetchFredData()` from enrichedData. This means scanner bypasses the Redis cache and makes redundant API calls that count against your FRED rate limit.

**Public.com token exchange** is duplicated in:
- `src/app/api/markets/insights/route.ts:47`
- `src/app/api/markets/options/route.ts:9`

**Fix:** Extract `getPublicComToken()` into `src/lib/publicClient.ts`. Remove scanner's local FRED fetcher and use the shared one.

---

## Moderate Issues

### 3. Type Safety — 217 `as any` / `: any` across 70 files
Worst offenders:
- `scanner/route.ts` — 24 instances
- `enrichedData.ts` — 15 instances
- `Dashboard.tsx` — 13 instances
- `markets/insights/route.ts` — 11 instances

`strict: true` is enabled in tsconfig, but the `any` casts undermine it. Most are API response typings that should have interfaces.

**Fix priority:** Start with `enrichedData.ts` (shared lib, high reuse) and `scanner/route.ts` (835 lines, most complex route).

### 4. Silent Error Swallowing — 9 empty `catch {}` blocks
Files: `cache.ts`, `terminal/route.ts`, `Progress.tsx`, `TradeFlow.tsx`, `admin/reconnect/route.ts`

Empty catches hide bugs. At minimum, add `console.warn` in development.

### 5. Console Logging — 173 console.log/warn/error across 69 files
No structured logging. `src/lib/logger.ts` exists but has only 4 log calls — most code uses raw `console.*`. This makes production debugging harder and leaks internal details.

**Fix:** Adopt the existing `logger.ts` or switch to a structured logger. At minimum, gate verbose logs behind `NODE_ENV !== 'production'`.

### 6. `process.env` Accessed in 41 Files (135 occurrences)
Env vars are read inline everywhere instead of through a centralized config. This means:
- No validation at startup (find out a key is missing when a user hits that route)
- Easy to typo a var name
- Hard to know which vars are required

**Fix:** Create `src/lib/env.ts` that validates all required vars at startup and exports typed config.

---

## Architecture Notes

### What's Working Well
- **Supabase queries are parameterized** — no SQL injection risk found
- **No hardcoded secrets** — all sensitive values use `process.env`
- **Redis caching in enrichedData.ts** — shared fetchers with proper TTLs
- **Auth on sensitive routes** — 58 of 83 routes have auth guards
- **`strict: true`** in tsconfig

### Largest Files (complexity risk)
| File | Lines | Notes |
|------|-------|-------|
| `scanner/route.ts` | 835 | Monolith — fetches, AI call, caching all in one file |
| `usage/route.ts` | 696 | 18 env var reads, checks every connected service |
| `terminal/route.ts` | 630 | 7-factor scoring engine + Yahoo Finance fetchers |
| `cron/route.ts` | 343 | Scheduled posts, reports, tweets, email all in one handler |

`scanner/route.ts` would benefit most from decomposition — split data fetchers, AI prompt, and response formatting into separate modules.

---

## Quick Wins (< 30 min each)

1. **Add auth to `/api/studio/*` routes** — prevents unauthorized LLM/tweet calls
2. **Delete scanner's local FRED fetcher** — use `fetchFredData()` from enrichedData.ts
3. **Extract `getPublicComToken()`** — deduplicate across insights + options routes
4. **Add `console.warn` to empty catch blocks** — stop hiding errors silently
5. **Create `src/lib/env.ts`** — validate env vars at startup, fail fast

---

## Dependency Check (24 production deps)
All reasonable for the stack. No obvious bloat or deprecated packages detected. `@google/genai` + `openai` + `@anthropic-ai/sdk` = 3 AI SDKs — consider if all 3 are actively used or if any can be removed.
