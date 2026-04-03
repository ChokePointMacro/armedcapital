/**
 * YouTube Shorts Studio Routes — Direct Claude AI integration
 * POST /api/studio/youtube — Generate a YouTube Short script + render MP4 video
 * GET  /api/studio/youtube — Get status
 *
 * Render pipeline: Python/Pillow generates text frames → ffmpeg encodes MP4
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdir, rm } from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

const getClient = () => {
  const key = process.env.ANTHROPIC_API_KEY || process.env.STUDIO_ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: key });
};

export async function GET() {
  return NextResponse.json({
    status: "ready",
    service: "youtube-shorts-studio",
    capabilities: ["generate", "render"],
    render_engine: "pillow+ffmpeg",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "generate") {
      return handleGenerate(body);
    } else if (action === "render") {
      return handleRender(body);
    }

    return NextResponse.json({ error: "Invalid action. Use 'generate' or 'render'." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("YouTube Studio error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleGenerate(body: { topic?: string; niche?: string; style?: string }) {
  const topic = body.topic || body.niche;
  const style = body.style;
  if (!topic) {
    return NextResponse.json({ error: "Topic is required" }, { status: 400 });
  }

  const client = getClient();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a YouTube Shorts script writer for a finance/crypto channel called "ArmedCapital".
Write a script for a 45-60 second YouTube Short about: ${topic}
${style ? `Style: ${style}` : "Style: punchy, data-driven, slightly edgy"}

Return ONLY valid JSON (no markdown, no code fences):
{
  "title": "Video title (max 60 chars)",
  "hook": "Opening hook line (first 3 seconds, attention-grabbing)",
  "script": "Full narration script, 100-150 words, conversational tone",
  "cta": "Call to action (subscribe, follow, etc)",
  "hashtags": ["tag1", "tag2", "tag3"],
  "estimatedDuration": 45
}`,
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  let scriptData;
  try {
    scriptData = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      scriptData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Failed to parse AI response as JSON");
    }
  }

  return NextResponse.json({
    success: true,
    title: scriptData.title,
    hook: scriptData.hook,
    script: scriptData.script,
    cta: scriptData.cta,
    tags: Array.isArray(scriptData.hashtags) ? scriptData.hashtags.join(", ") : scriptData.hashtags,
    description: scriptData.description || "",
    estimatedDuration: scriptData.estimatedDuration || 45,
    model: "claude-sonnet-4-20250514",
  });
}

async function handleRender(body: {
  title?: string; hook?: string; script?: string; cta?: string; estimatedDuration?: number;
}) {
  const { title: scriptTitle = "", hook: scriptHook = "", script: scriptNarration = "", cta: scriptCta = "" } = body;

  if (!scriptTitle && !scriptHook && !scriptNarration) {
    return NextResponse.json({ error: "Script data is required" }, { status: 400 });
  }

  const ts = Date.now();
  const projectRoot = process.cwd();
  const framesDir = path.join(projectRoot, "public", "studio", "frames", `job_${ts}`);
  const outputDir = path.join(projectRoot, "public", "studio", "output");
  const outputFile = path.join(outputDir, `short_${ts}.mp4`);
  const pythonScript = path.join(projectRoot, "scripts", "render_frames.py");

  await mkdir(framesDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const duration = body.estimatedDuration || 45;
  const title = scriptTitle.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const hook = scriptHook.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const narration = scriptNarration.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const cta = scriptCta.replace(/'/g, "\\'").replace(/"/g, '\\"');

  // Single Python call: generates frames, TTS audio, and encodes MP4
  const pyCmd = [
    `python3 "${pythonScript}"`,
    `--out-dir "${framesDir}"`,
    `--title "${title}"`,
    `--hook "${hook}"`,
    `--script "${narration}"`,
    `--cta "${cta}"`,
    `--duration ${duration}`,
    `--mp4 "${outputFile}"`,
  ].join(" ");

  let pyResult;
  try {
    pyResult = await execAsync(pyCmd, { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  } catch (pyErr: unknown) {
    const stderr = pyErr instanceof Error && "stderr" in pyErr ? (pyErr as { stderr: string }).stderr : String(pyErr);
    return NextResponse.json(
      { error: "Video render failed", details: stderr.slice(-800) },
      { status: 500 }
    );
  }

  const pyOut = pyResult.stdout.trim();
  if (!pyOut.startsWith("OK:")) {
    return NextResponse.json(
      { error: "Video render failed", details: pyOut + "\n" + pyResult.stderr.slice(-600) },
      { status: 500 }
    );
  }

  // Cleanup frames dir
  try {
    await rm(framesDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }

  const hasAudio = pyOut.includes("audio=yes");
  const videoUrl = `/studio/output/short_${ts}.mp4`;

  return NextResponse.json({
    success: true,
    videoUrl,
    duration,
    hasAudio,
    framesGenerated: pyOut,
    message: hasAudio ? "MP4 rendered with voiceover" : "MP4 rendered (no audio)",
  });
}
