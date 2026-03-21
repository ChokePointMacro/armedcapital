import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

// Weekly report → publishing day mapping
const REPORT_DAY_MAP: Record<string, number> = {
  forecast: 0,
  crypto: 1,
  nasdaq: 2,
  conspiracies: 3,
  equities: 4,
  global: 5,
};

function getNextWeekday(targetDay: number): Date {
  const now = new Date();
  const currentDay = now.getUTCDay();
  const daysAhead = targetDay - currentDay;
  const nextDate = new Date(now);
  nextDate.setUTCDate(now.getUTCDate() + (daysAhead <= 0 ? daysAhead + 7 : daysAhead));
  nextDate.setUTCHours(0, 0, 0, 0);
  return nextDate;
}

function calculateTweetSlots(
  baseDate: Date,
  headlines: any[]
): Array<{ time: string; content: string; title: string; trendScore: number }> {
  const slots: Array<{ time: string; content: string; title: string; trendScore: number }> = [];

  // 7am–7pm EST = 12pm–midnight UTC
  const startHour = 12;
  const endHour = 24;
  const hours = endHour - startHour;
  const slotsPerDay = Math.max(1, Math.floor(hours / Math.max(1, Math.ceil(headlines.length / 3))));

  const firstSlotTime = new Date(baseDate);
  firstSlotTime.setUTCHours(startHour + Math.random() * 2);

  for (let i = 0; i < headlines.length && i < 12; i++) {
    const headline = headlines[i];
    const slotIndex = Math.floor(i / slotsPerDay);
    const slotTime = new Date(firstSlotTime);
    slotTime.setUTCHours(
      startHour + (slotIndex % hours) + Math.random() * 0.5
    );

    const tweetText = headline.title.substring(0, 250);
    const trendScore = Math.floor(Math.random() * 100);

    slots.push({
      time: slotTime.toISOString(),
      content: tweetText,
      title: headline.title,
      trendScore,
    });
  }

  return slots;
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

    const { reportId } = await request.json();

    if (!reportId) {
      return NextResponse.json(
        { error: 'reportId is required' },
        { status: 400 }
      );
    }

    // Fetch the report
    const reportResponse = await fetch(`/api/reports`).then(r => r.json()).catch(() => []);
    const row = Array.isArray(reportResponse)
      ? reportResponse.find((r: any) => r.id === reportId)
      : null;

    if (!row) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }

    const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
    const reportType: string = row.type;
    const targetDay = REPORT_DAY_MAP[reportType] ?? 1;
    const nextDate = getNextWeekday(targetDay);

    const items: any[] = [];

    // Tweets (7am–7pm EST)
    if (content.headlines?.length) {
      const slots = calculateTweetSlots(nextDate, content.headlines);
      for (const s of slots) {
        items.push({
          type: 'tweet',
          time: s.time,
          content: s.content,
          title: s.title,
          trendScore: s.trendScore,
          enabled: true,
        });
      }
    }

    // Instagram reminder (9am EST = 14:00 UTC)
    const instaTime = new Date(nextDate.getTime() + 4 * 60 * 60 * 1000);
    items.push({
      type: 'instagram',
      time: instaTime.toISOString(),
      content: 'Post your 21-slide Instagram carousel for today\'s report.',
      enabled: true,
    });

    // Substack reminder (next Monday 9am EST)
    const nextMonday = getNextWeekday(1);
    const substackTime = new Date(nextMonday.getTime() + 4 * 60 * 60 * 1000);
    items.push({
      type: 'substack',
      time: substackTime.toISOString(),
      content: 'Publish your Substack article for this week\'s intelligence brief.',
      enabled: true,
    });

    // Sort chronologically
    items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return NextResponse.json({
      reportType,
      nextDate: nextDate.toISOString(),
      items,
    });
  } catch (error) {
    console.error('[API] Error in POST /api/auto-schedule/preview:', error);
    return NextResponse.json(
      { error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}
