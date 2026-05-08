import { createServerSupabase } from '@/lib/supabase';
import { CHOKEPOINT_ORDER } from '@/lib/chokepoints';
import { detectFlowAnomalies } from './anomaly';
import { synthesize, statusForChokepoint } from './synthesis';
import type { ChokepointId } from '@/types';

export interface AgentRunResult {
  agent_run_id: string;
  anomaly_count: number;
  status_writes: number;
  synthesis_md: string;
}

export async function runChokepointAgent(): Promise<AgentRunResult> {
  const sb = createServerSupabase();

  const anomalies = await detectFlowAnomalies();
  const { synthesis_md, model_used, tokens_in, tokens_out } = synthesize(anomalies);

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

  const statusRows = CHOKEPOINT_ORDER.map((cpId: ChokepointId) => {
    const { status, signal } = statusForChokepoint(cpId, anomalies);
    return {
      chokepoint_id: cpId,
      status,
      headline_signal: signal,
      flow_delta_pct: null,
      event_count_24h: 0,
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
    status_writes: statusRows.length,
    synthesis_md,
  };
}
