import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tradingview/session — Check TV session status
 * POST /api/tradingview/session — Update TV session ID at runtime
 */

export async function GET() {
  try {
    await safeAuth();
    const { getConnectionStatus, getSessionId, isSessionValid } = await import('@/lib/tradingviewWS');
    const status = getConnectionStatus();
    return NextResponse.json({
      hasSession: status.hasSession,
      sessionValid: status.sessionValid,
      authenticated: status.authenticated,
      connected: status.connected,
      needsReauth: !isSessionValid(),
      symbols: status.symbols,
      cached: status.cached,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to check session' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await safeAuth();
    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) {
      return NextResponse.json({ error: 'Invalid session ID. Must be the "sessionid" cookie from tradingview.com.' }, { status: 400 });
    }

    // Sanitize — only allow alphanumeric chars (TV session IDs are hex-like strings)
    const cleaned = sessionId.trim().replace(/[^a-zA-Z0-9]/g, '');
    if (cleaned.length < 10) {
      return NextResponse.json({ error: 'Session ID too short after sanitization' }, { status: 400 });
    }

    const { setSessionId, getConnectionStatus } = await import('@/lib/tradingviewWS');
    setSessionId(cleaned);

    // Give WS a moment to reconnect
    await new Promise(resolve => setTimeout(resolve, 2000));
    const status = getConnectionStatus();

    return NextResponse.json({
      success: true,
      message: 'Session ID updated. WebSocket reconnecting with new credentials.',
      authenticated: status.authenticated,
      connected: status.connected,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
