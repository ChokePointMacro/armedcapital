import { createServerSupabase } from './supabase';
import type {
  Chokepoint,
  ChokepointId,
  ChokepointAgentRun,
  ChokepointDataSource,
  ChokepointSignal,
  Country,
  DataSourceType,
  ProducerTier,
  SignalSeverity,
  StatusPill,
} from '@/types';

export type ChokepointWithStatus = Chokepoint & {
  latest_status: StatusPill;
  last_updated: string | null;
  headline_signal: string | null;
  data_source_count: number;
  recent_signal_count: number;
};

// "unknown" — what we show when we have no current signal. Honest.
// Replaces the silent default-green that made all 7 pills look "all clear"
// when in reality the agent had nothing to look at.
const UNKNOWN_STATUS: StatusPill = 'unknown';
const STALENESS_THRESHOLD_HOURS = 36;

export const CHOKEPOINT_ORDER: ChokepointId[] = [
  'hormuz',
  'bab_el_mandeb',
  'suez',
  'bosporus',
  'malacca',
  'panama',
  'cape_of_good_hope',
];

export function sortChokepoints<T extends { id: string }>(items: T[]): T[] {
  const order: Record<string, number> = {};
  CHOKEPOINT_ORDER.forEach((id, i) => { order[id] = i; });
  return [...items].sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));
}

function isStale(ts: string | null | undefined): boolean {
  if (!ts) return true;
  const ageHours = (Date.now() - new Date(ts).getTime()) / 3_600_000;
  return ageHours > STALENESS_THRESHOLD_HOURS;
}

export async function getChokepoints(): Promise<Chokepoint[]> {
  const sb = createServerSupabase();
  const { data, error } = await sb.from('chokepoints').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Chokepoint[];
}

export async function getChokepointsWithStatus(): Promise<ChokepointWithStatus[]> {
  const sb = createServerSupabase();

  const [
    { data: chokepoints, error: cpErr },
    { data: statuses,    error: stErr },
    { data: latestRun,   error: rnErr },
    { data: sources,     error: dsErr },
    { data: signals,     error: sgErr },
  ] = await Promise.all([
    sb.from('chokepoints').select('*').order('name'),
    sb.from('chokepoint_status')
      .select('chokepoint_id, status, ts, headline_signal')
      .order('ts', { ascending: false }),
    sb.from('chokepoint_agent_runs')
      .select('ts')
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('chokepoint_data_sources').select('chokepoint_id, enabled'),
    sb.from('chokepoint_signals')
      .select('chokepoint_id')
      .gte('ts', new Date(Date.now() - 24 * 3_600_000).toISOString()),
  ]);

  if (cpErr) throw new Error(cpErr.message);
  if (stErr) throw new Error(stErr.message);
  if (rnErr) throw new Error(rnErr.message);
  if (dsErr) throw new Error(dsErr.message);
  if (sgErr) throw new Error(sgErr.message);

  const agentStale = isStale((latestRun as { ts?: string } | null)?.ts ?? null);

  const latestByCp = new Map<string, { status: StatusPill; ts: string; headline: string | null }>();
  for (const row of statuses ?? []) {
    if (!latestByCp.has(row.chokepoint_id)) {
      latestByCp.set(row.chokepoint_id, {
        status: row.status as StatusPill,
        ts: row.ts,
        headline: row.headline_signal,
      });
    }
  }

  const sourceCountByCp: Record<string, number> = {};
  for (const s of sources ?? []) {
    if (s.enabled) sourceCountByCp[s.chokepoint_id] = (sourceCountByCp[s.chokepoint_id] ?? 0) + 1;
  }
  const signalCountByCp: Record<string, number> = {};
  for (const s of signals ?? []) {
    signalCountByCp[s.chokepoint_id] = (signalCountByCp[s.chokepoint_id] ?? 0) + 1;
  }

  return (chokepoints ?? []).map((cp) => {
    const latest = latestByCp.get(cp.id);
    const rowStale = isStale(latest?.ts ?? null);
    // Show 'unknown' if the agent itself hasn't run recently OR this chokepoint
    // has no recent status row. Stored statuses pass through only when fresh.
    const status: StatusPill =
      agentStale || rowStale || !latest ? UNKNOWN_STATUS : latest.status;

    return {
      ...(cp as Chokepoint),
      latest_status: status,
      last_updated: latest?.ts ?? null,
      headline_signal: latest?.headline ?? null,
      data_source_count: sourceCountByCp[cp.id] ?? 0,
      recent_signal_count: signalCountByCp[cp.id] ?? 0,
    };
  });
}

export async function getProducerCountries(opts?: {
  tier?: ProducerTier;
  product?: 'oil' | 'lng';
}): Promise<Country[]> {
  const sb = createServerSupabase();
  const product = opts?.product ?? 'oil';
  const column = product === 'oil' ? 'oil_producer_tier' : 'lng_producer_tier';

  let query = sb.from('countries').select('*').not(column, 'is', null);
  if (opts?.tier) query = query.eq(column, opts.tier);

  const { data, error } = await query.order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Country[];
}

export async function getLatestAgentRun(): Promise<ChokepointAgentRun | null> {
  const sb = createServerSupabase();
  const { data, error } = await sb
    .from('chokepoint_agent_runs')
    .select('*')
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ChokepointAgentRun | null) ?? null;
}

// Data sources

export async function getDataSourcesForChokepoint(chokepointId: ChokepointId): Promise<ChokepointDataSource[]> {
  const sb = createServerSupabase();
  const { data, error } = await sb
    .from('chokepoint_data_sources')
    .select('*')
    .eq('chokepoint_id', chokepointId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChokepointDataSource[];
}

export async function createDataSource(input: {
  chokepoint_id: ChokepointId;
  type: DataSourceType;
  name: string;
  url?: string | null;
  config?: Record<string, unknown>;
}): Promise<ChokepointDataSource> {
  const sb = createServerSupabase();
  const { data, error } = await sb
    .from('chokepoint_data_sources')
    .insert({
      chokepoint_id: input.chokepoint_id,
      type: input.type,
      name: input.name,
      url: input.url ?? null,
      config: input.config ?? {},
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ChokepointDataSource;
}

export async function updateDataSource(
  id: string,
  patch: Partial<{ enabled: boolean; name: string; url: string | null; config: Record<string, unknown> }>,
): Promise<void> {
  const sb = createServerSupabase();
  const { error } = await sb
    .from('chokepoint_data_sources')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteDataSource(id: string): Promise<void> {
  const sb = createServerSupabase();
  const { error } = await sb.from('chokepoint_data_sources').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Signals

export async function getRecentSignalsForChokepoint(
  chokepointId: ChokepointId,
  hoursBack = 168,
): Promise<ChokepointSignal[]> {
  const sb = createServerSupabase();
  const since = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
  const { data, error } = await sb
    .from('chokepoint_signals')
    .select('*')
    .eq('chokepoint_id', chokepointId)
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChokepointSignal[];
}

export async function insertManualSignal(input: {
  chokepoint_id: ChokepointId;
  data_source_id?: string | null;
  severity: SignalSeverity;
  headline: string;
  url?: string | null;
  body?: string | null;
}): Promise<ChokepointSignal> {
  const sb = createServerSupabase();
  const { data, error } = await sb
    .from('chokepoint_signals')
    .insert({
      chokepoint_id: input.chokepoint_id,
      data_source_id: input.data_source_id ?? null,
      severity: input.severity,
      headline: input.headline,
      url: input.url ?? null,
      body: input.body ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ChokepointSignal;
}
