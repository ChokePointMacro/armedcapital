'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface ApiKeyInfo {
  name: string;
  service: string;
  category: 'ai' | 'data' | 'infra' | 'social';
  isSet: boolean;
  lastFour: string;
  setVia: 'env';
}

interface ApiKeysData {
  keys: ApiKeyInfo[];
  checkedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI Providers',
  data: 'Market Data APIs',
  infra: 'Infrastructure',
  social: 'Social Platforms',
};

const CATEGORY_ORDER = ['ai', 'data', 'infra', 'social'];

export function ApiKeyManager() {
  const [data, setData] = useState<ApiKeysData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/keys');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Group keys by category
  const grouped = data
    ? CATEGORY_ORDER.reduce<Record<string, ApiKeyInfo[]>>((acc, cat) => {
        const items = data.keys.filter(k => k.category === cat);
        if (items.length) acc[cat] = items;
        return acc;
      }, {})
    : {};

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-mono text-gray-500 uppercase tracking-widest flex items-center gap-2">
          <span className="h-px flex-1 bg-gray-800" />
          API Key Inventory
          <span className="h-px flex-1 bg-gray-800" />
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-800 bg-gray-900 text-[10px] font-mono text-gray-400 hover:text-btc-orange hover:border-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="border border-red-900/50 rounded-lg p-4 bg-red-950/20 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm font-mono text-red-400">{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-24 bg-gray-800 rounded animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[1, 2, 3, 4].map(j => (
                  <div key={j} className="h-10 bg-gray-900/60 border border-gray-800 rounded animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Key groups */}
      {data && Object.entries(grouped).map(([cat, keys]) => (
        <div key={cat} className="space-y-2">
          <h3 className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">{CATEGORY_LABELS[cat] ?? cat}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {keys.map(key => (
              <div
                key={`${key.service}-${key.name}`}
                className={`border rounded-lg p-3 transition-all ${
                  key.isSet
                    ? 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
                    : 'border-red-900/30 bg-red-950/10 hover:border-red-800/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono text-gray-400 truncate">{key.name}</div>
                    <div className="text-[9px] font-mono text-gray-600 truncate">{key.service}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        key.isSet ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'
                      }`}
                    />
                  </div>
                </div>
                {key.isSet && (
                  <div className="text-[9px] font-mono text-gray-600 mt-2">{key.lastFour}</div>
                )}
                {!key.isSet && (
                  <div className="text-[9px] font-mono text-red-400 mt-2">Not set</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Stats summary */}
      {data && (
        <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/60 mt-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Total Keys</div>
              <div className="text-lg font-mono text-gray-200 mt-1">{data.keys.length}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Configured</div>
              <div className="text-lg font-mono text-green-400 mt-1">{data.keys.filter(k => k.isSet).length}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">Missing</div>
              <div className="text-lg font-mono text-red-400 mt-1">{data.keys.filter(k => !k.isSet).length}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
