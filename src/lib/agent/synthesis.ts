import type { AgentAnomaly, ChokepointId } from '@/types';

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

export function synthesize(anomalies: AgentAnomaly[]): SynthesisResult {
  if (anomalies.length === 0) {
    return {
      synthesis_md:
        'No flow anomalies detected against the 90-day baseline. ' +
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

  const high = anomalies.filter((a) => a.severity === 'high').length;
  const medium = anomalies.filter((a) => a.severity === 'medium').length;

  const parts: string[] = [];
  parts.push(`**${anomalies.length} flow anomal${anomalies.length === 1 ? 'y' : 'ies'} detected** against the 90-day baseline (${high} high, ${medium} medium severity).`);

  for (const [cp, items] of Array.from(byChokepoint.entries())) {
    const label = cp === 'unmapped' ? 'Unmapped origins' : CHOKEPOINT_NAMES[cp as ChokepointId] ?? cp;
    parts.push(`\n**${label}** — ${items.length} signal${items.length === 1 ? '' : 's'}:`);
    for (const a of items.slice(0, 3)) {
      parts.push(`- ${a.summary}`);
    }
    if (items.length > 3) parts.push(`- _…and ${items.length - 3} more_`);
  }

  parts.push('\n_Tension Agent stub — Phase 4 swaps in aiService.generateReportWithFallback._');

  return {
    synthesis_md: parts.join('\n'),
    model_used: 'stub-deterministic',
    tokens_in: 0,
    tokens_out: 0,
  };
}

// Per-chokepoint pill rule: 3+ anomalies or any 'high' → red,
// 1–2 → yellow, 0 → green.
export function statusForChokepoint(
  cpId: ChokepointId,
  anomalies: AgentAnomaly[],
): { status: 'green' | 'yellow' | 'red'; signal: string | null } {
  const relevant = anomalies.filter((a) => a.chokepoint_id === cpId);
  if (relevant.length === 0) return { status: 'green', signal: null };

  const hasHigh = relevant.some((a) => a.severity === 'high');
  if (hasHigh || relevant.length >= 3) {
    return { status: 'red', signal: relevant[0].summary };
  }
  return { status: 'yellow', signal: relevant[0].summary };
}
