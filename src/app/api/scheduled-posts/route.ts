import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getScheduledPosts, createScheduledPost, deleteScheduledPost } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const posts = await getScheduledPosts(userId);
    return NextResponse.json(posts);
  } catch (error) {
    console.error('[API] Error in GET /api/scheduled-posts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled posts' },
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

    const { content, scheduledAt } = await request.json();

    if (!content?.trim()) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    if (!scheduledAt) {
      return NextResponse.json(
        { error: 'scheduledAt is required' },
        { status: 400 }
      );
    }

    const post = await createScheduledPost({
      user_id: userId,
      content,
      scheduled_at: scheduledAt,
    });

    return NextResponse.json(post);
  } catch (error) {
    console.error('[API] Error in POST /api/scheduled-posts:', error);
    return NextResponse.json(
      { error: 'Failed to create scheduled post' },
      { status: 500 }
    );
  }
}
