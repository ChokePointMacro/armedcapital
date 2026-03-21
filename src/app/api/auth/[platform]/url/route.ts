import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getPlatformCredential, createPendingAuth } from '@/lib/db';
import crypto from 'crypto';

function hasValidCreds(platform: string, creds: Record<string, string | null>): boolean {
  switch (platform) {
    case 'x':
    case 'x/connect':
      return !!(creds['client_id'] && creds['client_secret']);
    case 'linkedin':
      return !!(creds['client_id'] && creds['client_secret']);
    case 'threads':
      return !!(creds['app_id'] && creds['app_secret']);
    case 'instagram':
      return !!(creds['app_id'] && creds['app_secret']);
    default:
      return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { platform } = params;
    const basePlatform = platform.includes('/') ? platform.split('/')[0] : platform;

    // Get platform credentials from DB
    const credKeys: Record<string, string[]> = {
      x: ['client_id', 'client_secret'],
      linkedin: ['client_id', 'client_secret'],
      threads: ['app_id', 'app_secret'],
      instagram: ['app_id', 'app_secret'],
    };

    const keys = credKeys[basePlatform];
    if (!keys) {
      return NextResponse.json(
        { error: `Unsupported platform: ${platform}` },
        { status: 400 }
      );
    }

    const creds: Record<string, string | null> = {};
    for (const key of keys) {
      const row = await getPlatformCredential(basePlatform, key);
      creds[key] = row?.key_value || null;
    }

    if (!hasValidCreds(basePlatform, creds)) {
      return NextResponse.json({
        error: `${basePlatform} OAuth credentials not configured`,
        needsConfig: true,
        platform: basePlatform,
      }, { status: 503 });
    }

    // Build OAuth URL based on platform
    const origin = request.headers.get('origin') || request.nextUrl.origin;
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Store pending auth
    await createPendingAuth(state, codeVerifier, basePlatform);

    let url: string;

    switch (basePlatform) {
      case 'x': {
        const clientId = creds['client_id']!;
        const redirectUri = `${origin}/auth/x/callback`;
        const scopes = 'tweet.read tweet.write users.read offline.access';
        url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
        break;
      }
      case 'linkedin': {
        const clientId = creds['client_id']!;
        const redirectUri = `${origin}/auth/linkedin/callback`;
        const scopes = 'openid profile email w_member_social';
        url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
        break;
      }
      case 'threads': {
        const appId = creds['app_id']!;
        const redirectUri = `${origin}/auth/threads/callback`;
        const scopes = 'threads_basic,threads_content_publish';
        url = `https://threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code&state=${state}`;
        break;
      }
      case 'instagram': {
        const appId = creds['app_id']!;
        const redirectUri = `${origin}/auth/instagram/callback`;
        url = `https://api.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user_profile,user_media&response_type=code&state=${state}`;
        break;
      }
      default:
        return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 });
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error(`[API] Error generating OAuth URL:`, error);
    return NextResponse.json(
      { error: 'Failed to generate auth link', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
