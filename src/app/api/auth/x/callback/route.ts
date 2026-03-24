import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getPendingAuth, deletePendingAuth, upsertPlatformToken, getPlatformCredential } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * OAuth 2.0 PKCE callback for X/Twitter.
 * Exchanges the authorization code for access + refresh tokens,
 * stores them in platform_tokens, and returns user info.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { code, state } = await request.json();

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    // Retrieve pending auth (code_verifier + platform)
    const pending = await getPendingAuth(state);
    if (!pending) {
      return NextResponse.json({ error: 'Invalid or expired state — try connecting again' }, { status: 400 });
    }

    // Get app credentials
    const clientIdRow = await getPlatformCredential('x', 'client_id');
    const clientSecretRow = await getPlatformCredential('x', 'client_secret');
    const clientId = clientIdRow?.key_value;
    const clientSecret = clientSecretRow?.key_value;

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'X OAuth app credentials not configured' }, { status: 503 });
    }

    // Build redirect URI (must match what was used in the auth URL)
    const origin = request.headers.get('origin') || request.nextUrl.origin;
    const redirectUri = `${origin}/auth/x/callback`;

    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: pending.code_verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[X OAuth] Token exchange failed:', tokenRes.status, errBody);
      await deletePendingAuth(state);
      return NextResponse.json(
        { error: `Token exchange failed (${tokenRes.status})`, details: errBody },
        { status: 502 }
      );
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      scope: string;
    };

    // Fetch the user's profile to get their handle
    let handle = '';
    try {
      const meRes = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (meRes.ok) {
        const meData = await meRes.json() as { data: { id: string; username: string; name: string } };
        handle = meData.data.username;
      }
    } catch {
      // Non-fatal — we still have the tokens
    }

    // Store tokens in DB
    const expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined;

    await upsertPlatformToken({
      user_id: userId,
      platform: 'x',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      handle: handle ? `@${handle}` : undefined,
      expires_at: expiresAt,
    });

    // Clean up pending auth
    await deletePendingAuth(state);

    return NextResponse.json({
      success: true,
      handle: handle ? `@${handle}` : null,
      username: handle,
      expiresIn: tokenData.expires_in,
    });
  } catch (error) {
    console.error('[X OAuth] Callback error:', error);
    return NextResponse.json(
      { error: 'OAuth callback failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
