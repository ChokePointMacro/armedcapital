/**
 * Studio Health Check — checks if Claude AI is configured
 * GET /api/studio/health
 */

import { NextResponse } from "next/server";

export async function GET() {
  const hasKey = !!(
    process.env.ANTHROPIC_API_KEY || process.env.STUDIO_ANTHROPIC_API_KEY
  );

  if (!hasKey) {
    return NextResponse.json(
      {
        status: "error",
        detail: "ANTHROPIC_API_KEY not set in .env.local",
        llm_provider: "none",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ok",
    llm_provider: "claude",
    active_model: "claude-sonnet-4-20250514",
  });
}
