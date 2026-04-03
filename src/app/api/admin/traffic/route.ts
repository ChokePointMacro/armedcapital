import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { logAuditEvent } from '@/lib/agentBus';

export const dynamic = 'force-dynamic';

// ── Traffic & Device Tracking API ───────────────────────────────────────────
// Tracks connected devices/sessions, identifies users by Clerk session,
// fingerprints devices by UA/IP/screen, and labels known vs unknown visitors.

interface DeviceSession {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  browser: string;
  os: string;
  ip: string;
  city: string | null;
  country: string | null;
  screenRes: string | null;
  fingerprint: string;
  currentPage: string;
  firstSeen: string;
  lastSeen: string;
  pageViews: number;
  isKnownUser: boolean;
  isSuspicious: boolean;
  tags: string[];
}

// In-memory session store
const sessions: Map<string, DeviceSession> = new Map();

function parseUserAgent(ua: string): { deviceType: DeviceSession['deviceType']; browser: string; os: string } {
  const lowerUA = ua.toLowerCase();

  // Device type
  let deviceType: DeviceSession['deviceType'] = 'desktop';
  if (/bot|crawl|spider|slurp|googlebot|bingbot/i.test(lowerUA)) deviceType = 'bot';
  else if (/iphone|android.*mobile|windows phone/i.test(lowerUA)) deviceType = 'mobile';
  else if (/ipad|android(?!.*mobile)|tablet/i.test(lowerUA)) deviceType = 'tablet';

  // Browser
  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';
  else if (/opera|opr\//i.test(ua)) browser = 'Opera';

  // OS
  let os = 'Unknown';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  return { deviceType, browser, os };
}

function generateFingerprint(ua: string, ip: string, screenRes: string | null): string {
  const raw = `${ua}|${ip}|${screenRes || 'unknown'}`;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, '0');
}

// POST: Record a page view / heartbeat
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, userId, userName, userEmail, page, screenRes } = body;

    const ua = req.headers.get('user-agent') || 'Unknown';
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               req.headers.get('x-real-ip') || '0.0.0.0';

    const { deviceType, browser, os } = parseUserAgent(ua);
    const fingerprint = generateFingerprint(ua, ip, screenRes);
    const sid = sessionId || fingerprint;

    const existing = sessions.get(sid);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      existing.currentPage = page || existing.currentPage;
      existing.pageViews++;
      if (userId && !existing.userId) {
        existing.userId = userId;
        existing.userName = userName;
        existing.userEmail = userEmail;
        existing.isKnownUser = true;
      }
    } else {
      const isKnown = !!userId;
      const session: DeviceSession = {
        id: sid,
        userId: userId || null,
        userName: userName || null,
        userEmail: userEmail || null,
        deviceType,
        browser,
        os,
        ip,
        city: null,       // Could enhance with IP geolocation
        country: null,
        screenRes: screenRes || null,
        fingerprint,
        currentPage: page || '/',
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        pageViews: 1,
        isKnownUser: isKnown,
        isSuspicious: deviceType === 'bot' || !isKnown,
        tags: [
          deviceType,
          browser.toLowerCase(),
          os.toLowerCase(),
          isKnown ? 'authenticated' : 'anonymous',
          ...(deviceType === 'bot' ? ['bot'] : []),
        ],
      };
      sessions.set(sid, session);

      // Log new visitor
      await logAuditEvent({
        type: 'bus_message',
        agentId: 'traffic-tracker',
        action: `New ${deviceType} visitor: ${isKnown ? userName || userEmail : 'Anonymous'} (${browser}/${os})`,
        details: { fingerprint, ip, deviceType, browser, os },
      });
    }

    return NextResponse.json({ ok: true, sessionId: sid });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET: List active sessions and traffic stats
export async function GET() {
  try {
    await safeAuth();

    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const allSessions = Array.from(sessions.values());
    const active = allSessions.filter(s => new Date(s.lastSeen).getTime() > fiveMinAgo);
    const recentHour = allSessions.filter(s => new Date(s.lastSeen).getTime() > hourAgo);
    const today = allSessions.filter(s => new Date(s.firstSeen).getTime() > dayAgo);

    // Device breakdown
    const deviceBreakdown: Record<string, number> = {};
    const browserBreakdown: Record<string, number> = {};
    const osBreakdown: Record<string, number> = {};

    for (const s of today) {
      deviceBreakdown[s.deviceType] = (deviceBreakdown[s.deviceType] || 0) + 1;
      browserBreakdown[s.browser] = (browserBreakdown[s.browser] || 0) + 1;
      osBreakdown[s.os] = (osBreakdown[s.os] || 0) + 1;
    }

    return NextResponse.json({
      live: {
        activeNow: active.length,
        lastHour: recentHour.length,
        today: today.length,
        totalTracked: allSessions.length,
      },
      sessions: allSessions
        .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
        .slice(0, 100),
      breakdown: {
        device: deviceBreakdown,
        browser: browserBreakdown,
        os: osBreakdown,
      },
      knownUsers: allSessions.filter(s => s.isKnownUser).length,
      anonymousVisitors: allSessions.filter(s => !s.isKnownUser).length,
      suspiciousCount: allSessions.filter(s => s.isSuspicious).length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
