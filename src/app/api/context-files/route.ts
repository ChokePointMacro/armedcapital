import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getContextFiles, upsertContextFile } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const files = await getContextFiles();
    return NextResponse.json(files);
  } catch (error) {
    console.error('[API] Error in GET /api/context-files:', error);
    return NextResponse.json(
      { error: 'Failed to fetch context files' },
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

    const { name, content } = await request.json();

    if (!name || !content) {
      return NextResponse.json(
        { error: 'name and content are required' },
        { status: 400 }
      );
    }

    await upsertContextFile(name, content);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in POST /api/context-files:', error);
    return NextResponse.json(
      { error: 'Failed to save context file' },
      { status: 500 }
    );
  }
}
