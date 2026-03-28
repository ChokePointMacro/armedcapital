/**
 * Twitter/X Bot Studio Routes — Direct Claude AI integration
 * POST /api/studio/twitter — Generate preview or format tweet for posting
 * GET  /api/studio/twitter — Get bot status
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
    const action = body.action || "preview";

    if (action === "preview") {
      // Generate an AI tweet based on the topic
      const topic = body.topic || "markets";
      const client = getClient();
      const msg = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Write a single tweet (max 280 characters) about: ${topic}

Rules:
- Financial/macro perspective, authoritative tone
- Include 1-2 relevant hashtags
- No quotes, no emojis, no fluff
- Sharp, insightful, data-driven when possible
- Must be under 280 characters total

Return ONLY the tweet text, nothing else.`,
          },
        ],
      });

      const text =
        msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
      return NextResponse.json({
        text,
        preview: text,
        char_count: text.length,
      });
    }

    if (action === "post") {
      // Return a Twitter intent URL so the user can post with one click
      const text = body.text || body.customText || "";
      if (!text.trim()) {
        return NextResponse.json(
          { success: false, error: "No tweet text provided" },
          { status: 400 }
        );
      }
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      return NextResponse.json({
        success: true,
        message: "Tweet ready — opening X to post",
        tweetUrl: intentUrl,
        intentUrl,
        text,
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
      ? "X Bot is ready — Claude AI generates tweets"
      : "Set ANTHROPIC_API_KEY in .env.local",
  });
}
