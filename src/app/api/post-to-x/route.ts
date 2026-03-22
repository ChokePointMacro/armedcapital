import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getPlatformToken } from '@/lib/db';
import { TwitterApi } from 'twitter-api-v2';

async function refreshXToken(tokenRecord: any): Promise<any | null> {
  if (!tokenRecord.refresh_token) {
    return { accessToken: tokenRecord.access_token };
  }

  try {
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('X OAuth credentials not configured');
      return null;
    }

    const res = await fetch('https://token.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRecord.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!res.ok) {
      console.error('Failed to refresh X token:', await res.text());
      return null;
    }

    const data = await res.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };
  } catch (error) {
    console.error('Error refreshing X token:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { text } = await request.json();

    if (!text?.trim()) {
      return NextResponse.json(
        { error: 'Cannot post empty content' },
        { status: 400 }
      );
    }

    if (text.length > 280) {
      return NextResponse.json(
        { error: `Post too long: ${text.length}/280 characters` },
        { status: 400 }
      );
    }

    const tokenRecord = await getPlatformToken(userId, 'x');

    if (!tokenRecord) {
      return NextResponse.json(
        {
          error: 'X account not connected — go to Settings to connect your X account',
        },
        { status: 401 }
      );
    }

    try {
      let client: TwitterApi;

      // Check if using OAuth 1.0a env-var credentials
      if (tokenRecord.access_token === 'oauth1a-env') {
        const apiKey = process.env.X_API_KEY;
        const apiSecret = process.env.X_API_SECRET;
        const accToken = process.env.X_ACCESS_TOKEN;
        const accSecret = process.env.X_ACCESS_SECRET;
        if (!apiKey || !apiSecret || !accToken || !accSecret) {
          return NextResponse.json(
            { error: 'X OAuth 1.0a credentials not configured in environment' },
            { status: 500 }
          );
        }
        client = new TwitterApi({
          appKey: apiKey,
          appSecret: apiSecret,
          accessToken: accToken,
          accessSecret: accSecret,
        });
      } else {
        const refreshed = await refreshXToken(tokenRecord);
        if (!refreshed || !refreshed.accessToken) {
          return NextResponse.json(
            { error: 'Failed to authenticate - token is invalid' },
            { status: 401 }
          );
        }
        client = new TwitterApi(refreshed.accessToken);
      }

      const result = await client.v2.tweet(text);

      return NextResponse.json({
        success: true,
        tweetId: result.data.id,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[API] X posting error:', errorMsg);

      if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
        return NextResponse.json(
          {
            error: 'Authentication failed - reconnect your X account',
            details: errorMsg,
          },
          { status: 401 }
        );
      } else if (errorMsg.includes('429') || errorMsg.includes('rate')) {
        return NextResponse.json(
          {
            error: 'Rate limited - please wait before posting',
            details: errorMsg,
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        {
          error: 'Failed to post to X',
          details: errorMsg.substring(0, 200),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[API] Error in POST /api/post-to-x:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
