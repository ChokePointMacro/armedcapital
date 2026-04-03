#!/bin/bash
cd "$(dirname "$0")"

echo "=== Setting up git and pushing to GitHub ==="

# Initialize git if not already
if [ ! -d ".git" ]; then
  echo "Initializing git..."
  git init
  git branch -M main
fi

# Check if remote exists
if ! git remote get-url origin &>/dev/null; then
  echo ""
  echo "No git remote found."
  echo "Enter your GitHub repo URL (e.g. https://github.com/username/ChokePointMacro.git):"
  read -r REPO_URL
  git remote add origin "$REPO_URL"
fi

# Add all files
echo "Adding files..."
git add -A

# Commit
echo "Committing..."
git commit -m "feat: 27 plugin agents, delegation API, operations hub, dead code cleanup

- .claude-plugin/ with 27 specialized agents + 5 domain skills
- /api/admin/agents/delegate endpoint for Claude-powered task delegation
- 27 new agents visible in Agent Control Center (toolkit, trading, content, devops)
- Operations page: 3 new tabs (Budgets, Pipelines, Live Tasks SSE)
- Deleted dead code: anomalyDetector.ts, pinecone.ts, redis.ts
- Removed orphaned PINECONE_API_KEY from key inventory"

# Push
echo "Pushing to GitHub..."
git push -u origin main

echo ""
echo "=== Done! Vercel will auto-deploy from GitHub ==="
echo "Press any key to close..."
read -n 1
