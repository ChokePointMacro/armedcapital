/**
 * YouTube Shorts Studio Routes — Direct Claude AI integration
 * POST /api/studio/youtube — Generate a YouTube Short script + metadata + optional video
 * GET  /api/studio/youtube — Get status
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const getClient = () => {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    process.env.STUDIO_ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: key });
};

function buildVideoHTML(title: string, hook: string, script: string, cta: string): string {
  const words = script.split(/\s+/);
  const segments: string[] = [];
  for (let i = 0; i < words.length; i += 6) {
    segments.push(words.slice(i, i + 6).join(" "));
  }

  const secPerSegment = Math.max(2, Math.min(4, 55 / segments.length));
  const allSlides: { text: string; duration: number; style: string }[] = [];

  if (hook) {
    allSlides.push({ text: hook, duration: 3, style: "hook" });
  }
  segments.forEach((seg) => {
    allSlides.push({ text: seg, duration: secPerSegment, style: "body" });
  });
  if (cta) {
    allSlides.push({ text: cta, duration: 3, style: "cta" });
  }

  const totalDuration = allSlides.reduce((s, sl) => s + sl.duration, 0);
  const slidesJSON = JSON.stringify(allSlides);
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080,height=1920">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;width:1080px;height:1920px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.container{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative}
.title{position:absolute;top:160px;left:0;right:0;text-align:center;color:#F7931A;font-size:48px;font-weight:700;padding:0 60px;line-height:1.3}
.slide-text{color:#ffffff;font-size:56px;font-weight:600;text-align:center;padding:0 80px;line-height:1.4;opacity:0;transition:opacity 0.4s ease}
.slide-text.active{opacity:1}
.slide-text.hook{color:#F7931A;font-size:64px;font-weight:800}
.slide-text.cta{color:#22c55e;font-size:52px;font-weight:700}
.progress{position:absolute;bottom:120px;left:80px;right:80px;height:6px;background:#1a1a1a;border-radius:3px}
.progress-bar{height:100%;background:#F7931A;border-radius:3px;transition:width 0.1s linear;width:0%}
.timer{position:absolute;bottom:80px;right:80px;color:#666;font-size:28px;font-family:monospace}
.controls{position:absolute;bottom:40px;left:80px;display:flex;gap:20px}
.controls button{background:#222;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:24px;cursor:pointer}
.controls button:hover{background:#333}
.watermark{position:absolute;top:60px;right:60px;color:#333;font-size:22px;font-family:monospace}
</style>
</head>
<body>
<div class="container">
  <div class="watermark">ArmedCapital Studio</div>
  <div class="title">${safeTitle}</div>
  <div class="slide-text" id="slideText"></div>
  <div class="progress"><div class="progress-bar" id="progressBar"></div></div>
  <div class="timer" id="timer">0:00 / ${Math.ceil(totalDuration)}s</div>
  <div class="controls">
    <button id="playBtn" onclick="togglePlay()">▶ Play</button>
    <button onclick="restart()">↺ Restart</button>
  </div>
</div>
<script>
const slides=${slidesJSON};
const totalDuration=${totalDuration.toFixed(1)};
let currentSlide=0,elapsed=0,slideElapsed=0,playing=false,rafId=null,lastTime=0;
const textEl=document.getElementById('slideText');
const barEl=document.getElementById('progressBar');
const timerEl=document.getElementById('timer');
const playBtn=document.getElementById('playBtn');

function showSlide(i){
  if(i>=slides.length){playing=false;playBtn.textContent='▶ Play';return}
  const s=slides[i];
  textEl.className='slide-text '+s.style+' active';
  textEl.textContent=s.text;
}

function formatTime(s){
  const m=Math.floor(s/60),sec=Math.floor(s%60);
  return m+':'+String(sec).padStart(2,'0');
}

function tick(now){
  if(!playing)return;
  if(!lastTime)lastTime=now;
  const dt=(now-lastTime)/1000;
  lastTime=now;
  elapsed+=dt;
  slideElapsed+=dt;
  if(currentSlide<slides.length && slideElapsed>=slides[currentSlide].duration){
    slideElapsed=0;
    currentSlide++;
    if(currentSlide<slides.length)showSlide(currentSlide);
    else{textEl.className='slide-text';textEl.textContent='';playing=false;playBtn.textContent='▶ Play'}
  }
  const pct=Math.min(100,elapsed/totalDuration*100);
  barEl.style.width=pct+'%';
  timerEl.textContent=formatTime(elapsed)+' / '+Math.ceil(totalDuration)+'s';
  if(playing)rafId=requestAnimationFrame(tick);
}

function togglePlay(){
  if(playing){playing=false;lastTime=0;playBtn.textContent='▶ Play'}
  else{playing=true;lastTime=0;if(currentSlide>=slides.length)restart();else showSlide(currentSlide);rafId=requestAnimationFrame(tick);playBtn.textContent='⏸ Pause'}
}

function restart(){
  playing=false;lastTime=0;currentSlide=0;elapsed=0;slideElapsed=0;
  barEl.style.width='0%';
  timerEl.textContent='0:00 / '+Math.ceil(totalDuration)+'s';
  textEl.className='slide-text';textEl.textContent='';
  playBtn.textContent='▶ Play';
}

showSlide(0);
textEl.classList.remove('active');
</script>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || "generate";

    if (action === "generate") {
      const niche = body.niche || "finance";
      const language = body.language || "en";

      const client = getClient();
      const msg = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: `Create a YouTube Shorts script for a 30-60 second vertical video about: ${niche}

Language: ${language}

Provide the output in this exact format:
TITLE: [catchy title, max 100 chars]
DESCRIPTION: [YouTube description with hashtags, max 500 chars]
HOOK: [opening hook, first 3 seconds to grab attention]
SCRIPT: [full narration script, 100-150 words for 30-60 seconds]
TAGS: [comma-separated tags for YouTube]
CTA: [call to action for end of video]

Make it punchy, fast-paced, and optimized for short attention spans. Financial/macro perspective.`,
          },
        ],
      });

      const text =
        msg.content[0].type === "text" ? msg.content[0].text.trim() : "";

      // Parse the structured output
      const titleMatch = text.match(/TITLE:\s*(.+)/i);
      const descMatch = text.match(/DESCRIPTION:\s*(.+)/i);
      const hookMatch = text.match(/HOOK:\s*(.+)/i);
      const scriptMatch = text.match(/SCRIPT:\s*([\s\S]+?)(?=\nTAGS:)/i);
      const tagsMatch = text.match(/TAGS:\s*(.+)/i);
      const ctaMatch = text.match(/CTA:\s*(.+)/i);

      return NextResponse.json({
        success: true,
        message: "YouTube Short script generated!",
        title: titleMatch?.[1]?.trim() || "",
        description: descMatch?.[1]?.trim() || "",
        hook: hookMatch?.[1]?.trim() || "",
        script: scriptMatch?.[1]?.trim() || text,
        tags: tagsMatch?.[1]?.trim() || "",
        cta: ctaMatch?.[1]?.trim() || "",
        raw: text,
      });
    }

    if (action === "render") {
      // Generate an HTML video presentation (no ffmpeg required)
      const { title, hook, script, cta } = body;
      if (!script) {
        return NextResponse.json(
          { success: false, error: "No script provided for video render" },
          { status: 400 }
        );
      }

      const outDir = path.join(process.cwd(), "public", "studio-output");
      await mkdir(outDir, { recursive: true });

      const timestamp = Date.now();
      const htmlFile = path.join(outDir, `short-${timestamp}.html`);
      const publicUrl = `/studio-output/short-${timestamp}.html`;

      const html = buildVideoHTML(
        title || "YouTube Short",
        hook || "",
        script,
        cta || ""
      );

      await writeFile(htmlFile, html, "utf-8");

      const words = script.split(/\s+/);
      const segCount = Math.ceil(words.length / 6);
      const secPerSeg = Math.max(2, Math.min(4, 55 / segCount));
      const duration = Math.ceil((hook ? 3 : 0) + segCount * secPerSeg + (cta ? 3 : 0));

      return NextResponse.json({
        success: true,
        message: "Video preview rendered!",
        videoUrl: publicUrl,
        duration,
        format: "html",
        hint: "Open in browser and screen-record for MP4, or use as teleprompter",
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message || "Studio service error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const hasKey = !!(
    process.env.ANTHROPIC_API_KEY || process.env.STUDIO_ANTHROPIC_API_KEY
  );
  return NextResponse.json({
    status: hasKey ? "ready" : "no_api_key",
    message: hasKey
      ? "YouTube Shorts generator is ready — Claude AI writes scripts"
      : "Set ANTHROPIC_API_KEY in .env.local",
  });
}
