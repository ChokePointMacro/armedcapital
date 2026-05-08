import { createServerSupabase } from '@/lib/supabase';
import type { AgentAnomaly, ChokepointId, FlowProduct } from '@/types';

// Phase 1 anomaly detection — flow-based only.
// Compares the latest month per (origin, destination, product) tuple
// against the prior 12 months. Flags z-scores >= 2 sigma.
//
// Deferred to later phases:
//   - Vessel anomalies (Phase 3, AIS Worker → vessels_live)
//   - Geopolitical events (Phase 4, GDELT GKG → events_geopolitical)
//   - Sanctions deltas (Phase 4, OFAC daily diff → sanctions_ofac)

const SIGMA_THRESHOLD = 2;
const BASELINE_MONTHS = 12;

type FlowRow = {
  origin_iso3: string;
  destination_iso3: string;
  product: FlowProduct;
  month: string;
  volume_value: number;
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function severity(zScore: number): 'low' | 'medium' | 'high' {
  const abs = Math.abs(zScore);
  if (abs >= 3) return 'high';
  if (abs >= 2.5) return 'medium';
  return 'low';
}

// Best-effort heuristic mapping origin → likely chokepoint.
// Replaced when the routes table (Phase 2.5) is populated with
// LINESTRING geometries and chokepoints_traversed[] per OD pair.
function inferChokepoint(originIso3: string): ChokepointId | null {
  const map: Record<string, ChokepointId> = {
    SAU: 'hormuz', IRN: 'hormuz', IRQ: 'hormuz', KWT: 'hormuz',
    ARE: 'hormuz', QAT: 'hormuz',
    NGA: 'cape_of_good_hope',
    DZA: 'suez', LBY: 'suez', EGY: 'suez',
    AZE: 'bosporus', KAZ: 'bosporus',
    IDN: 'malacca', MYS: 'malacca', AUS: 'malacca',
    USA: 'panama', MEX: 'panama', VEN: 'panama',
  };
  return map[originIso3] ?? null;
}

export async function detectFlowAnomalies(): Promise<AgentAnomaly[]> {
  const sb = createServerSupabase();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - (BASELINE_MONTHS + 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from('flows_monthly')
    .select('origin_iso3, destination_iso3, product, month, volume_value')
    .gte('month', cutoffStr)
    .order('month', { ascending: false });

  if (error) throw new Error(`flow query failed: ${error.message}`);
  const rows = (data ?? []) as FlowRow[];
  if (rows.length === 0) return [];

  const groups = new Map<string, FlowRow[]>();
  for (const r of rows) {
    const key = `${r.origin_iso3}|${r.destination_iso3}|${r.product}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const anomalies: AgentAnomaly[] = [];

  for (const [key, group] of Array.from(groups.entries())) {
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => b.month.localeCompare(a.month));
    const latest = sorted[0];
    const baseline = sorted.slice(1);
    const mu = mean(baseline.map((r) => r.volume_value));
    const sigma = stddev(baseline.map((r) => r.volume_value));
    if (sigma === 0) continue;

    const z = (latest.volume_value - mu) / sigma;
    if (Math.abs(z) < SIGMA_THRESHOLD) continue;

    const direction = z > 0 ? 'above' : 'below';
    const pctDelta = mu === 0 ? 0 : ((latest.volume_value - mu) / mu) * 100;

    anomalies.push({
      type: 'flow',
      severity: severity(z),
      chokepoint_id: inferChokepoint(latest.origin_iso3),
      summary: `${latest.origin_iso3} → ${latest.destination_iso3} ${latest.product} ${direction} baseline by ${pctDelta.toFixed(1)}% (z=${z.toFixed(2)})`,
      details: {
        key,
        latest_month: latest.month,
        latest_value: latest.volume_value,
        baseline_mean: mu,
        baseline_stddev: sigma,
        z_score: z,
        pct_delta: pctDelta,
      },
    });
  }

  return anomalies;
}
