import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createScheduledPost } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { items } = await request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided' },
        { status: 400 }
      );
    }

    let count = 0;
    for (const item of items) {
      if (!item.enabled) continue;
      const content =
        item.type === 'tweet'
          ? item.content
          : item.type === 'instagram'
            ? `[INSTAGRAM] ${item.content}`
            : `[SUBSTACK] ${item.content}`;

      await createScheduledPost({
        user_id: userId,
        content,
        scheduled_at: item.time,
      });

      count++;
    }

    return NextResponse.json({
      success: true,
      scheduled: count,
    });
  } catch (error) {
    console.error('[API] Error in POST /api/auto-schedule/confirm:', error);
    return NextResponse.json(
      { error: 'Failed to schedule posts' },
      { status: 500 }
    );
  }
}
