import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getContextFile, upsertContextFile, deleteContextFile } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { name } = await params;

    const file = await getContextFile(name);

    if (!file) {
      return NextResponse.json(
        { error: 'Context file not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(file);
  } catch (error) {
    console.error('[API] Error in GET /api/context-files/[name]:', error);
    return NextResponse.json(
      { error: 'Failed to fetch context file' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { name } = await params;
    const { content } = await request.json();

    if (!content) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    await upsertContextFile(name, content);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in PATCH /api/context-files/[name]:', error);
    return NextResponse.json(
      { error: 'Failed to update context file' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { name } = await params;

    await deleteContextFile(name);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in DELETE /api/context-files/[name]:', error);
    return NextResponse.json(
      { error: 'Failed to delete context file' },
      { status: 500 }
    );
  }
}
