import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { saveReport } from '@/lib/db';
import { generateInstagramCaption } from '@/services/geminiService';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { reportId } = await request.json();

    if (!reportId) {
      return NextResponse.json(
        { error: 'reportId is required' },
        { status: 400 }
      );
    }

    // Note: In a real implementation, you'd fetch the report from the database
    // For now, we assume the reportId is passed and the report content is available
    // This would need to be integrated with the actual database fetch
    const reportContent = await fetch(`/api/reports/${reportId}`).then(r => r.json()).catch(() => null);

    if (!reportContent) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }

    const report = typeof reportContent.content === 'string'
      ? JSON.parse(reportContent.content)
      : reportContent.content;

    const caption = await generateInstagramCaption(report);
    return NextResponse.json({ caption });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API] Instagram caption error:', error);

    if (message.includes('rate limit') || message.includes('429') || message.includes('quota')) {
      return NextResponse.json(
        { error: `Rate limit error: ${message}`, type: 'RATE_LIMIT' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: `Failed to generate caption: ${message}` },
      { status: 500 }
    );
  }
}
