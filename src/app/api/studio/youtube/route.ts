/**
 * YouTube Shorts Studio Routes — Direct Claude AI integration
 * POST /api/studio/youtube — Generate a YouTube Short script + metadata
 * GET  /api/studio/youtube — Get status
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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
