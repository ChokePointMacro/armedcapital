#!/bin/bash
DESKTOP="/Users/wissencapital/Desktop/armedcapital"
SOURCE="/Users/wissencapital/Documents/Claude/Projects/ChokePointMacro"

cd "$DESKTOP"

# Copy checklist
cp "$SOURCE/CODE_DEPLOY_CHECKLIST.md" "$DESKTOP/CODE_DEPLOY_CHECKLIST.md"

echo "Pushing CODE_DEPLOY_CHECKLIST.md..."
git add CODE_DEPLOY_CHECKLIST.md
git commit -m "docs: add deployment verification checklist

Pre-push, post-push, Vercel build, and live site checks.
Run through this before declaring any deploy 'good to go.'

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

git push origin main

if [ $? -eq 0 ]; then
  echo "✓ Checklist pushed"
else
  echo "✗ Push failed"
fi

echo "Press any key to close..."
read -n 1
