/**
 * TradingView Signal Buffer — shared module
 *
 * In-memory signal buffer that stores recent TradingView webhook signals.
 * Used by both the webhook receiver route and the enrichment layer.
 * Separated from the route file because Next.js App Router only allows
 * HTTP method exports (GET, POST, etc.) from route.ts files.
 */

export interface TradingViewSignal {
  ticker?: string;
  exchange?: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  time?: string;
  interval?: string;
  action?: string;
  strategy?: string;
  message?: string;
  price?: number;
  contracts?: number;
  position_size?: number;
  order_id?: string;
  plot_0?: number;
  plot_1?: number;
  plot_2?: number;
  plot_3?: number;
  plot_4?: number;
}

export interface BufferedSignal extends TradingViewSignal {
  received_at: string;
}

// ── In-Memory Signal Buffer ─────────────────────────────────────────────────

const SIGNAL_BUFFER_SIZE = 200;
const SIGNAL_BUFFER_TTL = 24 * 60 * 60 * 1000; // 24 hours

let signalBuffer: BufferedSignal[] = [];

/** Add a signal to the buffer */
export function pushSignal(signal: BufferedSignal): void {
  signalBuffer.push(signal);
  if (signalBuffer.length > SIGNAL_BUFFER_SIZE) {
    signalBuffer = signalBuffer.slice(-SIGNAL_BUFFER_SIZE);
  }
}

/** Get recent signals from the in-memory buffer */
export function getRecentSignals(limit = 50): BufferedSignal[] {
  const cutoff = Date.now() - SIGNAL_BUFFER_TTL;
  return signalBuffer
    .filter(s => new Date(s.received_at).getTime() > cutoff)
    .slice(-limit);
}

/** Get signals for a specific ticker */
export function getSignalsForTicker(ticker: string, limit = 10): BufferedSignal[] {
  return signalBuffer
    .filter(s => s.ticker?.toUpperCase() === ticker.toUpperCase())
    .slice(-limit);
}

/** Get latest signal per unique ticker */
export function getLatestSignalPerTicker(): Map<string, BufferedSignal> {
  const map = new Map<string, BufferedSignal>();
  for (const sig of signalBuffer) {
    if (sig.ticker) {
      map.set(sig.ticker.toUpperCase(), sig);
    }
  }
  return map;
}

/** Get current buffer size */
export function getBufferSize(): number {
  return signalBuffer.length;
}
