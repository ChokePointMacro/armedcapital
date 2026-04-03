#!/bin/bash
cd ~/Desktop/armedcapital-push
git add .gitignore src/components/YouTubeShorts.tsx src/components/TwitterBotStudio.tsx src/app/api/studio/youtube/route.ts src/app/api/studio/twitter/route.ts src/app/api/studio/health/route.ts
git commit -m "feat(studio): fully integrated YouTube Shorts + X Bot with Claude AI"
git pull --rebase --autostash
git push
echo ""
echo "=== DONE — Push complete. Now restarting dev server... ==="
echo "Press Ctrl+C in your other terminal running 'npm run dev', then run it again to pick up the new ANTHROPIC_API_KEY in .env.local"
echo ""
read -p "Press Enter to close..."
