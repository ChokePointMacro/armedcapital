import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { updateScheduledReport, deleteScheduledReport } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const reportId = parseInt(id, 10);

    if (isNaN(reportId)) {
      return NextResponse.json(
        { error: 'Invalid report ID' },
        { status: 400 }
      );
    }

    const { report_type, custom_topic, schedule_time, days, enabled, last_run } = await request.json();

    const updates: any = {};
    if (report_type) updates.report_type = report_type;
    if (custom_topic) updates.custom_topic = custom_topic;
    if (schedule_time) updates.schedule_time = schedule_time;
    if (days) updates.days = days;
    if (enabled !== undefined) updates.enabled = enabled;
    if (last_run) updates.last_run = last_run;

    await updateScheduledReport(reportId, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in PATCH /api/scheduled-reports/[id]:', error);
    return NextResponse.json(
      { error: 'Failed to update scheduled report' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const reportId = parseInt(id, 10);

    if (isNaN(reportId)) {
      return NextResponse.json(
        { error: 'Invalid report ID' },
        { status: 400 }
      );
    }

    await deleteScheduledReport(reportId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in DELETE /api/scheduled-reports/[id]:', error);
    return NextResponse.json(
      { error: 'Failed to delete scheduled report' },
      { status: 500 }
    );
  }
}
