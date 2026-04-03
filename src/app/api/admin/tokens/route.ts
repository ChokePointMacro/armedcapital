import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { initTokens, getTokenStatus, refreshToken } from '@/lib/tokenManager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/tokens — Initialize all tokens and return status
 * Called on login or when checking integration health.
 * Loads all platform_credentials from Supabase into runtime memory
 * and fires refresh callbacks for each integration.
 */
export async function GET() {
  try {
    await safeAuth();
    await initTokens();
    const status = getTokenStatus();

    return NextResponse.json({
      initialized: true,
      tokens: status.map(t => ({
        platform: t.platform,
        key: t.keyName,
        valid: t.valid,
        ageSeconds: t.age,
      })),
      count: status.length,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to initialize tokens' }, { status: 500 });
  }
}

/**
 * POST /api/admin/tokens — Force refresh a specific token
 * Body: { platform: string, keyName: string }
 */
export async function POST(req: Request) {
  try {
    await safeAuth();
    const { platform, keyName } = await req.json();

    if (!platform || !keyName) {
      return NextResponse.json({ error: 'platform and keyName required' }, { status: 400 });
    }

    const newToken = await refreshToken(platform, keyName);
    return NextResponse.json({
      success: !!newToken,
      platform,
      keyName,
      refreshed: !!newToken,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to refresh token' }, { status: 500 });
  }
}
