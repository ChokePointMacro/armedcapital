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

async function handleGenerate(body: { topic?: string; style?: string }) {
  const { topic, style } = body;
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
    script: scriptData,
    model: "claude-sonnet-4-20250514",
  });
}

async function handleRender(body: {
  script?: { title?: string; hook?: string; script?: string; cta?: string; estimatedDuration?: number };
}) {
  const { script } = body;
  if (!script) {
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

  const duration = script.estimatedDuration || 45;
  const title = (script.title || "").replace(/'/g, "\\'").replace(/"/g, '\\"');
  const hook = (script.hook || "").replace(/'/g, "\\'").replace(/"/g, '\\"');
  const narration = (script.script || "").replace(/'/g, "\\'").replace(/"/g, '\\"');
  const cta = (script.cta || "").replace(/'/g, "\\'").replace(/"/g, '\\"');

  // Step 1: Generate frames with Python/Pillow
  const pyCmd = `python3 "${pythonScript}" --out-dir "${framesDir}" --title "${title}" --hook "${hook}" --script "${narration}" --cta "${cta}" --duration ${duration}`;

  let pyResult;
  try {
    pyResult = await execAsync(pyCmd, { timeout: 60000, maxBuffer: 1024 * 1024 });
  } catch (pyErr: unknown) {
    const stderr = pyErr instanceof Error && "stderr" in pyErr ? (pyErr as { stderr: string }).stderr : String(pyErr);
    return NextResponse.json(
      { error: "Frame generation failed", details: stderr.slice(-600) },
      { status: 500 }
    );
  }

  const pyOut = pyResult.stdout.trim();
  if (!pyOut.startsWith("OK:")) {
    return NextResponse.json(
      { error: "Frame generation failed", details: pyOut + "\n" + pyResult.stderr.slice(-400) },
      { status: 500 }
    );
  }

  // Step 2: Encode frames to MP4 with ffmpeg concat demuxer
  const concatFile = path.join(framesDir, "concat.txt");
  const ffCmd = [
    "ffmpeg -y",
    `-f concat -safe 0 -i "${concatFile}"`,
    "-vf fps=25",
    "-c:v libx264 -preset ultrafast -tune stillimage",
    "-pix_fmt yuv420p",
    `-t ${duration}`,
    `"${outputFile}"`,
  ].join(" ");

  let ffResult;
  try {
    ffResult = await execAsync(ffCmd, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  } catch (ffErr: unknown) {
    const stderr = ffErr instanceof Error && "stderr" in ffErr ? (ffErr as { stderr: string }).stderr : String(ffErr);
    return NextResponse.json(
      { error: "ffmpeg encoding failed", details: stderr.slice(-600) },
      { status: 500 }
    );
  }

  // Cleanup frames
  try {
    await rm(framesDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }

  const videoUrl = `/studio/output/short_${ts}.mp4`;

  return NextResponse.json({
    success: true,
    videoUrl,
    framesGenerated: pyOut,
    message: "MP4 rendered successfully",
  });
}
