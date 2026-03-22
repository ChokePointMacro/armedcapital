import { NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── SSE: Real-time Task Status Updates via Supabase Realtime ────────────────
// Subscribes to Supabase postgres_changes on agent_tasks table.
// Pushes task status changes to the frontend in real-time.

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId');
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ agentId: agentId || 'all' })}\n\n`));

      const supabase = createServerSupabase();

      // Subscribe to task changes via Supabase Realtime
      const channel = supabase
        .channel('task-updates')
        .on(
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'agent_tasks',
            ...(agentId ? { filter: `agent_id=eq.${agentId}` } : {}),
          },
          (payload: any) => {
            if (closed) return;
            try {
              const record = payload.new || payload.old;
              const event: any = {
                taskId: record?.id,
                agentId: record?.agent_id,
                status: record?.status,
                result_summary: record?.result_summary,
                result_content: record?.result_content,
                completed_at: record?.completed_at,
                changeType: payload.eventType,
                ts: Date.now(),
              };
              controller.enqueue(
                encoder.encode(`event: task_update\ndata: ${JSON.stringify(event)}\n\n`)
              );
            } catch { /* ignore */ }
          }
        )
        .subscribe();

      // Poll fallback: every 10s check for recent changes (in case Realtime isn't configured)
      const pollInterval = setInterval(async () => {
        if (closed) return;
        try {
          const since = new Date(Date.now() - 15000).toISOString();
          const query = supabase
            .from('agent_tasks')
            .select('id, agent_id, status, result_summary, completed_at, updated_at')
            .gte('updated_at', since)
            .order('updated_at', { ascending: false })
            .limit(10);

          if (agentId) query.eq('agent_id', agentId);
          const { data } = await query;

          if (data && data.length > 0) {
            for (const task of data) {
              const event = {
                taskId: task.id,
                agentId: task.agent_id,
                status: task.status,
                result_summary: task.result_summary,
                completed_at: task.completed_at,
                changeType: 'poll',
                ts: Date.now(),
              };
              controller.enqueue(
                encoder.encode(`event: task_update\ndata: ${JSON.stringify(event)}\n\n`)
              );
            }
          }
        } catch { /* ignore poll errors */ }
      }, 10000);

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
        } catch { /* closed */ }
      }, 30000);

      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(pollInterval);
        clearInterval(heartbeat);
        supabase.removeChannel(channel);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
