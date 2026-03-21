'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Wifi, WifiOff, Zap, Clock, AlertTriangle, CheckCircle2, XCircle, Activity } from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface RateLimit {
  used: number | null;
  max: number | null;
  window: string;
}

interface ServiceLimits {
  label: string;
  tier: string;
  requests?: RateLimit;
  tokens?: RateLimit;
  notes?: string;
}

interface ServiceStatus {
  name: string;
  category: 'ai' | 'data' | 'infra' | 'social';
  connected: boolean;
  latencyMs: number | null;
  error: string | null;
  limits: ServiceLimits | null;
}

interface UsageData {
  services: ServiceStatus[];
  summary: { total: number; connected: number; disconnected: number; avgLatencyMs: number };
  checkedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI Providers',
  data: 'Market Data',
  infra: 'Infrastructure',
  social: 'Social Platforms',
};

const CATEGORY_ORDER = ['ai', 'data', 'infra', 'social'];

function pct(used: number | null, max: number | null): number | null {
  if (used === null || max === null || max === 0) return null;
  return Math.min(100, Math.round((used / max) * 100));
}

function barColor(p: number): string {
  if (p < 50) return 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]';
  if (p < 80) return 'bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]';
  return 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]';
}

function barTextColor(p: number): string {
  if (p < 50) return 'text-green-400';
  if (p < 80) return 'text-yellow-400';
  return 'text-red-400';
}

function formatNum(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Sub-components ───────────────────────────────────────────────────────────

function LimitBar({ label, used, max, window }: { label: string } & RateLimit) {
  const p = pct(used, max);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
        <span className="text-gray-500 uppercase tracking-wider">{label}</span>
        <span className={p !== null ? barTextColor(p) : 'text-gray-500'}>
          {formatNum(used)} / {formatNum(max)} <span className="text-gray-600">{window}</span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        {p !== null ? (
          <div className={`h-full rounded-full transition-all duration-700 ${barColor(p)}`} style={{ width: `${p}%` }} />
        ) : (
          <div className="h-full w-full bg-gray-700/40 animate-pulse rounded-full" />
        )}
      </div>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  const latency = service.latencyMs;
  const latencyColor = latency === null ? 'text-gray-600' : latency < 300 ? 'text-green-400' : latency < 1000 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className={`border rounded-lg p-4 transition-all ${
      service.connected
        ? 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
        : 'border-red-900/50 bg-red-950/20 hover:border-red-800/50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {service.connected ? (
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
          )}
          <span className="text-sm font-mono text-gray-200">{service.name}</span>
        </div>
        {latency !== null && (
          <span className={`text-[10px] font-mono ${latencyColor}`}>
            {latency}ms
          </span>
        )}
      </div>

      {/* Status line */}
      {service.error && !service.connected && (
        <div className="flex items-center gap-1.5 mb-2">
          <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
          <span className="text-[10px] font-mono text-red-400 truncate">{service.error}</span>
        </div>
      )}

      {/* Tier badge */}
      {service.limits && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              {service.limits.tier}
            </span>
            <span className="text-[10px] font-mono text-gray-600">{service.limits.label}</span>
          </div>

          {/* Rate limit bars */}
          {service.limits.requests && (
            <LimitBar label="Requests" {...service.limits.requests} />
          )}
          {service.limits.tokens && (
            <LimitBar label="Tokens" {...service.limits.tokens} />
          )}

          {/* Notes */}
          {service.limits.notes && (
            <p className="text-[10px] font-mono text-gray-600 mt-2 leading-relaxed">
              {service.limits.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function Usage({ user }: { user: any }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/usage');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group services by category
  const grouped = data ? CATEGORY_ORDER.reduce<Record<string, ServiceStatus[]>>((acc, cat) => {
    const items = data.services.filter(s => s.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {}) : {};

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-mono text-gray-200 tracking-tight flex items-center gap-2">
            <Activity className="w-4 h-4 text-btc-orange" />
            System Usage
          </h1>
          {data && (
            <p className="text-[10px] font-mono text-gray-600 mt-1">
              Last checked {new Date(data.checkedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-800 bg-gray-900 text-[10px] font-mono text-gray-400 hover:text-btc-orange hover:border-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {/* Summary bar */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Services</div>
            <div className="text-xl font-mono text-gray-200 mt-1">{data.summary.total}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-500" /> Connected
            </div>
            <div className="text-xl font-mono text-green-400 mt-1">{data.summary.connected}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <XCircle className="w-3 h-3 text-red-500" /> Disconnected
            </div>
            <div className="text-xl font-mono text-red-400 mt-1">{data.summary.disconnected}</div>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
            <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider flex items-center gap-1">
              <Zap className="w-3 h-3 text-yellow-500" /> Avg Latency
            </div>
            <div className="text-xl font-mono text-yellow-400 mt-1">{data.summary.avgLatencyMs}ms</div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="border border-red-900/50 rounded-lg p-4 bg-red-950/20 mb-6 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm font-mono text-red-400">{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-3">
              <div className="h-4 w-32 bg-gray-800 rounded animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map(j => (
                  <div key={j} className="h-32 bg-gray-900/60 border border-gray-800 rounded-lg animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Service groups */}
      {data && Object.entries(grouped).map(([cat, services]) => (
        <div key={cat} className="mb-6">
          <h2 className="text-[11px] font-mono text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span className="h-px flex-1 bg-gray-800" />
            {CATEGORY_LABELS[cat] ?? cat}
            <span className="h-px flex-1 bg-gray-800" />
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map(s => <ServiceCard key={s.name} service={s} />)}
          </div>
        </div>
      ))}

      {/* Provider fallback chain */}
      {data && (
        <div className="mt-8 border border-gray-800 rounded-lg p-4 bg-gray-900/60">
          <h2 className="text-[11px] font-mono text-gray-500 uppercase tracking-widest mb-3">
            AI Provider Fallback Chain
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {['Claude (Primary)', 'Gemini (Fallback)', 'GPT-4o (Fallback)'].map((name, i) => {
              const svc = data.services.find(s =>
                i === 0 ? s.name.includes('Anthropic') :
                i === 1 ? s.name.includes('Gemini') :
                s.name.includes('OpenAI')
              );
              const connected = svc?.connected ?? false;
              return (
                <React.Fragment key={name}>
                  {i > 0 && <span className="text-gray-700 font-mono text-xs">&rarr;</span>}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] font-mono ${
                    connected
                      ? 'border-green-900/50 bg-green-950/20 text-green-400'
                      : 'border-red-900/50 bg-red-950/20 text-red-400'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                    {name}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <p className="text-[10px] font-mono text-gray-600 mt-2">
            Reports use Claude first. If rate-limited or unavailable, falls back to Gemini, then GPT-4o.
            Max output: 16,000 tokens per report.
          </p>
        </div>
      )}

      {/* Vercel limits info */}
      {data && (
        <div className="mt-4 border border-gray-800 rounded-lg p-4 bg-gray-900/60">
          <h2 className="text-[11px] font-mono text-gray-500 uppercase tracking-widest mb-3">
            Vercel Function Limits
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Execution Timeout', value: '60s', sub: 'Hobby / 300s Pro' },
              { label: 'Payload Size', value: '4.5MB', sub: 'Request body limit' },
              { label: 'Concurrent', value: '1000', sub: 'Pro tier' },
              { label: 'Cron Jobs', value: '1 active', sub: 'Every 5 minutes' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">{item.label}</div>
                <div className="text-sm font-mono text-btc-orange mt-1">{item.value}</div>
                <div className="text-[9px] font-mono text-gray-700">{item.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
