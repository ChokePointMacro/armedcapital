# ArmedCapital — Deployment Verification Checklist

Run through this checklist **before** declaring any push "good to go."

---

## Pre-Push Checks (Local)

- [ ] `git status` — no untracked files that should be committed
- [ ] `git diff --stat` — review changed files, confirm nothing unexpected
- [ ] Search for broken imports: `grep -r "from.*deleted-file" src/`
- [ ] Verify no secrets in staged files: `git diff --cached | grep -i "sk-\|api_key\|secret"`
- [ ] If files were deleted: grep the codebase for imports of those files
- [ ] If new dependencies added: confirm they're in `package.json`

## Post-Push Checks (GitHub)

- [ ] GitHub repo page loads (not empty/404)
- [ ] File count looks correct (currently ~120+ files)
- [ ] Spot-check a key file (e.g. `src/app/api/admin/agents/route.ts` should be ~2530 lines)
- [ ] Latest commit message matches what you pushed

## Vercel Build

- [ ] Vercel dashboard shows new deployment triggered
- [ ] Deployment state transitions to BUILDING → READY (not ERROR)
- [ ] If ERROR: check build logs via Vercel dashboard or API
- [ ] Common build failures:
  - Missing imports (deleted file still referenced)
  - TypeScript type errors
  - Missing environment variables
  - Package resolution conflicts

## Live Site Verification

- [ ] Homepage loads: `https://armedcapital.vercel.app`
- [ ] Agents page loads: `https://armedcapital.vercel.app/agents`
- [ ] API returns data: `https://armedcapital.vercel.app/api/admin/agents`
- [ ] Agent count matches expected (currently 44)
- [ ] New categories visible (toolkit, trading, content, devops)
- [ ] No console errors in browser DevTools
- [ ] Navigation between pages works (Briefing, Markets, Terminal, etc.)

## Agent-Specific Checks

- [ ] Original 17 agents still present (intelligence, auto-scheduler, market-scanner, etc.)
- [ ] 27 new plugin agents present (plugin-planner, plugin-architect, plugin-code-reviewer, etc.)
- [ ] Category filter/icons render for new categories
- [ ] Delegate endpoint responds: `POST /api/admin/agents/delegate`

## Rollback Plan

If something breaks after push:
1. Vercel dashboard → Deployments → find last READY deployment → "Promote to Production"
2. Or: `git revert HEAD && git push` to undo the last commit
3. Last known good commit: check Vercel for most recent READY deployment SHA

---

## Current State (Updated 2026-03-31)

| Layer   | Status | Details |
|---------|--------|---------|
| Local   | ✅     | 44 agents in route.ts, redis.ts restored |
| GitHub  | ✅     | Commit 091cad8, all files present |
| Vercel  | ✅     | dpl_6toBZRwM1Y6VrBMSwKciN9FM4cE4 — READY |
| Live    | ✅     | /api/admin/agents returns 44 agents |
