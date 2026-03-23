'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, RefreshCw, Loader2, Filter, Clock,
  AlertTriangle, CheckCircle2, Zap, DollarSign, Activity,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatTime, relativeTime } from '@/lib/formatters';

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  type: string;
  agentId: string;
  action: string;
  details: Record<string, any>;
  timestamp: string;
  tokensUsed?: number;
  latencyMs?: number;
  modelUsed?: string;
  costUsd?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ReactNode> = {
  task_execution: <Zap size={12} />,
  pipeline_run: <Activity size={12} />,
  budget_event: <DollarSign size={12} />,
  agent_error: <AlertTriangle size={12} />,
  bus_message: <FileText size={12} />,
  model_route: <CheckCircle2 size={12} />,
  cron_trigger: <Clock size={12} />,
  notification: <Activity size={12} />,
};

const TYPE_COLORS: Record<string, string> = {
  task_execution: 'text-btc-orange bg-btc-orange/10',
  pipeline_run: 'text-purple-400 bg-purple-400/10',
  budget_event: 'text-green-400 bg-green-400/10',
  agent_error: 'text-red-400 bg-red-400/10',
  bus_message: 'text-blue-400 bg-blue-400/10',
  model_route: 'text-cyan-400 bg-cyan-400/10',
  cron_trigger: 'text-yellow-400 bg-yellow-400/10',
  notification: 'text-gray-400 bg-gray-400/10',
};

// ── Main Component ───────────────────────────────────────────────────────────

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [filterAgent, setFilterAgent] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      if (filterAgent) params.set('agentId', filterAgent);
      params.set('limit', '100');
      const res = await apiFetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterType, filterAgent]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 15000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const types = Array.from(new Set(events.map(e => e.type)));
  const agents = Array.from(new Set(events.map(e => e.agentId)));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <FileText size={20} className="text-btc-orange" />
            Audit Log
          </h1>
          <p className="text-xs text-gray-500 mt-1">Full execution traces for every agent action</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchEvents(); }}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-btc-orange transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter size={12} className="text-gray-600" />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-btc-orange/50"
          >
            <option value="">All Types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-btc-orange/50"
        >
          <option value="">All Agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-[10px] font-mono text-gray-600 self-center ml-auto">{events.length} events</span>
      </div>

      {/* Event list */}
      <div className="space-y-1">
        {loading && events.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-btc-orange" />
          </div>
        )}
        {events.map(event => {
          const expanded = expandedId === event.id;
          const typeColor = TYPE_COLORS[event.type] || 'text-gray-400 bg-gray-400/10';
          const typeIcon = TYPE_ICONS[event.type] || <Activity size={12} />;

          return (
            <div key={event.id} className="border border-gray-800 rounded-lg bg-gray-950/80 overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : event.id)}
                className="w-full text-left p-3 flex items-center gap-3 hover:bg-gray-900/50 transition-colors"
              >
                <span className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded ${typeColor}`}>
                  {typeIcon} {event.type}
                </span>
                <span className="text-[10px] font-mono text-gray-600 flex-shrink-0">{event.agentId}</span>
                <span className="text-xs text-gray-300 flex-1 truncate">{event.action}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {event.modelUsed && (
                    <span className="text-[9px] font-mono text-cyan-400/60">{event.modelUsed.split('-').slice(-2).join('-')}</span>
                  )}
                  {event.costUsd !== undefined && event.costUsd > 0 && (
                    <span className="text-[9px] font-mono text-green-400/60">${event.costUsd.toFixed(4)}</span>
                  )}
                  {event.latencyMs !== undefined && (
                    <span className="text-[9px] font-mono text-gray-600">{event.latencyMs}ms</span>
                  )}
                  <span className="text-[10px] font-mono text-gray-600">{relativeTime(event.timestamp)}</span>
                </div>
              </button>

              {expanded && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="bg-gray-900/60 rounded-lg p-3">
                    <div className="text-[10px] font-mono text-gray-600 uppercase mb-1">Details</div>
                    <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </div>
                  <div className="flex gap-4 text-[10px] font-mono text-gray-600">
                    <span>Time: {formatTime(event.timestamp)}</span>
                    {event.tokensUsed && <span>Tokens: {event.tokensUsed}</span>}
                    <span>ID: {event.id}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
