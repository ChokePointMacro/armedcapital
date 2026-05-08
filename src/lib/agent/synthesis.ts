import type { AgentAnomaly, ChokepointId, ChokepointSignal, StoredStatus } from '@/types';

// Deterministic stub synthesis. Phase 4 swaps this for a call to
// src/services/aiService.ts → generateReportWithFallback() with the
// existing Claude/Gemini/GPT fallback chain.

export interface SynthesisResult {
  synthesis_md: string;
  model_used: string;
  tokens_in: number;
  tokens_out: number;
}

const CHOKEPOINT_NAMES: Record<ChokepointId, string> = {
  hormuz: 'Strait of Hormuz',
  bab_el_mandeb: 'Bab el-Mandeb',
  malacca: 'Strait of Malacca',
  suez: 'Suez Canal',
  bosporus: 'Bosporus',
  panama: 'Panama Canal',
  cape_of_good_hope: 'Cape of Good Hope',
};

export function synthesize(
  anomalies: AgentAnomaly[],
  signalsByChokepoint: Record<string, ChokepointSignal[]> = {},
): SynthesisResult {
  const totalSignals = Object.values(signalsByChokepoint).reduce((n, arr) => n + arr.length, 0);

  if (anomalies.length === 0 && totalSignals === 0) {
    return {
      synthesis_md:
        'No flow anomalies detected against the 90-day baseline and no recent signals from connected data sources. ' +
        'All seven monitored chokepoints are within structural norms. ' +
        '_Tension Agent stub — Phase 4 swaps in aiService.generateReportWithFallback._',
      model_used: 'stub-deterministic',
      tokens_in: 0,
      tokens_out: 0,
    };
  }

  const byChokepoint = new Map<string, AgentAnomaly[]>();
  for (const a of anomalies) {
    const key = a.chokepoint_id ?? 'unmapped';
    if (!byChokepoint.has(key)) byChokepoint.set(key, []);
    byChokepoint.get(key)!.push(a);
  }

  const high   = anomalies.filter((a) => a.severity === 'high').length;
  const medium = anomalies.filter((a) => a.severity === 'medium').length;

  const parts: string[] = [];
  if (anomalies.length > 0) {
    parts.push(`**${anomalies.length} flow anomal${anomalies.length === 1 ? 'y' : 'ies'} detected** against the 90-day baseline (${high} high, ${medium} medium severity).`);
  }
  if (totalSignals > 0) {
    parts.push(`**${totalSignals} recent signal${totalSignals === 1 ? '' : 's'}** from connected data sources in the last 24h.`);
  }

  for (const [cp, items] of Array.from(byChokepoint.entries())) {
    const label = cp === 'unmapped' ? 'Unmapped origins' : CHOKEPOINT_NAMES[cp as ChokepointId] ?? cp;
    parts.push(`\n**${label}** — ${items.length} flow signal${items.length === 1 ? '' : 's'}:`);
    for (const a of items.slice(0, 3)) parts.push(`- ${a.summary}`);
    if (items.length > 3) parts.push(`- _…and ${items.length - 3} more_`);
  }

  for (const [cpId, sigs] of Object.entries(signalsByChokepoint)) {
    if (sigs.length === 0) continue;
    const label = CHOKEPOINT_NAMES[cpId as ChokepointId] ?? cpId;
    parts.push(`\n**${label}** — ${sigs.length} data-source signal${sigs.length === 1 ? '' : 's'}:`);
    for (const s of sigs.slice(0, 3)) parts.push(`- [${s.severity.toUpperCase()}] ${s.headline}`);
    if (sigs.length > 3) parts.push(`- _…and ${sigs.length - 3} more_`);
  }

  parts.push('\n_Tension Agent stub — Phase 4 swaps in aiService.generateReportWithFallback._');

  return {
    synthesis_md: parts.join('\n'),
    model_used: 'stub-deterministic',
    tokens_in: 0,
    tokens_out: 0,
  };
}

// Per-chokepoint pill rule:
//   - any 'high' (anomaly OR signal) → red
//   - 3+ flow anomalies → red
//   - any 'medium' OR 1-2 anomalies OR 1+ low-severity signal → yellow
//   - nothing → green
//
// Returns only stored states; the read-time UI maps "no row at all" to 'unknown'.
export function statusForChokepoint(
  cpId: ChokepointId,
  anomalies: AgentAnomaly[],
  signals: ChokepointSignal[] = [],
): { status: StoredStatus; signal: string | null } {
  const relevantAnoms = anomalies.filter((a) => a.chokepoint_id === cpId);

  const hasHigh =
    relevantAnoms.some((a) => a.severity === 'high') ||
    signals.some((s) => s.severity === 'high');
  if (hasHigh) {
    const summary =
      signals.find((s) => s.severity === 'high')?.headline ??
      relevantAnoms[0]?.summary ??
      null;
    return { status: 'red', signal: summary };
  }

  if (relevantAnoms.length >= 3) {
    return { status: 'red', signal: relevantAnoms[0].summary };
  }

  const hasMedium =
    relevantAnoms.some((a) => a.severity === 'medium') ||
    signals.some((s) => s.severity === 'medium');
  if (hasMedium || relevantAnoms.length > 0 || signals.length > 0) {
    const summary =
      signals.find((s) => s.severity === 'medium')?.headline ??
      relevantAnoms[0]?.summary ??
      signals[0]?.headline ??
      null;
    return { status: 'yellow', signal: summary };
  }

  return { status: 'green', signal: null };
}
