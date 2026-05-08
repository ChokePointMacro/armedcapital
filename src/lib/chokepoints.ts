import { createServerSupabase } from './supabase';
import type {
  Chokepoint,
  ChokepointId,
  ChokepointAgentRun,
  Country,
  ProducerTier,
  StatusPill,
} from '@/types';

export type ChokepointWithStatus = Chokepoint & {
  latest_status: StatusPill;
  last_updated: string | null;
  headline_signal: string | null;
};

const DEFAULT_STATUS: StatusPill = 'green';

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

export async function getChokepoints(): Promise<Chokepoint[]> {
  const sb = createServerSupabase();
  const { data, error } = await sb.from('chokepoints').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Chokepoint[];
}

export async function getChokepointsWithStatus(): Promise<ChokepointWithStatus[]> {
  const sb = createServerSupabase();

  const [{ data: chokepoints, error: cpErr }, { data: statuses, error: stErr }] =
    await Promise.all([
      sb.from('chokepoints').select('*').order('name'),
      sb.from('chokepoint_status')
        .select('chokepoint_id, status, ts, headline_signal')
        .order('ts', { ascending: false }),
    ]);

  if (cpErr) throw new Error(cpErr.message);
  if (stErr) throw new Error(stErr.message);

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

  return (chokepoints ?? []).map((cp) => {
    const latest = latestByCp.get(cp.id);
    return {
      ...(cp as Chokepoint),
      latest_status: latest?.status ?? DEFAULT_STATUS,
      last_updated: latest?.ts ?? null,
      headline_signal: latest?.headline ?? null,
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
