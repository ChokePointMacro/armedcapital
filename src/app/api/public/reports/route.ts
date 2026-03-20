import { NextRequest, NextResponse } from 'next/server';
import { getAutoReports } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const reports = await getAutoReports(50);

    const formattedReports = reports.map((r: any) => ({
      ...r,
      content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    }));

    return NextResponse.json(formattedReports);
  } catch (error) {
    console.error('[API] Error in /api/public/reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}
