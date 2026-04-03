#!/bin/bash
cd ~/Desktop/armedcapital-push
rm -f .git/index.lock
git pull --rebase
git add src/app/studio/page.tsx src/components/YouTubeShorts.tsx src/components/TwitterBotStudio.tsx
git commit -m "feat: add YouTube Shorts and X Bot tabs to Studio dashboard"
git push
npm run dev
