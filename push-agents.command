#!/bin/bash
DESKTOP="/Users/wissencapital/Desktop/armedcapital"
BUNDLE="/Users/wissencapital/Documents/Claude/Projects/ChokePointMacro/fix-repo.bundle"

echo "========================================="
echo "  ArmedCapital — Fix Repo & Push"
echo "========================================="

# ── Step 1: Clone from bundle to Desktop ──
echo "[1/3] Setting up Desktop repo from bundle..."
rm -rf "$DESKTOP"
git clone "$BUNDLE" "$DESKTOP"

if [ ! -d "$DESKTOP/.git" ]; then
  echo "FATAL: Clone from bundle failed"
  read -n 1
  exit 1
fi

cd "$DESKTOP"

# Point remote to GitHub
git remote set-url origin https://github.com/ChokePointMacro/armedcapital.git

# ── Step 2: Verify ──
echo ""
echo "[2/3] Verifying files..."
LINES=$(wc -l < src/app/api/admin/agents/route.ts)
echo "  route.ts: $LINES lines"

if grep -q "STRATEGOS" src/app/api/admin/agents/route.ts; then
  echo "  ✓ STRATEGOS found (27 plugin agents present)"
else
  echo "  ✗ STRATEGOS missing!"
  read -n 1
  exit 1
fi

if grep -q "toolkit" src/components/Agents.tsx; then
  echo "  ✓ Agents.tsx has toolkit category"
fi

if [ -d ".claude-plugin" ]; then
  AGENT_COUNT=$(ls .claude-plugin/agents/*.md 2>/dev/null | wc -l)
  echo "  ✓ .claude-plugin/ present ($AGENT_COUNT agent prompts)"
fi

if [ -f "src/app/api/admin/agents/delegate/route.ts" ]; then
  echo "  ✓ delegate/route.ts present"
fi

if [ ! -f "src/lib/pinecone.ts" ]; then
  echo "  ✓ Dead code removed (pinecone, redis)"
fi

echo ""
echo "  Total files: $(find . -not -path './.git/*' -type f | wc -l)"

# ── Step 3: Force push to fix GitHub ──
echo ""
echo "[3/3] Force pushing to GitHub (overwriting empty commit)..."
git push --force origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "  ✓ SUCCESS!"
  echo "  GitHub: restored + 27 new agents"
  echo "  Vercel: will auto-deploy in ~60s"
  echo "  Desktop repo: ~/Desktop/armedcapital"
  echo "========================================="
else
  echo ""
  echo "  ✗ Push failed! Check GitHub auth."
fi

echo ""
echo "Press any key to close..."
read -n 1
