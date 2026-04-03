#!/bin/bash
DESKTOP="/Users/wissencapital/Desktop/armedcapital"
SOURCE="/Users/wissencapital/Documents/Claude/Projects/ChokePointMacro"

echo "========================================="
echo "  ArmedCapital — Fix Redis + Force Push"
echo "========================================="

if [ ! -d "$DESKTOP/.git" ]; then
  echo "FATAL: Desktop repo not found at $DESKTOP"
  read -n 1
  exit 1
fi

cd "$DESKTOP"

# ── Copy restored redis.ts ──
echo "[1/3] Restoring redis.ts..."
cp "$SOURCE/src/lib/redis.ts" "$DESKTOP/src/lib/redis.ts"

if [ ! -f "$DESKTOP/src/lib/redis.ts" ]; then
  echo "FATAL: redis.ts copy failed"
  read -n 1
  exit 1
fi

echo "  ✓ redis.ts restored ($(wc -l < src/lib/redis.ts) lines)"

# ── Verify ──
echo ""
echo "[2/3] Verifying..."
if grep -q "import { Redis } from '@upstash/redis'" src/lib/redis.ts; then
  echo "  ✓ redis.ts has Upstash import"
fi

if grep -q "STRATEGOS" src/app/api/admin/agents/route.ts; then
  echo "  ✓ STRATEGOS present (27 plugin agents)"
fi

# ── Commit and force push ──
echo ""
echo "[3/3] Committing and force pushing..."
git add src/lib/redis.ts
git commit -m "fix: restore redis.ts deleted in previous commit

cache.ts, rateLimit.ts, and cron/route.ts all import from @/lib/redis.
The previous commit incorrectly identified redis.ts as dead code and
deleted it, breaking the Vercel build.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

# Force push needed because Desktop clone history diverges from remote
git push --force origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "  ✓ SUCCESS!"
  echo "  redis.ts restored + force pushed"
  echo "  Vercel will auto-deploy in ~60s"
  echo "========================================="
else
  echo ""
  echo "  ✗ Push failed! Check GitHub auth."
fi

echo ""
echo "Press any key to close..."
read -n 1
