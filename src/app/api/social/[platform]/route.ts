import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { deletePlatformToken } from '@/lib/db';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { platform } = params;
    const validPlatforms = ['x', 'linkedin', 'threads', 'instagram', 'substack', 'bluesky'];

    if (!platform || !validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: 'Invalid platform' },
        { status: 400 }
      );
    }

    await deletePlatformToken(userId, platform);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[API] Error disconnecting platform:`, error);
    return NextResponse.json(
      { error: 'Failed to disconnect platform' },
      { status: 500 }
    );
  }
}
