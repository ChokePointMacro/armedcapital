import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAutoReports } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const reports = await getAutoReports(50);

    const formattedReports = reports.map((r: any) => ({
      ...r,
      content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    }));

    return NextResponse.json(formattedReports);
  } catch (error) {
    console.error('[API] Error in GET /api/reports/automated:', error);
    return NextResponse.json(
      { error: 'Failed to fetch automated reports' },
      { status: 500 }
    );
  }
}
