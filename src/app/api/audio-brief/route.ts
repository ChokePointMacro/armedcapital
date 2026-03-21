import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { createServerSupabase } from '@/lib/supabase';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  const userId = await safeAuth();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { reportId } = await request.json();
  const db = createServerSupabase();
  const { data: reportRow } = await db.from('reports').select('*').eq('id', reportId).single();
  if (!reportRow) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  try {
    const report = typeof reportRow.content === 'string' ? JSON.parse(reportRow.content) : reportRow.content;
    const headlineIntros = (report.headlines || []).slice(0, 5).map((h: any, i: number) => `Story ${i + 1}: ${h.title}.`).join(' ');
    const text = `Today's Intelligence Brief. ${report.analysis?.overallSummary || ''} Here are the top stories. ${headlineIntros}`.substring(0, 4096);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
    const mp3Response = await openai.audio.speech.create({ model: 'tts-1', voice: 'onyx', input: text });
    const buffer = Buffer.from(await mp3Response.arrayBuffer());

    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Disposition': `attachment; filename="brief-${reportId}.mp3"` },
    });
  } catch (error) {
    console.error('[API] Audio brief error:', error);
    return NextResponse.json({ error: 'Failed to generate audio brief' }, { status: 500 });
  }
}
