'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, Compass, Map as MapIcon, RefreshCw, AlertCircle, Settings, Radio,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { StatusPill } from './StatusPill';
import { ChokepointMap } from './ChokepointMap';
import { ChokepointSourcesModal } from './ChokepointSourcesModal';
import type {
  ChokepointAgentRun,
  Country,
  StatusPill as StatusPillValue,
} from '@/types';

interface ChokepointWithStatus {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;
  latest_status: StatusPillValue;
  last_updated: string | null;
  headline_signal: string | null;
  data_source_count: number;
  recent_signal_count: number;
}

interface DashboardResponse {
  chokepoints: ChokepointWithStatus[];
  oil_producers: Country[];
  lng_producers: Country[];
  latest_run: ChokepointAgentRun | null;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'No data yet';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

function formatRelativeAge(ts: string | null): string {
  if (!ts) return 'never';
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageH = ageMs / 3_600_000;
  if (ageH < 1) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageH < 48) return `${Math.round(ageH)}h ago`;
  return `${Math.round(ageH / 24)}d ago`;
}

function CountryRow({ country }: { country: Country }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-btc-orange/10 last:border-0">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-btc-orange/50 w-10">
          {country.iso3}
        </span>
        <span className="text-sm text-gray-300">{country.name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {country.oil_producer_tier && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-amber-300/80 px-1.5 py-0.5 rounded ring-1 ring-amber-400/20">
            Oil · {country.oil_producer_tier}
          </span>
        )}
        {country.lng_producer_tier && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/80 px-1.5 py-0.5 rounded ring-1 ring-sky-400/20">
            LNG · {country.lng_producer_tier}
          </span>
        )}
      </div>
    </div>
  );
}

export function Chokepoints() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCp, setActiveCp] = useState<ChokepointWithStatus | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/chokepoints');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const hasData = !!data && data.chokepoints.length > 0;
  const agentRunAge = data?.latest_run?.ts ?? null;
  const agentStale = !agentRunAge || (Date.now() - new Date(agentRunAge).getTime()) / 3_600_000 > 36;

  return (
    <div className="space-y-12">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <section className="relative py-12 border-b border-btc-orange/20">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-4">
            <p className="text-xs font-mono uppercase tracking-[0.3em] text-btc-orange/60">
              ChokePoint Watch
            </p>
            <span className="px-2 py-0.5 bg-btc-orange text-black text-[8px] font-mono uppercase tracking-widest rounded-full animate-pulse shadow-[0_0_10px_#f7931a]">
              Tension Agent
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-serif italic leading-none mb-6 text-white bitcoin-glow">
            Live where it matters.
          </h1>
          <p className="text-lg text-gray-400 leading-relaxed max-w-xl">
            Daily monitoring of the seven maritime chokepoints that route the world&apos;s
            crude oil and LNG. Status pills combine flow anomalies and signals from
            connected data sources against a 90-day rolling baseline.
          </p>
        </div>
      </section>

      {/* ── Loading / error states ──────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-btc-orange/60 text-xs font-mono uppercase tracking-widest">
          <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
          Loading chokepoint status…
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-3 p-6 border border-rose-500/30 bg-rose-500/5">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-rose-300 font-mono">Failed to load: {error}</p>
            <p className="text-xs text-gray-500 mt-1">
              The schema additions in <code>scripts/chokepoint-watch-schema.sql</code> may
              not have been run yet. Open Supabase SQL Editor and re-run the file end-to-end.
            </p>
            <button
              onClick={() => void load()}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 text-rose-300 text-[10px] font-mono uppercase tracking-widest hover:bg-rose-500/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      )}

      {/* ── Stale-agent banner ──────────────────────────────────────────── */}
      {data && hasData && agentStale && (
        <div className="flex items-center gap-3 px-4 py-3 border border-zinc-500/30 bg-zinc-500/5">
          <Radio className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs text-zinc-300 font-mono uppercase tracking-widest">
              Agent has not run in the last 36 hours · pills show NO SIGNAL until next cron
            </p>
            <p className="text-[10px] text-gray-500 mt-1">
              Last run: {agentRunAge ? formatRelativeAge(agentRunAge) : 'never'}.
              Trigger manually:{' '}
              <code className="text-btc-orange/70">curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; /api/cron/chokepoint-agent</code>
            </p>
          </div>
        </div>
      )}

      {/* ── Status grid ──────────────────────────────────────────────────── */}
      {data && hasData && (
        <section>
          <div className="flex items-center gap-3 mb-5">
            <Activity className="w-3.5 h-3.5 text-btc-orange" />
            <h2 className="text-xs font-mono uppercase tracking-[0.3em] text-btc-orange/80">
              Chokepoint Status
            </h2>
            {data.latest_run && (
              <span className="text-[10px] text-gray-500 font-mono ml-auto">
                Last agent run: {formatTimestamp(data.latest_run.ts)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.chokepoints.map((cp) => (
              <div
                key={cp.id}
                className="border border-btc-orange/15 bg-[#0a0a0a]/60 p-5 hover:border-btc-orange/40 transition-colors flex flex-col"
              >
                <div className="flex items-start justify-between mb-3 gap-2">
                  <h3 className="text-lg font-serif italic text-white leading-tight">{cp.name}</h3>
                  <StatusPill status={cp.latest_status} />
                </div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-btc-orange/40 mb-3">
                  {cp.center_lat.toFixed(2)}°N · {cp.center_lng.toFixed(2)}°E
                </p>

                {cp.headline_signal ? (
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-3 flex-1">
                    {cp.headline_signal}
                  </p>
                ) : cp.latest_status === 'unknown' ? (
                  <p className="text-xs text-gray-600 italic flex-1">
                    No signal — connect a data source to start monitoring.
                  </p>
                ) : (
                  <p className="text-xs text-gray-600 italic flex-1">
                    No anomalies in window.
                  </p>
                )}

                {/* Sources / signals counts */}
                <div className="flex items-center gap-3 mt-4 text-[10px] font-mono">
                  <span className="text-gray-500">
                    <span className="text-gray-300">{cp.data_source_count}</span>{' '}
                    source{cp.data_source_count === 1 ? '' : 's'}
                  </span>
                  <span className="text-gray-500">
                    <span className="text-gray-300">{cp.recent_signal_count}</span>{' '}
                    signal{cp.recent_signal_count === 1 ? '' : 's'} 24h
                  </span>
                  <span className="text-gray-600 ml-auto">
                    {formatRelativeAge(cp.last_updated)}
                  </span>
                </div>

                <button
                  onClick={() => setActiveCp(cp)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-btc-orange/30 text-btc-orange text-[10px] font-mono uppercase tracking-widest hover:bg-btc-orange/10 transition-colors"
                >
                  <Settings size={11} />
                  Manage sources
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Global map ──────────────────────────────────────────────────── */}
      {data && hasData && (
        <section>
          <div className="flex items-center gap-3 mb-5">
            <MapIcon className="w-3.5 h-3.5 text-btc-orange" />
            <h2 className="text-xs font-mono uppercase tracking-[0.3em] text-btc-orange/80">
              Global Energy Flow Map
            </h2>
          </div>
          <ChokepointMap chokepoints={data.chokepoints} />
        </section>
      )}

      {/* ── Producer countries ──────────────────────────────────────────── */}
      {data && (
        <section>
          <div className="flex items-center gap-3 mb-5">
            <Compass className="w-3.5 h-3.5 text-btc-orange" />
            <h2 className="text-xs font-mono uppercase tracking-[0.3em] text-btc-orange/80">
              Producer Countries
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-btc-orange/15 bg-[#0a0a0a]/60 p-6">
              <h3 className="font-mono text-xs uppercase tracking-widest text-amber-300 mb-4">
                Oil Producers ({data.oil_producers.length})
              </h3>
              {data.oil_producers.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No producers seeded yet.</p>
              ) : (
                <div>{data.oil_producers.map((c) => <CountryRow key={c.iso3} country={c} />)}</div>
              )}
            </div>

            <div className="border border-btc-orange/15 bg-[#0a0a0a]/60 p-6">
              <h3 className="font-mono text-xs uppercase tracking-widest text-sky-300 mb-4">
                LNG Producers ({data.lng_producers.length})
              </h3>
              {data.lng_producers.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No producers seeded yet.</p>
              ) : (
                <div>{data.lng_producers.map((c) => <CountryRow key={c.iso3} country={c} />)}</div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Pro CTA ─────────────────────────────────────────────────────── */}
      <section className="border border-btc-orange/20 bg-[#0a0a0a]/60 p-8 sm:p-10 text-center">
        <p className="text-xs font-mono uppercase tracking-[0.3em] text-btc-orange/60 mb-3">
          Tension Agent · Daily Brief
        </p>
        <h2 className="text-3xl font-serif italic text-white bitcoin-glow mb-3">
          Daily synthesis. Anomaly archive. 06:30 UTC inbox brief.
        </h2>
        <p className="text-sm text-gray-400 max-w-xl mx-auto mb-6 leading-relaxed">
          The pills are public. The narrative behind them — flow anomalies, sanctions
          deltas, and the analyst-grade synthesis — runs as a daily Vercel cron and
          drops into your inbox.
        </p>
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 px-6 py-3 bg-btc-orange text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity shadow-[0_0_10px_rgba(247,147,26,0.3)]"
        >
          Subscribe to brief
        </Link>
      </section>

      {/* ── Sources modal ───────────────────────────────────────────────── */}
      {activeCp && (
        <ChokepointSourcesModal
          open={true}
          onClose={() => setActiveCp(null)}
          chokepointId={activeCp.id}
          chokepointName={activeCp.name}
          onChange={() => void load()}
        />
      )}
    </div>
  );
}

export default Chokepoints;
