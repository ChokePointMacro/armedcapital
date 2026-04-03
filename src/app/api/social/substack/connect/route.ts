import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const userId = await safeAuth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { subdomain, email, password } = await request.json();
  if (!subdomain) return NextResponse.json({ error: 'Substack subdomain is required' }, { status: 400 });

  const cleanSubdomain = subdomain.replace(/^https?:\/\//, '').replace(/\.substack\.com\/?$/, '').trim();
  if (!cleanSubdomain) return NextResponse.json({ error: 'Invalid subdomain' }, { status: 400 });

  const db = createServerSupabase();
  const tokenData = JSON.stringify({ email: email || '', password: password || '' });
  await db.from('platform_tokens').upsert({
    user_id: userId,
    platform: 'substack',
    access_token: tokenData,
    handle: cleanSubdomain,
    person_urn: '',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,platform' });

  return NextResponse.json({ success: true, handle: cleanSubdomain });
}
