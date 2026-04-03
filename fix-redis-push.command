#!/bin/bash
DESKTOP="/Users/wissencapital/Desktop/armedcapital"
SOURCE="/Users/wissencapital/Documents/Claude/Projects/ChokePointMacro"

echo "========================================="
echo "  ArmedCapital — Fix Redis + Push"
echo "========================================="

if [ ! -d "$DESKTOP/.git" ]; then
  echo "FATAL: Desktop repo not found at $DESKTOP"
  echo "Run push-agents.command first."
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

# ── Verify imports resolve ──
echo ""
echo "[2/3] Verifying..."
if grep -q "import { Redis } from '@upstash/redis'" src/lib/redis.ts; then
  echo "  ✓ redis.ts has Upstash import"
else
  echo "  ✗ redis.ts missing Upstash import!"
  read -n 1
  exit 1
fi

# Check the 3 files that import redis
for f in src/lib/cache.ts src/lib/rateLimit.ts src/app/api/cron/route.ts; do
  if [ -f "$f" ]; then
    echo "  ✓ $f exists (imports redis)"
  else
    echo "  ✗ $f missing!"
  fi
done

# ── Commit and push ──
echo ""
echo "[3/3] Committing and pushing..."
git add src/lib/redis.ts
git commit -m "fix: restore redis.ts deleted in previous commit

cache.ts, rateLimit.ts, and cron/route.ts all import from @/lib/redis.
The previous commit incorrectly identified redis.ts as dead code and
deleted it, breaking the Vercel build.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

git push origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "  ✓ SUCCESS!"
  echo "  redis.ts restored + pushed"
  echo "  Vercel will auto-deploy in ~60s"
  echo "========================================="
else
  echo ""
  echo "  ✗ Push failed! Check GitHub auth."
fi

echo ""
echo "Press any key to close..."
read -n 1
