import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest, { params }: { params: { platform: string } }) {
  const userId = await safeAuth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { platform } = params;
  const db = createServerSupabase();
  const { data } = await db.from('platform_credentials').select('*').eq('platform', platform);
  if (!data?.length) return NextResponse.json({ ok: false, error: 'Credentials not saved' });
  return NextResponse.json({ ok: true });
}
