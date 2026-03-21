import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { generateSubstackArticle } from '@/services/geminiService';

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

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

    // Fetch the report - in a real implementation, this would come from the database
    const reportResponse = await fetch(`/api/reports`).then(r => r.json()).catch(() => []);
    const reportRow = Array.isArray(reportResponse)
      ? reportResponse.find((r: any) => r.id === reportId)
      : null;

    if (!reportRow) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }

    const report = typeof reportRow.content === 'string'
      ? JSON.parse(reportRow.content)
      : reportRow.content;

    console.log(`[API] Generating Substack article for report ${reportId}...`);
    const article = await generateSubstackArticle(report);

    return NextResponse.json({ article });
  } catch (error) {
    console.error('[API] Substack article error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate article',
      },
      { status: 500 }
    );
  }
}
