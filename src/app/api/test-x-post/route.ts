import { NextRequest, NextResponse } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

export const dynamic = 'force-dynamic';

// Quick test endpoint — POST with { "text": "..." }
// Uses env var OAuth 1.0a keys directly, no Clerk auth required
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.X_API_KEY;
    const apiSecret = process.env.X_API_SECRET;
    const accToken = process.env.X_ACCESS_TOKEN;
    const accSecret = process.env.X_ACCESS_SECRET;

    if (!apiKey || !apiSecret || !accToken || !accSecret) {
      return NextResponse.json({
        error: 'X OAuth 1.0a credentials not configured',
        missing: {
          X_API_KEY: !apiKey,
          X_API_SECRET: !apiSecret,
          X_ACCESS_TOKEN: !accToken,
          X_ACCESS_SECRET: !accSecret,
        },
      }, { status: 500 });
    }

    const { text } = await request.json();
    if (!text?.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accToken,
      accessSecret: accSecret,
    });

    const result = await client.v2.tweet(text.substring(0, 280));

    return NextResponse.json({
      success: true,
      tweetId: result.data.id,
      url: `https://x.com/i/status/${result.data.id}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[test-x-post] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
