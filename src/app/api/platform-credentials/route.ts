import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAllPlatformTokens, upsertPlatformToken } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const tokens = await getAllPlatformTokens(userId);
    return NextResponse.json(tokens);
  } catch (error) {
    console.error('[API] Error in GET /api/platform-credentials:', error);
    return NextResponse.json(
      { error: 'Failed to fetch platform credentials' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { platform, access_token, refresh_token, handle, person_urn, expires_at } = await request.json();

    if (!platform || !access_token) {
      return NextResponse.json(
        { error: 'platform and access_token are required' },
        { status: 400 }
      );
    }

    await upsertPlatformToken({
      user_id: userId,
      platform,
      access_token,
      refresh_token,
      handle,
      person_urn,
      expires_at,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in POST /api/platform-credentials:', error);
    return NextResponse.json(
      { error: 'Failed to save platform credentials' },
      { status: 500 }
    );
  }
}
