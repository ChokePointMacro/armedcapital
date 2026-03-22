import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getNotifications, markNotificationRead, markAllRead, getUnreadCount } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

// ── Notifications API ───────────────────────────────────────────────────────
// GET: Fetch notifications
// POST: Mark read / mark all read

export async function GET(req: NextRequest) {
  try {
    await safeAuth();
    const unreadOnly = req.nextUrl.searchParams.get('unreadOnly') === '1';
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);

    return NextResponse.json({
      notifications: getNotifications({ unreadOnly, limit }),
      unreadCount: getUnreadCount(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const { action, notificationId } = await req.json();

    if (action === 'markRead' && notificationId) {
      markNotificationRead(notificationId);
      return NextResponse.json({ success: true });
    }

    if (action === 'markAllRead') {
      markAllRead();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
