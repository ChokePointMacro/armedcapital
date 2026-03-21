import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { content, scheduledAt } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });
  if (!scheduledAt) return NextResponse.json({ error: 'scheduledAt required' }, { status: 400 });
  const db = createServerSupabase();
  const { error } = await db.from('scheduled_posts').insert({ user_id: userId, content, scheduled_at: scheduledAt });
  if (error) return NextResponse.json({ error: 'Failed to schedule post' }, { status: 500 });
  return NextResponse.json({ success: true });
}
