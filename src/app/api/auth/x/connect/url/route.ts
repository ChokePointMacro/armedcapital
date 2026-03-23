import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { upsertPlatformToken } from '@/lib/db';
import { hasOAuth1aEnvVars } from '@/lib/xClient';
import { TwitterApi } from 'twitter-api-v2';

export const dynamic = 'force-dynamic';

/**
 * X "connect" endpoint — verifies OAuth 1.0a env-var credentials
 * and stores the connection in the DB. No popup/redirect needed
 * because the app uses a single set of app-owner tokens.
 *
 * Now includes credential verification with 8s timeout to confirm
 * keys are valid before marking the connection as active.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await safeAuth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!hasOAuth1aEnvVars()) {
      return NextResponse.json({
        error: 'X OAuth 1.0a credentials not configured. Add X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, and X_ACCESS_SECRET to your environment variables.',
        needsConfig: true,
        platform: 'x',
      }, { status: 503 });
    }

    // Verify credentials by calling v2.me() with an 8s timeout
    // This confirms the keys actually work before saving the connection
    let handle = '@ChokepointMacro';
    let username = 'ChokepointMacro';
    let displayName = 'Chokepoint Macro';

    try {
      const client = new TwitterApi({
        appKey: process.env.X_API_KEY!,
        appSecret: process.env.X_API_SECRET!,
        accessToken: process.env.X_ACCESS_TOKEN!,
        accessSecret: process.env.X_ACCESS_SECRET!,
      });

      const me = await Promise.race([
        client.v2.me(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), 8000)
        ),
      ]);

      handle = `@${me.data.username}`;
      username = me.data.username;
      displayName = me.data.name;
    } catch (verifyErr) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      // If rate limited or timed out, still allow connection (keys are set)
      // Only reject on actual auth failures
      if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
        return NextResponse.json({
          error: 'X credentials are invalid or expired. Regenerate your API keys in the X Developer Portal.',
          needsConfig: true,
          platform: 'x',
        }, { status: 503 });
      }
      // Rate limit or timeout — proceed with defaults
      console.warn('[auth/x/connect] Verification skipped (rate limit or timeout):', msg);
    }

    // Save connection to DB
    await upsertPlatformToken({
      user_id: userId,
      platform: 'x',
      access_token: 'oauth1a-env', // Marker — actual tokens are in env vars
      handle,
    });

    return NextResponse.json({
      connected: true,
      handle,
      username,
      name: displayName,
    });
  } catch (error) {
    console.error('[API] Error connecting X:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to connect X: ${msg}` }, { status: 500 });
  }
}
