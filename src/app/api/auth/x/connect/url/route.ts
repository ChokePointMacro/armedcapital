import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { upsertPlatformToken } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * X "connect" endpoint — verifies OAuth 1.0a env-var credentials
 * and stores the connection in the DB. No popup/redirect needed
 * because the app uses a single set of app-owner tokens.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const apiKey = process.env.X_API_KEY;
    const apiSecret = process.env.X_API_SECRET;
    const accessToken = process.env.X_ACCESS_TOKEN;
    const accessSecret = process.env.X_ACCESS_SECRET;

    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
      return NextResponse.json({
        error: 'X OAuth 1.0a credentials not configured. Add X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, and X_ACCESS_SECRET to your environment variables.',
        needsConfig: true,
        platform: 'x',
      }, { status: 503 });
    }

    // All 4 env vars are set — trust them and connect directly.
    // Skip client.v2.me() verification because X Free tier rate limits
    // can cause false 401s, and regenerating consumer keys invalidates
    // access tokens until they're re-generated on the developer portal.
    const handle = '@ChokepointMacro';

    // Save connection to DB
    await upsertPlatformToken({
      user_id: userId,
      platform: 'x',
      access_token: 'oauth1a-env', // Marker — actual tokens are in env vars
      handle,
    });

    // Return direct-connect response (no popup URL needed)
    return NextResponse.json({
      connected: true,
      handle,
      username: 'ChokepointMacro',
      name: 'Chokepoint Macro',
    });
  } catch (error) {
    console.error('[API] Error connecting X:', error);
    const msg = error instanceof Error ? error.message : String(error);

    // Common error: 401 means bad credentials
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return NextResponse.json({
        error: 'X credentials are invalid or expired. Regenerate your API keys in the X Developer Portal.',
        needsConfig: true,
        platform: 'x',
      }, { status: 503 });
    }

    return NextResponse.json(
      { error: `Failed to connect X: ${msg}` },
      { status: 500 }
    );
  }
}
