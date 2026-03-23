import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getPlatformToken } from '@/lib/db';
import { postTweet, postTweetWithToken, hasOAuth1aEnvVars } from '@/lib/xClient';

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
    if (tokenRecord) {
      result = await postTweetWithToken(text, tokenRecord);
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

    const statusMap = { AUTH_FAILED: 401, RATE_LIMITED: 429, INVALID_TEXT: 400, CREDENTIALS_MISSING: 500, TIMEOUT: 504, UNKNOWN: 500 };
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: statusMap[result.code] || 500 }
    );
  } catch (error) {
    console.error('[API] Error in POST /api/post-to-x:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
