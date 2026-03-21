import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { displayName } = await request.json();
  if (!displayName?.trim()) return NextResponse.json({ error: 'Display name required' }, { status: 400 });
  const sanitized = displayName.trim().replace(/<[^>]*>/g, '').substring(0, 50);
  const db = createServerSupabase();
  await db.from('users').update({ display_name: sanitized }).eq('id', userId);
  return NextResponse.json({ success: true, displayName: sanitized });
}
