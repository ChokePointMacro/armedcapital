import { NextRequest, NextResponse } from 'next/server';
import { getAutoReports } from '@/lib/db';
import { apiGuard } from '@/lib/apiGuard';

export async function GET(request: NextRequest) {
  // Rate limit public endpoint by IP (no auth required, but throttled)
  const guard = await apiGuard(request, { requireAuth: false, tier: 'public' });
  if (guard instanceof NextResponse) return guard;

  // Optional API key gating — if PUBLIC_REPORTS_KEY is set, require it
  const apiKey = process.env.PUBLIC_REPORTS_KEY;
  if (apiKey) {
    const provided = request.headers.get('x-api-key')
      || request.nextUrl.searchParams.get('key');
    if (provided !== apiKey) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 403 });
    }
  }

  try {
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = Math.min(Math.max(parseInt(limitParam || '20', 10) || 20, 1), 50);

    const reports = await getAutoReports(limit);

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

    return NextResponse.json(formattedReports, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('[API] Error in /api/public/reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}
