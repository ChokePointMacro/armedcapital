/**
 * YouTube Shorts Studio Routes — Direct Claude AI integration
 * POST /api/studio/youtube — Generate a YouTube Short script + render MP4 video
 * GET  /api/studio/youtube — Get status
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

const getClient = () => {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    process.env.STUDIO_ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: key });
};

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
      const srtFile = path.join(outDir, `short-${timestamp}.srt`);
      const mp4File = path.join(outDir, `short-${timestamp}.mp4`);
      const publicUrl = `/studio-output/short-${timestamp}.mp4`;

      // Break script into subtitle segments (~6 words each)
      const words = script.split(/\s+/);
      const segments: string[] = [];
      for (let i = 0; i < words.length; i += 6) {
        segments.push(words.slice(i, i + 6).join(" "));
      }

      const secPerSegment = Math.max(2, Math.min(4, 55 / segments.length));

      // Build SRT subtitle file
      const fmt = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `00:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };

      let srt = "";
      let idx = 1;
      let offset = 0;

      // Hook segment
      if (hook) {
        srt += `${idx}\n${fmt(0)} --> ${fmt(3)}\n${hook}\n\n`;
        idx++;
        offset = 3;
      }

      // Script segments
      segments.forEach((seg, i) => {
        const start = offset + i * secPerSegment;
        const end = offset + (i + 1) * secPerSegment;
        srt += `${idx}\n${fmt(start)} --> ${fmt(end)}\n${seg}\n\n`;
        idx++;
      });

      // CTA segment
      if (cta) {
        const ctaStart = offset + segments.length * secPerSegment;
        const ctaEnd = ctaStart + 3;
        srt += `${idx}\n${fmt(ctaStart)} --> ${fmt(ctaEnd)}\n${cta}\n\n`;
      }

      await writeFile(srtFile, srt, "utf-8");

      const duration = Math.ceil(offset + segments.length * secPerSegment + (cta ? 3 : 0));
      const safeTitle = (title || "YouTube Short").replace(/'/g, "'\\''").replace(/[^\x20-\x7E]/g, "");

      // ffmpeg: dark background 1080x1920, orange title at top, white subtitles centered
      const ffmpegCmd = [
        "ffmpeg -y",
        `-f lavfi -i color=c=0x0a0a0a:s=1080x1920:d=${duration}`,
        `-vf "drawtext=text='${safeTitle}':fontcolor=0xF7931A:fontsize=44:x=(w-text_w)/2:y=200,subtitles='${srtFile}':force_style='FontSize=26,PrimaryColour=&Hffffff&,Alignment=2,MarginV=400'"`,
        "-c:v libx264 -preset ultrafast -pix_fmt yuv420p",
        `-t ${duration}`,
        `"${mp4File}"`,
      ].join(" ");

      try {
        await execAsync(ffmpegCmd, { timeout: 120000 });
        await unlink(srtFile).catch(() => {});
        return NextResponse.json({
          success: true,
          message: "Video rendered!",
          videoUrl: publicUrl,
          duration,
          format: "mp4",
        });
      } catch (ffErr: unknown) {
        await unlink(srtFile).catch(() => {});
        const errMsg = ffErr instanceof Error ? ffErr.message : String(ffErr);
        const stderr = (ffErr as { stderr?: string })?.stderr?.slice(0, 500) || "";
        return NextResponse.json(
          {
            success: false,
            error: `ffmpeg error: ${stderr || errMsg}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "Studio service error";
    return NextResponse.json(
      { success: false, error: errMsg },
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
