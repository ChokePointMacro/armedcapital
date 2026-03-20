import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAppSetting, setAppSetting } from '@/lib/db';

export async function GET(
  request: NextRequest
) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json(
        { error: 'key query parameter is required' },
        { status: 400 }
      );
    }

    const value = await getAppSetting(key);
    return NextResponse.json({ key, value });
  } catch (error) {
    console.error('[API] Error in GET /api/app-settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch setting' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { key, value } = await request.json();

    if (!key || !value) {
      return NextResponse.json(
        { error: 'key and value are required' },
        { status: 400 }
      );
    }

    await setAppSetting(key, value);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in PUT /api/app-settings:', error);
    return NextResponse.json(
      { error: 'Failed to update setting' },
      { status: 500 }
    );
  }
}
