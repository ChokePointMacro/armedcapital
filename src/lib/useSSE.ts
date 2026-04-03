'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ── SSE Hook: Real-time Market Data ─────────────────────────────────────────
// Connects to /api/sse/markets and receives live quote pushes.
// Falls back to polling if SSE is unavailable.

interface SSEQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
}

interface SSEMarketData {
  ts: number;
  connected: boolean;
  authenticated: boolean;
  quotes: Record<string, SSEQuote>;
}

interface UseSSEMarketsOptions {
  symbols?: string[];
  interval?: number;
  enabled?: boolean;
}

export function useSSEMarkets(options: UseSSEMarketsOptions = {}) {
  const { symbols, interval = 2000, enabled = true } = options;
  const [data, setData] = useState<SSEMarketData | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const esRef = useRef<EventSource | null>(null);
  const retryCount = useRef(0);
  const maxRetries = 5;

  const connect = useCallback(() => {
    if (!enabled) return;
    if (esRef.current) {
      esRef.current.close();
    }

    setStatus('connecting');

    const params = new URLSearchParams();
    if (symbols?.length) params.set('symbols', symbols.join(','));
    if (interval) params.set('interval', String(interval));

    const url = `/api/sse/markets${params.toString() ? `?${params}` : ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('connected', () => {
      setStatus('connected');
      retryCount.current = 0;
    });

    es.addEventListener('quotes', (event) => {
      try {
        const parsed: SSEMarketData = JSON.parse(event.data);
        setData(parsed);
        setLastUpdate(parsed.ts);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('error', () => {
      setStatus('error');
    });

    es.onerror = () => {
      es.close();
      setStatus('disconnected');

      // Exponential backoff retry
      if (retryCount.current < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
        retryCount.current++;
        setTimeout(connect, delay);
      }
    };
  }, [enabled, symbols, interval]);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { data, status, lastUpdate, reconnect: connect, disconnect };
}

// ── SSE Hook: Task Status Updates ───────────────────────────────────────────
// Connects to /api/sse/tasks for real-time task status changes

interface TaskStatusEvent {
  taskId: string;
  agentId: string;
  status: string;
  result_summary?: string;
  result_content?: string;
  completed_at?: string;
  ts: number;
}

export function useSSETasks(agentId?: string) {
  const [lastEvent, setLastEvent] = useState<TaskStatusEvent | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const params = agentId ? `?agentId=${agentId}` : '';
    const es = new EventSource(`/api/sse/tasks${params}`);
    esRef.current = es;
    setStatus('connecting');

    es.addEventListener('connected', () => setStatus('connected'));

    es.addEventListener('task_update', (event) => {
      try {
        setLastEvent(JSON.parse(event.data));
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      setStatus('disconnected');
      es.close();
    };

    return () => {
      es.close();
      setStatus('disconnected');
    };
  }, [agentId]);

  return { lastEvent, status };
}
