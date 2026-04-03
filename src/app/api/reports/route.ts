import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getReports, saveReport, deleteAllReports } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await safeAuth();

    const reports = await getReports(50);

    const formattedReports = reports.map((r: any) => {
      try {
        return {
          ...r,
          content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
        };
      } catch {
        console.warn(`[API] Skipping report ${r.id} — malformed JSON content`);
        return { ...r, content: null };
      }
    }).filter((r: any) => r.content !== null);

    return NextResponse.json(formattedReports);
  } catch (error) {
    console.error('[API] Error in GET /api/reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await safeAuth();

    const { id, type, content, customTopic } = await request.json();

    if (!id || !type || !content) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    await saveReport({
      id,
      type,
      content,
      custom_topic: customTopic || undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in POST /api/reports:', error);
    return NextResponse.json(
      { error: 'Failed to save report' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await safeAuth();

    console.log('Clearing all reports...');
    await deleteAllReports();
    console.log('Reports cleared successfully');

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[API] Error clearing reports:', errorMsg);
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
