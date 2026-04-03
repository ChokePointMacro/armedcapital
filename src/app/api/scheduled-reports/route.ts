import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import {
  getScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
} from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const reports = await getScheduledReports();
    return NextResponse.json(reports);
  } catch (error) {
    console.error('[API] Error in GET /api/scheduled-reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled reports' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { report_type, custom_topic, schedule_time, days } = await request.json();

    if (!report_type || !schedule_time || !days) {
      return NextResponse.json(
        { error: 'report_type, schedule_time, and days are required' },
        { status: 400 }
      );
    }

    const report = await createScheduledReport({
      report_type,
      custom_topic: custom_topic || undefined,
      schedule_time,
      days,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error('[API] Error in POST /api/scheduled-reports:', error);
    return NextResponse.json(
      { error: 'Failed to create scheduled report' },
      { status: 500 }
    );
  }
}
