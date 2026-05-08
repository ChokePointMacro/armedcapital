import { createServerSupabase } from '@/lib/supabase';
import { CHOKEPOINT_ORDER } from '@/lib/chokepoints';
import { detectFlowAnomalies } from './anomaly';
import { synthesize, statusForChokepoint } from './synthesis';
import type { ChokepointId, ChokepointSignal } from '@/types';

export interface AgentRunResult {
  agent_run_id: string;
  anomaly_count: number;
  signal_count: number;
  status_writes: number;
  synthesis_md: string;
}

export async function runChokepointAgent(): Promise<AgentRunResult> {
  const sb = createServerSupabase();

  // 1. Flow anomalies (z-score against 12mo baseline)
  const anomalies = await detectFlowAnomalies();

  // 2. Recent signals (last 24h) from connected data sources, grouped per chokepoint.
  // Fail-soft: if the chokepoint_signals table doesn't exist yet (operator
  // hasn't run the delta SQL), proceed with an empty signal set rather than
  // breaking the whole agent run.
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const sigQuery = await sb
    .from('chokepoint_signals')
    .select('*')
    .gte('ts', since)
    .order('ts', { ascending: false })
    .then((r) => r, () => ({ data: null, error: { message: 'chokepoint_signals unavailable' } } as const));

  const signalsByCp: Record<string, ChokepointSignal[]> = {};
  for (const s of (sigQuery.data ?? []) as ChokepointSignal[]) {
    (signalsByCp[s.chokepoint_id] ??= []).push(s);
  }
  const totalSignals = (sigQuery.data ?? []).length;

  // 3. Synthesize (deterministic stub for now)
  const { synthesis_md, model_used, tokens_in, tokens_out } = synthesize(anomalies, signalsByCp);

  // 4. Persist agent_run row
  const { data: runRow, error: runErr } = await sb
    .from('chokepoint_agent_runs')
    .insert({
      baseline_window: '12mo',
      anomalies_detected: anomalies,
      synthesis_md,
      model_used,
      tokens_in,
      tokens_out,
    })
    .select('id, ts')
    .single();

  if (runErr || !runRow) {
    throw new Error(`chokepoint_agent_runs insert failed: ${runErr?.message ?? 'no row returned'}`);
  }

  // 5. Per-chokepoint status row, factoring in both anomalies and signals.
  const statusRows = CHOKEPOINT_ORDER.map((cpId: ChokepointId) => {
    const cpSignals = signalsByCp[cpId] ?? [];
    const { status, signal } = statusForChokepoint(cpId, anomalies, cpSignals);
    return {
      chokepoint_id: cpId,
      status,
      headline_signal: signal,
      flow_delta_pct: null,
      event_count_24h: cpSignals.length,
      sanctions_delta_24h: 0,
      agent_run_id: runRow.id,
    };
  });

  const { error: statusErr } = await sb.from('chokepoint_status').insert(statusRows);
  if (statusErr) {
    throw new Error(`chokepoint_status insert failed: ${statusErr.message}`);
  }

  return {
    agent_run_id: runRow.id,
    anomaly_count: anomalies.length,
    signal_count: totalSignals,
    status_writes: statusRows.length,
    synthesis_md,
  };
}
