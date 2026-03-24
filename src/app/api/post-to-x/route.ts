import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getPlatformToken, upsertPlatformToken } from '@/lib/db';
import { postTweet, postTweetWithToken, refreshOAuth2Token, hasOAuth1aEnvVars } from '@/lib/xClient';

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { text } = await request.json();

    // Try DB token first, fall back to env var OAuth 1.0a
    let tokenRecord = null;
    try {
      tokenRecord = await getPlatformToken(userId, 'x');
    } catch {
      // DB may not be initialized — fall through to env var
    }

    let result;
    if (tokenRecord && tokenRecord.access_token !== 'oauth1a-env') {
      // OAuth 2.0 token — refresh first and persist new tokens
      const refreshed = await refreshOAuth2Token(tokenRecord);
      if (refreshed?.accessToken) {
        // Save refreshed tokens to DB so they stay valid for next time
        try {
          await upsertPlatformToken({
            user_id: userId,
            platform: 'x',
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            handle: tokenRecord.handle,
            expires_at: refreshed.expiresAt,
          });
        } catch {
          // Non-fatal — we can still post with the refreshed token
        }
        result = await postTweetWithToken(text, {
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
        });
      } else if (hasOAuth1aEnvVars()) {
        result = await postTweet(text);
      } else {
        return NextResponse.json(
          { error: 'X token expired — reconnect your X account in Settings' },
          { status: 401 }
        );
      }
    } else if (tokenRecord) {
      // oauth1a-env marker — use env vars
      result = await postTweet(text);
    } else if (hasOAuth1aEnvVars()) {
      result = await postTweet(text);
    } else {
      return NextResponse.json(
        { error: 'X account not connected — go to Settings to connect your X account' },
        { status: 401 }
      );
    }

    if (result.success) {
      return NextResponse.json({ success: true, tweetId: result.tweetId, url: result.url });
    }

    const statusMap: Record<string, number> = { AUTH_FAILED: 401, RATE_LIMITED: 429, INVALID_TEXT: 400, CREDENTIALS_MISSING: 500, TIMEOUT: 504, UNKNOWN: 500 };
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: statusMap[result.code] || 500 }
    );
  } catch (error) {
    console.error('[API] Error in POST /api/post-to-x:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
