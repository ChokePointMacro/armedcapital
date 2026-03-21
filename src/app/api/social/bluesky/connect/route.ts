import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { identifier, appPassword } = await request.json();
  if (!identifier || !appPassword) return NextResponse.json({ error: 'identifier and appPassword required' }, { status: 400 });

  try {
    const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: appPassword }),
    });
    const sessionData = await sessionRes.json();
    if (!sessionRes.ok) throw new Error(sessionData.message || 'Invalid credentials');

    const db = createServerSupabase();
    await db.from('platform_tokens').upsert({
      user_id: userId,
      platform: 'bluesky',
      access_token: appPassword,
      handle: identifier,
      person_urn: sessionData.did || '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });

    return NextResponse.json({ success: true, handle: identifier });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bluesky connection failed' }, { status: 400 });
  }
}
