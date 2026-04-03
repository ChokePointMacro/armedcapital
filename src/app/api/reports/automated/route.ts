import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getAutoReports } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const reports = await getAutoReports(limit + offset);

    const paginatedReports = reports.slice(offset, offset + limit);

    const formattedReports = paginatedReports.map((r: any) => ({
      ...r,
      content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    }));

    return NextResponse.json({
      data: formattedReports,
      pagination: {
        limit,
        offset,
        total: reports.length,
      },
    });
  } catch (error) {
    console.error('[API] Error in GET /api/reports/automated:', error);
    return NextResponse.json(
      { error: 'Failed to fetch automated reports' },
      { status: 500 }
    );
  }
}
