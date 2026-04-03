/**
 * LLM Management Routes
 * GET  /api/studio/llm — List models + active model
 * POST /api/studio/llm — Generate text or select model
 */

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/authHelper";

const STUDIO_API = process.env.STUDIO_API_URL || "http://localhost:8100";

export async function GET() {
  try {
    const userId = await safeAuth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const res = await fetch(`${STUDIO_API}/llm/models`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { models: [], error: "Studio service not running" },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await safeAuth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    // If "model" key present, it's a model selection; otherwise it's a generation request
    const endpoint = body.model && !body.prompt
      ? `${STUDIO_API}/llm/select`
      : `${STUDIO_API}/llm/generate`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Studio service error" },
      { status: 502 }
    );
  }
}
