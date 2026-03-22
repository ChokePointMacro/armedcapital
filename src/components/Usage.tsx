'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Loader2, Wifi, WifiOff, Zap, Clock, AlertTriangle, CheckCircle2, XCircle, Activity, ExternalLink, Star, DollarSign, TrendingUp, Database, Globe, Lock, Radio, Copy, Check, Send, Bell } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ApiKeyManager } from './ApiKeyManager';

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

interface ConsumptionData {
  reports: {
    total: number;
    today: number;
    thisWeek: number;
    byType: Record<string, number>;
  };
  posts: {
    total: number;
    posted: number;
    pending: number;
    failed: number;
    thisWeek: number;
  };
  scheduledReports: {
    active: number;
    total: number;
  };
  connectedPlatforms: string[];
}

interface UsageData {
  services: ServiceStatus[];
  summary: { total: number; connected: number; disconnected: number; avgLatencyMs: number };
  consumption?: ConsumptionData;
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

      {/* Platform Analytics */}
      {data && data.consumption && (
        <div className="mb-6">
          <h2 className="text-[11px] font-mono text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span className="h-px flex-1 bg-gray-800" />
            Platform Analytics
            <span className="h-px flex-1 bg-gray-800" />
          </h2>

          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Total Reports</div>
              <div className="text-xl font-mono text-btc-orange mt-1">{data.consumption.reports.total}</div>
              <div className="text-[9px] font-mono text-gray-700 mt-1">Today: {data.consumption.reports.today}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Posts Published</div>
              <div className="text-xl font-mono text-green-400 mt-1">{data.consumption.posts.posted}</div>
              <div className="text-[9px] font-mono text-gray-700 mt-1">Pending: {data.consumption.posts.pending}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Active Schedules</div>
              <div className="text-xl font-mono text-yellow-400 mt-1">{data.consumption.scheduledReports.active}</div>
              <div className="text-[9px] font-mono text-gray-700 mt-1">Total: {data.consumption.scheduledReports.total}</div>
            </div>
            <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Connected Platforms</div>
              <div className="text-xl font-mono text-purple-400 mt-1">{data.consumption.connectedPlatforms.length}</div>
              <div className="text-[9px] font-mono text-gray-700 mt-1 truncate">{data.consumption.connectedPlatforms.join(', ') || 'None'}</div>
            </div>
          </div>

          {/* Report breakdown by type */}
          {Object.keys(data.consumption.reports.byType).length > 0 && (
            <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/60 mb-4">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider mb-3">Report Types</div>
              <div className="space-y-2">
                {Object.entries(data.consumption.reports.byType).map(([type, count]) => {
                  const total = data.consumption!.reports.total;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  const COLOR_MAP: Record<string, string> = {
                    global: 'bg-blue-400',
                    crypto: 'bg-btc-orange',
                    equities: 'bg-green-400',
                    nasdaq: 'bg-purple-400',
                    conspiracies: 'bg-red-400',
                    forecast: 'bg-yellow-400',
                    custom: 'bg-teal-400',
                    china: 'bg-red-500',
                  };
                  const barColor = COLOR_MAP[type] || 'bg-gray-600';
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-gray-400 w-16">{type}</span>
                      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full ${barColor} shadow-[0_0_6px_rgba(0,0,0,0.4)]`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-gray-500 w-12 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* API Key Manager */}
      {data && (
        <div className="mt-6 border-t border-gray-800 pt-6">
          <ApiKeyManager />
        </div>
      )}

      {/* TradingView Webhook Setup */}
      {data && <WebhookWizard />}

      {/* Recommended Data Sources */}
      {data && <RecommendedSources />}
    </div>
  );
}

// ── TradingView Webhook Setup Wizard ─────────────────────────────────────────

const WEBHOOK_URL = 'https://armedcapital.vercel.app/api/webhooks/tradingview';

function WebhookWizard() {
  const [copied, setCopied] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PAYLOAD_TEMPLATE = `{"secret":"04a64a2412a07a673c3ceecf239d57769ec8f96a1222e752c83a6995e0723982","ticker":"{{ticker}}","exchange":"{{exchange}}","interval":"{{interval}}","price":{{close}},"volume":{{volume}},"action":"buy","time":"{{time}}"}`;

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* fallback */ }
  }, []);

  const sendTestSignal = useCallback(async () => {
    setTestStatus('sending');
    setTestResult(null);
    try {
      const res = await apiFetch('/api/webhooks/tradingview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: '04a64a2412a07a673c3ceecf239d57769ec8f96a1222e752c83a6995e0723982',
          ticker: 'BTCUSD',
          exchange: 'BITSTAMP',
          interval: '1D',
          price: 68000 + Math.round(Math.random() * 2000),
          volume: Math.round(Math.random() * 50000),
          action: Math.random() > 0.5 ? 'buy' : 'sell',
          time: new Date().toISOString(),
          strategy: 'test-signal',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestStatus('success');
        setTestResult(`Signal received: ${data.ticker} ${data.action} @ ${data.timestamp}`);
        fetchSignals();
      } else {
        setTestStatus('error');
        setTestResult(`Error ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestResult(err.message || 'Network error');
    }
  }, []);

  const fetchSignals = useCallback(async () => {
    setLoadingSignals(true);
    try {
      const res = await apiFetch('/api/webhooks/tradingview?limit=10');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals || []);
      }
    } catch { /* ignore */ }
    setLoadingSignals(false);
  }, []);

  useEffect(() => {
    fetchSignals();
    pollRef.current = setInterval(fetchSignals, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchSignals]);

  return (
    <div className="mt-6 border-t border-gray-800 pt-6">
      <div className="flex items-center gap-2 mb-4">
        <Bell size={14} className="text-btc-orange" />
        <h2 className="text-sm font-mono text-gray-200">TradingView Webhook Setup</h2>
      </div>

      {/* Step-by-step setup */}
      <div className="space-y-3 mb-5">
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
          <p className="text-[11px] font-mono text-btc-orange font-bold mb-2">STEP 1 — Webhook URL</p>
          <p className="text-[10px] font-mono text-gray-500 mb-2">In TradingView: Create Alert → Notifications → check &quot;Webhook URL&quot; → paste this:</p>
          <div className="flex items-center gap-2 bg-black/60 border border-gray-700 rounded px-3 py-2">
            <code className="text-[10px] font-mono text-green-400 flex-1 select-all break-all">{WEBHOOK_URL}</code>
            <button
              onClick={() => copyToClipboard(WEBHOOK_URL, 'url')}
              className="shrink-0 p-1.5 rounded border border-gray-700 hover:border-btc-orange/50 transition-colors"
              title="Copy URL"
            >
              {copied === 'url' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-500" />}
            </button>
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
          <p className="text-[11px] font-mono text-btc-orange font-bold mb-2">STEP 2 — Message Payload</p>
          <p className="text-[10px] font-mono text-gray-500 mb-2">Go back to the main alert screen → paste this into the &quot;Message&quot; field (replace all existing text):</p>
          <div className="flex items-start gap-2 bg-black/60 border border-gray-700 rounded px-3 py-2">
            <code className="text-[9px] font-mono text-cyan-400 flex-1 select-all break-all leading-relaxed">{PAYLOAD_TEMPLATE}</code>
            <button
              onClick={() => copyToClipboard(PAYLOAD_TEMPLATE, 'payload')}
              className="shrink-0 p-1.5 rounded border border-gray-700 hover:border-btc-orange/50 transition-colors mt-0.5"
              title="Copy payload"
            >
              {copied === 'payload' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-gray-500" />}
            </button>
          </div>
          <p className="text-[9px] font-mono text-gray-600 mt-2">
            Change <span className="text-amber-400">&quot;buy&quot;</span> to <span className="text-amber-400">&quot;sell&quot;</span> or <span className="text-amber-400">&quot;alert&quot;</span> depending on signal type.
            The {`{{ticker}}`}, {`{{close}}`}, etc. are TradingView placeholders — they auto-fill for any asset.
          </p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
          <p className="text-[11px] font-mono text-btc-orange font-bold mb-2">STEP 3 — Test It</p>
          <p className="text-[10px] font-mono text-gray-500 mb-2">Send a test signal to verify the webhook endpoint is working:</p>
          <div className="flex items-center gap-3">
            <button
              onClick={sendTestSignal}
              disabled={testStatus === 'sending'}
              className="flex items-center gap-2 px-4 py-2 rounded border border-btc-orange/40 bg-btc-orange/10 text-btc-orange text-[11px] font-mono font-bold hover:bg-btc-orange/20 transition-colors disabled:opacity-50"
            >
              {testStatus === 'sending' ? (
                <><Loader2 size={12} className="animate-spin" /> Sending...</>
              ) : (
                <><Send size={12} /> Send Test Signal</>
              )}
            </button>
            {testStatus === 'success' && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-green-400">
                <CheckCircle2 size={12} /> {testResult}
              </div>
            )}
            {testStatus === 'error' && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-red-400">
                <XCircle size={12} /> {testResult}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent signals feed */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-btc-orange animate-pulse" />
            <span className="text-[11px] font-mono text-gray-300 font-bold">Recent Signals</span>
            <span className="text-[9px] font-mono text-gray-600">({signals.length})</span>
          </div>
          <button onClick={fetchSignals} className="p-1 text-gray-600 hover:text-btc-orange transition-colors" title="Refresh">
            <RefreshCw size={11} className={loadingSignals ? 'animate-spin' : ''} />
          </button>
        </div>
        {signals.length === 0 ? (
          <p className="text-[10px] font-mono text-gray-600 text-center py-4">
            No signals yet. Send a test signal above or trigger a TradingView alert.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {signals.map((sig: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-black/40 rounded border border-gray-800/50">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    sig.action === 'buy' ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : sig.action === 'sell' ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'bg-btc-orange/10 text-btc-orange border border-btc-orange/20'
                  }`}>
                    {(sig.action || 'ALERT').toUpperCase()}
                  </span>
                  <span className="text-[10px] font-mono text-white font-bold">{sig.ticker || '—'}</span>
                  <span className="text-[9px] font-mono text-gray-500">{sig.exchange || ''}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-gray-300">
                    {sig.price_close || sig.price || sig.close ? `$${Number(sig.price_close || sig.price || sig.close).toLocaleString()}` : '—'}
                  </span>
                  <span className="text-[8px] font-mono text-gray-600">
                    {sig.received_at ? new Date(sig.received_at).toLocaleTimeString() : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recommended Data Sources ─────────────────────────────────────────────────

interface DataSource {
  name: string;
  provider: string;
  category: 'market-data' | 'alternative-data' | 'on-chain' | 'macro' | 'sentiment' | 'ai-ml' | 'news';
  description: string;
  pricing: string;
  tier: 'free' | 'freemium' | 'paid' | 'enterprise';
  url: string;
  relevance: 'critical' | 'high' | 'medium';
  integrated: boolean;
  envVar?: string;
  features: string[];
}

const RECOMMENDED_SOURCES: DataSource[] = [
  // ── Currently Integrated ──
  {
    name: 'TradingView Webhooks',
    provider: 'TradingView',
    category: 'market-data',
    description: 'Real-time price alerts, custom indicator signals, and strategy notifications via webhook.',
    pricing: 'Premium: $14.95/mo | Pro+: $29.95/mo',
    tier: 'paid',
    url: 'https://www.tradingview.com/gopro/',
    relevance: 'critical',
    integrated: true,
    envVar: 'TV_WEBHOOK_SECRET',
    features: ['Custom alert conditions', 'Multi-timeframe signals', 'Strategy backtesting', 'Pine Script indicators'],
  },
  {
    name: 'FRED Economic Data',
    provider: 'Federal Reserve Bank of St. Louis',
    category: 'macro',
    description: 'Treasury yields, CPI, employment, GDP, and 800K+ economic time series.',
    pricing: 'Free — 120 requests/min',
    tier: 'free',
    url: 'https://fred.stlouisfed.org/docs/api/fred/',
    relevance: 'critical',
    integrated: true,
    envVar: 'FRED_API_KEY',
    features: ['Treasury yield curves', 'CPI/PPI inflation', 'Employment data', 'GDP components'],
  },
  {
    name: 'Finnhub',
    provider: 'Finnhub',
    category: 'market-data',
    description: 'Real-time stock quotes, company fundamentals, insider transactions, and earnings data.',
    pricing: 'Free: 60 calls/min | Premium: from $49/mo',
    tier: 'freemium',
    url: 'https://finnhub.io/pricing',
    relevance: 'critical',
    integrated: true,
    envVar: 'FINNHUB_API_KEY',
    features: ['Real-time quotes', 'Company profiles', 'Insider trading', 'Earnings calendar'],
  },
  {
    name: 'CoinGecko',
    provider: 'CoinGecko',
    category: 'on-chain',
    description: 'Crypto market data — prices, volume, market cap, DeFi TVL, and exchange data.',
    pricing: 'Free: 30 calls/min | Pro: $129/mo',
    tier: 'freemium',
    url: 'https://www.coingecko.com/en/api/pricing',
    relevance: 'critical',
    integrated: true,
    envVar: 'COINGECKO_API_KEY',
    features: ['Top coins by market cap', 'BTC dominance', 'Exchange volumes', 'DeFi TVL tracking'],
  },
  {
    name: 'CNN Fear & Greed Index',
    provider: 'CNN / Alternative.me',
    category: 'sentiment',
    description: 'Market sentiment composite — combines volatility, momentum, safe haven demand, and options flow.',
    pricing: 'Free — no API key needed',
    tier: 'free',
    url: 'https://edition.cnn.com/markets/fear-and-greed',
    relevance: 'high',
    integrated: true,
    features: ['Daily sentiment score', 'Historical sentiment', 'Contrarian signal detection'],
  },
  // ── Recommended Additions ──
  {
    name: 'Polygon.io',
    provider: 'Polygon',
    category: 'market-data',
    description: 'Institutional-grade real-time and historical stock, options, forex, and crypto data. WebSocket streaming and REST APIs.',
    pricing: 'Free: 5 calls/min | Starter: $29/mo | Developer: $79/mo',
    tier: 'freemium',
    url: 'https://polygon.io/pricing',
    relevance: 'critical',
    integrated: false,
    features: ['Tick-level data', 'Options flow', 'Forex pairs', 'WebSocket streaming', 'Aggregated bars'],
  },
  {
    name: 'Unusual Whales',
    provider: 'Unusual Whales',
    category: 'alternative-data',
    description: 'Congressional trading tracker, dark pool flow, options flow, and insider transaction alerts. Key for detecting smart money moves.',
    pricing: 'Free tier available | Premium: $57/mo',
    tier: 'freemium',
    url: 'https://unusualwhales.com/pricing',
    relevance: 'critical',
    integrated: false,
    features: ['Congressional trades', 'Dark pool prints', 'Options flow alerts', 'Sector rotation signals'],
  },
  {
    name: 'Glassnode',
    provider: 'Glassnode',
    category: 'on-chain',
    description: 'On-chain intelligence — BTC/ETH exchange flows, whale wallets, SOPR, MVRV, and miner metrics. Essential for crypto macro.',
    pricing: 'Free: limited | Advanced: $29/mo | Professional: $799/mo',
    tier: 'freemium',
    url: 'https://glassnode.com/pricing',
    relevance: 'high',
    integrated: false,
    features: ['Exchange net flows', 'Whale wallet tracking', 'SOPR / MVRV ratios', 'Miner revenue metrics'],
  },
  {
    name: 'Quiver Quantitative',
    provider: 'Quiver Quant',
    category: 'alternative-data',
    description: 'Alternative data platform — government contracts, lobbying spend, patent filings, insider trades, and Reddit/WSB sentiment.',
    pricing: 'Free tier available | Pro: $10/mo',
    tier: 'freemium',
    url: 'https://www.quiverquant.com/',
    relevance: 'high',
    integrated: false,
    features: ['Gov contracts', 'Lobbying data', 'WSB sentiment', 'Patent filings', 'Corporate jet tracking'],
  },
  {
    name: 'Alpha Vantage',
    provider: 'Alpha Vantage',
    category: 'market-data',
    description: 'Free stock, forex, and crypto data with technical indicators. Good redundancy for Finnhub.',
    pricing: 'Free: 25 calls/day | Premium: from $49.99/mo',
    tier: 'freemium',
    url: 'https://www.alphavantage.co/premium/',
    relevance: 'medium',
    integrated: false,
    features: ['Technical indicators', 'Fundamental data', 'Forex rates', 'Crypto data', 'Earnings estimates'],
  },
  {
    name: 'Santiment',
    provider: 'Santiment',
    category: 'sentiment',
    description: 'Crypto social sentiment, development activity, whale alerts, and on-chain behavioral analytics.',
    pricing: 'Free: limited | Pro: $49/mo | Pro+: $250/mo',
    tier: 'freemium',
    url: 'https://santiment.net/pricing/',
    relevance: 'high',
    integrated: false,
    features: ['Social volume tracking', 'Developer activity', 'Whale transaction alerts', 'Network growth metrics'],
  },
  {
    name: 'CFTC COT Reports',
    provider: 'CFTC / Quandl',
    category: 'macro',
    description: 'Commitment of Traders data — institutional positioning in futures markets. Critical for understanding big money flows.',
    pricing: 'Free via CFTC SOCRATA API',
    tier: 'free',
    url: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm',
    relevance: 'high',
    integrated: true,
    features: ['Institutional positioning', 'Commercial vs speculative', 'Futures open interest', 'Weekly updates'],
  },
  {
    name: 'NewsAPI / Mediastack',
    provider: 'NewsAPI.org / Mediastack',
    category: 'news',
    description: 'Real-time and historical news headlines across financial markets. Useful for event-driven signal generation.',
    pricing: 'Free: 100 req/day | Business: from $49/mo',
    tier: 'freemium',
    url: 'https://newsapi.org/pricing',
    relevance: 'medium',
    integrated: false,
    features: ['Breaking news alerts', 'Source filtering', 'Keyword monitoring', 'Historical archives'],
  },
  {
    name: 'Treasury.gov Direct',
    provider: 'U.S. Department of the Treasury',
    category: 'macro',
    description: 'Direct Treasury auction data, debt-to-the-penny, TGA balance, and fiscal data. Bypasses FRED for primary source.',
    pricing: 'Free — no API key needed',
    tier: 'free',
    url: 'https://fiscaldata.treasury.gov/api-documentation/',
    relevance: 'high',
    integrated: true,
    features: ['Treasury auction results', 'TGA balance', 'National debt tracking', 'Interest expense data'],
  },
  {
    name: 'DefiLlama',
    provider: 'DefiLlama',
    category: 'on-chain',
    description: 'DeFi TVL aggregator — protocol-level TVL, yield data, stablecoin flows, and bridge volumes. No API key required.',
    pricing: 'Free — fully open',
    tier: 'free',
    url: 'https://defillama.com/docs/api',
    relevance: 'high',
    integrated: true,
    features: ['Protocol TVL rankings', 'Chain TVL comparison', 'Stablecoin supply tracking', 'DEX volume data'],
  },
  {
    name: 'BLS (Bureau of Labor Statistics)',
    provider: 'U.S. Bureau of Labor Statistics',
    category: 'macro',
    description: 'Primary source for CPI, PPI, employment, wages, and productivity data. Direct from the source — no FRED lag.',
    pricing: 'Free — v2 API (optional registration for higher limits)',
    tier: 'free',
    url: 'https://www.bls.gov/developers/',
    relevance: 'high',
    integrated: true,
    envVar: 'BLS_API_KEY',
    features: ['CPI components', 'Nonfarm payrolls', 'Wage growth', 'Productivity data'],
  },
];

const SOURCE_CATEGORY_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  'market-data': { label: 'Market Data', icon: <TrendingUp size={12} />, color: 'text-green-400' },
  'alternative-data': { label: 'Alternative Data', icon: <Database size={12} />, color: 'text-purple-400' },
  'on-chain': { label: 'On-Chain / DeFi', icon: <Radio size={12} />, color: 'text-btc-orange' },
  'macro': { label: 'Macro / Economic', icon: <Globe size={12} />, color: 'text-blue-400' },
  'sentiment': { label: 'Sentiment', icon: <Activity size={12} />, color: 'text-yellow-400' },
  'ai-ml': { label: 'AI / ML', icon: <Zap size={12} />, color: 'text-pink-400' },
  'news': { label: 'News / Events', icon: <Globe size={12} />, color: 'text-teal-400' },
};

const TIER_BADGES: Record<string, { label: string; color: string }> = {
  free: { label: 'FREE', color: 'text-green-400 bg-green-400/10 border-green-400/20' },
  freemium: { label: 'FREEMIUM', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  paid: { label: 'PAID', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  enterprise: { label: 'ENTERPRISE', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
};

const RELEVANCE_BADGES: Record<string, { label: string; color: string }> = {
  critical: { label: 'CRITICAL', color: 'text-red-400 bg-red-400/10 border-red-400/20' },
  high: { label: 'HIGH', color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  medium: { label: 'MEDIUM', color: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
};

function RecommendedSources() {
  const [filter, setFilter] = useState<'all' | 'integrated' | 'recommended'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = RECOMMENDED_SOURCES.filter(s => {
    if (filter === 'integrated') return s.integrated;
    if (filter === 'recommended') return !s.integrated;
    return true;
  });

  // Group by category
  const grouped = filtered.reduce<Record<string, DataSource[]>>((acc, src) => {
    if (!acc[src.category]) acc[src.category] = [];
    acc[src.category].push(src);
    return acc;
  }, {});

  const categoryOrder = ['market-data', 'macro', 'on-chain', 'alternative-data', 'sentiment', 'news', 'ai-ml'];
  const integratedCount = RECOMMENDED_SOURCES.filter(s => s.integrated).length;
  const recommendedCount = RECOMMENDED_SOURCES.filter(s => !s.integrated).length;
  const freeCount = RECOMMENDED_SOURCES.filter(s => !s.integrated && (s.tier === 'free' || s.tier === 'freemium')).length;

  return (
    <div className="mt-8 border-t border-gray-800 pt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-mono text-gray-200 flex items-center gap-2">
            <Star size={14} className="text-btc-orange" />
            Data Sources & Integrations
          </h2>
          <p className="text-[10px] font-mono text-gray-600 mt-1">
            {integratedCount} active &middot; {recommendedCount} recommended &middot; {freeCount} have free tiers
          </p>
        </div>
        <div className="flex gap-1">
          {(['all', 'integrated', 'recommended'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] font-mono px-2.5 py-1 rounded border transition-colors ${
                filter === f
                  ? 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
                  : 'border-gray-800 bg-gray-900/60 text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? 'All' : f === 'integrated' ? 'Active' : 'Recommended'}
            </button>
          ))}
        </div>
      </div>

      {categoryOrder.map(cat => {
        const sources = grouped[cat];
        if (!sources || sources.length === 0) return null;
        const catInfo = SOURCE_CATEGORY_LABELS[cat];

        return (
          <div key={cat} className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className={`${catInfo?.color || 'text-gray-400'}`}>{catInfo?.icon}</span>
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{catInfo?.label || cat}</span>
              <span className="h-px flex-1 bg-gray-800/50" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sources.map(src => {
                const expanded = expandedId === src.name;
                const tierBadge = TIER_BADGES[src.tier];
                const relevanceBadge = RELEVANCE_BADGES[src.relevance];

                return (
                  <div
                    key={src.name}
                    className={`border rounded-lg transition-all cursor-pointer ${
                      src.integrated
                        ? 'border-green-900/30 bg-green-950/10 hover:border-green-800/40'
                        : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
                    }`}
                    onClick={() => setExpandedId(expanded ? null : src.name)}
                  >
                    <div className="p-4">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          {src.integrated ? (
                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-gray-600" />
                          )}
                          <span className="text-sm font-mono text-gray-200">{src.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${relevanceBadge.color}`}>
                            {relevanceBadge.label}
                          </span>
                          <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${tierBadge.color}`}>
                            {tierBadge.label}
                          </span>
                        </div>
                      </div>

                      {/* Provider + status */}
                      <div className="text-[10px] font-mono text-gray-600 mb-1.5">{src.provider}</div>

                      {/* Description */}
                      <p className="text-[10px] font-mono text-gray-400 leading-relaxed mb-2">{src.description}</p>

                      {/* Pricing */}
                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        <DollarSign size={10} className="text-gray-600" />
                        <span className="text-gray-500">{src.pricing}</span>
                      </div>

                      {/* Expanded details */}
                      {expanded && (
                        <div className="mt-3 pt-3 border-t border-gray-800/50 space-y-2">
                          {/* Features */}
                          <div>
                            <div className="text-[9px] font-mono text-gray-600 uppercase mb-1">Key Features</div>
                            <div className="flex flex-wrap gap-1.5">
                              {src.features.map(f => (
                                <span key={f} className="text-[9px] font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Env var */}
                          {src.envVar && (
                            <div className="text-[10px] font-mono text-gray-600">
                              Env: <span className="text-btc-orange/70">{src.envVar}</span>
                              {src.integrated && <span className="text-green-500 ml-2">Configured</span>}
                            </div>
                          )}

                          {/* Link */}
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] font-mono text-btc-orange hover:text-btc-orange/80 transition-colors"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink size={10} /> View Documentation
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
