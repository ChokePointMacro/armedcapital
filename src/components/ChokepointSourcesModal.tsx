'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Power, Zap, ExternalLink } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type {
  ChokepointDataSource,
  ChokepointSignal,
  DataSourceType,
  SignalSeverity,
} from '@/types';

const TYPE_LABELS: Record<DataSourceType, string> = {
  rss: 'RSS feed',
  news_query: 'News query',
  twitter_account: 'X / Twitter account',
  manual_url: 'Manual URL',
  webhook: 'Inbound webhook',
};

const TYPE_HINT: Record<DataSourceType, string> = {
  rss: 'e.g. https://www.reuters.com/markets/commodities/rss',
  news_query: 'e.g. "Hormuz tanker" — used as a search query',
  twitter_account: 'e.g. TankerTrackers (without the @)',
  manual_url: 'e.g. https://example.com/feed.json',
  webhook: 'Inbound URL — your service POSTs signals here',
};

interface Props {
  open: boolean;
  onClose: () => void;
  chokepointId: string;
  chokepointName: string;
  onChange?: () => void; // called when sources / signals change so parent can refresh
}

export function ChokepointSourcesModal({ open, onClose, chokepointId, chokepointName, onChange }: Props) {
  const [sources, setSources] = useState<ChokepointDataSource[]>([]);
  const [signals, setSignals] = useState<ChokepointSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-source form
  const [newType, setNewType] = useState<DataSourceType>('rss');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);

  // Test-signal form
  const [sigSeverity, setSigSeverity] = useState<SignalSeverity>('medium');
  const [sigHeadline, setSigHeadline] = useState('');
  const [sigUrl, setSigUrl] = useState('');
  const [injecting, setInjecting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [srcRes, sigRes] = await Promise.all([
        apiFetch(`/api/chokepoints/${chokepointId}/data-sources`),
        apiFetch(`/api/chokepoints/${chokepointId}/signals`),
      ]);
      if (!srcRes.ok) throw new Error(`sources: HTTP ${srcRes.status}`);
      if (!sigRes.ok) throw new Error(`signals: HTTP ${sigRes.status}`);
      const srcJson = (await srcRes.json()) as { data: ChokepointDataSource[] };
      const sigJson = (await sigRes.json()) as { data: ChokepointSignal[] };
      setSources(srcJson.data ?? []);
      setSignals(sigJson.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chokepointId]);

  async function addSource(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/chokepoints/${chokepointId}/data-sources`, {
        method: 'POST',
        body: JSON.stringify({ type: newType, name: newName.trim(), url: newUrl.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setNewName('');
      setNewUrl('');
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  }

  async function toggleSource(s: ChokepointDataSource) {
    setError(null);
    try {
      const res = await apiFetch(`/api/chokepoints/${chokepointId}/data-sources/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle');
    }
  }

  async function deleteSource(s: ChokepointDataSource) {
    if (!confirm(`Delete data source "${s.name}"?`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/chokepoints/${chokepointId}/data-sources/${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function injectSignal(e: React.FormEvent) {
    e.preventDefault();
    if (!sigHeadline.trim()) return;
    setInjecting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/chokepoints/${chokepointId}/signals`, {
        method: 'POST',
        body: JSON.stringify({
          severity: sigSeverity,
          headline: sigHeadline.trim(),
          url: sigUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setSigHeadline('');
      setSigUrl('');
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inject signal');
    } finally {
      setInjecting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-[#0a0a0a] border border-btc-orange/25 shadow-[0_0_60px_rgba(247,147,26,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-btc-orange/15">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-btc-orange/60 mb-1">
              Data Sources
            </p>
            <h2 className="text-2xl font-serif italic text-white">{chokepointName}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-btc-orange p-1 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 px-3 py-2 bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 font-mono">
            {error}
          </div>
        )}

        {/* Add source */}
        <form onSubmit={addSource} className="p-5 border-b border-btc-orange/10 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-btc-orange/60">
            Connect new source
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as DataSourceType)}
              className="bg-black/40 border border-btc-orange/30 px-3 py-2 text-xs font-mono text-gray-200 focus:border-btc-orange focus:outline-none"
            >
              {(Object.keys(TYPE_LABELS) as DataSourceType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Name (e.g. Reuters Energy)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-black/40 border border-btc-orange/30 px-3 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:border-btc-orange focus:outline-none"
              maxLength={200}
            />
            <input
              type="text"
              placeholder={TYPE_HINT[newType]}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="bg-black/40 border border-btc-orange/30 px-3 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:border-btc-orange focus:outline-none"
              maxLength={2000}
            />
          </div>
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            <Plus size={12} />
            {adding ? 'Adding…' : 'Add source'}
          </button>
          <p className="text-[10px] text-gray-600 font-mono">
            Polling is wired separately — adding a source registers it. Use the test-signal panel below to verify pill flips.
          </p>
        </form>

        {/* Existing sources */}
        <div className="p-5 border-b border-btc-orange/10">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-btc-orange/60 mb-3">
            Connected ({sources.length})
          </p>
          {loading && sources.length === 0 ? (
            <p className="text-xs text-gray-500 font-mono">Loading…</p>
          ) : sources.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No data sources connected yet.</p>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 bg-black/30 border border-btc-orange/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono ${s.enabled ? 'text-gray-200' : 'text-gray-600 line-through'}`}>
                        {s.name}
                      </span>
                      <span className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/50">
                        {TYPE_LABELS[s.type]}
                      </span>
                    </div>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-mono text-gray-500 hover:text-btc-orange truncate flex items-center gap-1 mt-0.5"
                      >
                        <ExternalLink size={9} /> {s.url}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleSource(s)}
                      className={`p-1.5 transition-colors ${s.enabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-600 hover:text-gray-400'}`}
                      title={s.enabled ? 'Disable' : 'Enable'}
                    >
                      <Power size={13} />
                    </button>
                    <button
                      onClick={() => deleteSource(s)}
                      className="p-1.5 text-gray-500 hover:text-rose-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Test signal */}
        <form onSubmit={injectSignal} className="p-5 border-b border-btc-orange/10 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-btc-orange/60">
            Inject test signal
          </p>
          <p className="text-[10px] text-gray-600 font-mono">
            Manually create a signal to verify the pill responds. High → red. Medium → yellow. Low → yellow.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              value={sigSeverity}
              onChange={(e) => setSigSeverity(e.target.value as SignalSeverity)}
              className="bg-black/40 border border-btc-orange/30 px-3 py-2 text-xs font-mono text-gray-200 focus:border-btc-orange focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="text"
              placeholder="Headline"
              value={sigHeadline}
              onChange={(e) => setSigHeadline(e.target.value)}
              className="bg-black/40 border border-btc-orange/30 px-3 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:border-btc-orange focus:outline-none"
              maxLength={500}
            />
            <input
              type="text"
              placeholder="URL (optional)"
              value={sigUrl}
              onChange={(e) => setSigUrl(e.target.value)}
              className="bg-black/40 border border-btc-orange/30 px-3 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:border-btc-orange focus:outline-none"
              maxLength={2000}
            />
          </div>
          <button
            type="submit"
            disabled={injecting || !sigHeadline.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 border border-btc-orange/40 text-btc-orange text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-btc-orange/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Zap size={12} />
            {injecting ? 'Injecting…' : 'Inject signal'}
          </button>
          <p className="text-[10px] text-gray-600 font-mono">
            Status updates after the next agent run. Trigger immediately:{' '}
            <code className="text-btc-orange/60">curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; /api/cron/chokepoint-agent</code>
          </p>
        </form>

        {/* Recent signals */}
        <div className="p-5">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-btc-orange/60 mb-3">
            Recent signals (7d) — {signals.length}
          </p>
          {signals.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No signals in the last 7 days.</p>
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {signals.map((s) => {
                const sevColor =
                  s.severity === 'high'   ? 'text-rose-400'    :
                  s.severity === 'medium' ? 'text-amber-400'   :
                                            'text-zinc-400';
                return (
                  <li key={s.id} className="px-3 py-2 bg-black/30 border border-btc-orange/10 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <span className={`text-[9px] font-mono uppercase tracking-widest font-bold ${sevColor}`}>
                        {s.severity}
                      </span>
                      <span className="text-[10px] font-mono text-gray-600">
                        {new Date(s.ts).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-gray-200 mt-1 leading-snug">{s.headline}</p>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-mono text-btc-orange/60 hover:text-btc-orange flex items-center gap-1 mt-1"
                      >
                        <ExternalLink size={9} /> source
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChokepointSourcesModal;
