import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

const PLATFORM_KEYS: Record<string, string[]> = {
  x: ['client_id', 'client_secret'],
  instagram: ['app_id', 'app_secret'],
  linkedin: ['client_id', 'client_secret'],
  threads: ['app_id', 'app_secret'],
  tradingview: ['session_id'],
  yahoo: ['cookie', 'crumb'],
};

export async function POST(request: NextRequest, { params }: { params: { platform: string } }) {
  const userId = await safeAuth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { platform } = params;
  if (!PLATFORM_KEYS[platform]) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  const { credentials } = await request.json();
  if (!credentials || typeof credentials !== 'object') return NextResponse.json({ error: 'credentials object required' }, { status: 400 });

  const requiredKeys = PLATFORM_KEYS[platform];
  for (const key of requiredKeys) {
    if (!credentials[key]?.trim()) return NextResponse.json({ error: `Missing required field: ${key}` }, { status: 400 });
  }

  const db = createServerSupabase();
  for (const key of requiredKeys) {
    await db.from('platform_credentials').upsert({
      platform, key_name: key, key_value: credentials[key].trim(), updated_at: new Date().toISOString(),
    }, { onConflict: 'platform,key_name' });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { platform: string } }) {
  const userId = await safeAuth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { platform } = params;
  if (!PLATFORM_KEYS[platform]) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  const db = createServerSupabase();
  await db.from('platform_credentials').delete().eq('platform', platform);
  return NextResponse.json({ success: true });
}
