'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Monitor, Smartphone, Tablet, Bot, Globe, Users, Eye, RefreshCw,
  Loader2, Shield, AlertTriangle, Wifi, Clock, MapPin, ChevronDown,
  ChevronRight, Activity,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface DeviceSession {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  browser: string;
  os: string;
  ip: string;
  city: string | null;
  country: string | null;
  screenRes: string | null;
  fingerprint: string;
  currentPage: string;
  firstSeen: string;
  lastSeen: string;
  pageViews: number;
  isKnownUser: boolean;
  isSuspicious: boolean;
  tags: string[];
}

interface TrafficData {
  live: { activeNow: number; lastHour: number; today: number; totalTracked: number };
  sessions: DeviceSession[];
  breakdown: { device: Record<string, number>; browser: Record<string, number>; os: Record<string, number> };
  knownUsers: number;
  anonymousVisitors: number;
  suspiciousCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor size={14} />,
  mobile: <Smartphone size={14} />,
  tablet: <Tablet size={14} />,
  bot: <Bot size={14} />,
  unknown: <Globe size={14} />,
};

const DEVICE_COLORS: Record<string, string> = {
  desktop: 'text-blue-400 bg-blue-400/10',
  mobile: 'text-green-400 bg-green-400/10',
  tablet: 'text-purple-400 bg-purple-400/10',
  bot: 'text-red-400 bg-red-400/10',
  unknown: 'text-gray-400 bg-gray-400/10',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isActive(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-mono font-bold text-gray-100">{value}</div>
        <div className="text-[10px] font-mono text-gray-500 uppercase">{label}</div>
      </div>
    </div>
  );
}

// ── Breakdown Bar ────────────────────────────────────────────────────────────

function BreakdownBar({ data, title }: { data: Record<string, number>; title: string }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const colors = ['bg-btc-orange', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 'bg-yellow-500'];

  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);

  return (
    <div className="mb-4">
      <div className="text-[10px] font-mono text-gray-600 uppercase mb-2">{title}</div>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        {sorted.map(([key, count], i) => (
          <div
            key={key}
            className={`${colors[i % colors.length]} rounded-sm`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${key}: ${count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-1.5">
        {sorted.map(([key, count], i) => (
          <div key={key} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-sm ${colors[i % colors.length]}`} />
            <span className="text-[10px] font-mono text-gray-400">{key} ({count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: DeviceSession }) {
  const [expanded, setExpanded] = useState(false);
  const active = isActive(session.lastSeen);

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      session.isSuspicious ? 'border-red-800/50 bg-red-950/20' :
      active ? 'border-green-800/50 bg-gray-950/80' : 'border-gray-800 bg-gray-950/80'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 flex items-center gap-3"
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />

        {/* Device icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${DEVICE_COLORS[session.deviceType]}`}>
          {DEVICE_ICONS[session.deviceType]}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200 truncate">
              {session.isKnownUser ? (session.userName || session.userEmail || 'Known User') : `Anonymous (${session.fingerprint.slice(0, 6)})`}
            </span>
            {session.isSuspicious && (
              <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
            )}
          </div>
          <div className="text-[10px] font-mono text-gray-500">
            {session.browser} / {session.os} — {session.currentPage}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[10px] font-mono text-gray-600">{session.pageViews} views</span>
          <span className="text-[10px] font-mono text-gray-600">{relativeTime(session.lastSeen)}</span>
          {expanded ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronRight size={12} className="text-gray-600" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-gray-900/60 rounded-lg p-2">
            <div className="text-[9px] font-mono text-gray-600 uppercase">IP</div>
            <div className="text-xs font-mono text-gray-300">{session.ip}</div>
          </div>
          <div className="bg-gray-900/60 rounded-lg p-2">
            <div className="text-[9px] font-mono text-gray-600 uppercase">Fingerprint</div>
            <div className="text-xs font-mono text-gray-300">{session.fingerprint}</div>
          </div>
          <div className="bg-gray-900/60 rounded-lg p-2">
            <div className="text-[9px] font-mono text-gray-600 uppercase">Screen</div>
            <div className="text-xs font-mono text-gray-300">{session.screenRes || 'Unknown'}</div>
          </div>
          <div className="bg-gray-900/60 rounded-lg p-2">
            <div className="text-[9px] font-mono text-gray-600 uppercase">First Seen</div>
            <div className="text-xs font-mono text-gray-300">{relativeTime(session.firstSeen)}</div>
          </div>
          <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-1.5">
            {session.tags.map(tag => (
              <span key={tag} className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Traffic Tracker (Client-side beacon) ─────────────────────────────────────

function useTrafficBeacon() {
  useEffect(() => {
    const beacon = async () => {
      try {
        await fetch('/api/admin/traffic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page: window.location.pathname,
            screenRes: `${window.screen.width}x${window.screen.height}`,
          }),
        });
      } catch { /* ignore */ }
    };

    beacon();
    const interval = setInterval(beacon, 60000); // heartbeat every minute
    return () => clearInterval(interval);
  }, []);
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Traffic() {
  const [data, setData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'known' | 'suspicious'>('all');

  useTrafficBeacon();

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/traffic');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredSessions = data?.sessions.filter(s => {
    if (filter === 'active') return isActive(s.lastSeen);
    if (filter === 'known') return s.isKnownUser;
    if (filter === 'suspicious') return s.isSuspicious;
    return true;
  }) || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Activity size={20} className="text-btc-orange" />
            Traffic & Devices
          </h1>
          <p className="text-xs text-gray-500 mt-1">Real-time visitor tracking and device identification</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-btc-orange transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-btc-orange" />
        </div>
      ) : data ? (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Active Now" value={data.live.activeNow} icon={<Wifi size={18} />} color="bg-green-400/10 text-green-400" />
            <StatCard label="Last Hour" value={data.live.lastHour} icon={<Clock size={18} />} color="bg-blue-400/10 text-blue-400" />
            <StatCard label="Known Users" value={data.knownUsers} icon={<Users size={18} />} color="bg-btc-orange/10 text-btc-orange" />
            <StatCard label="Suspicious" value={data.suspiciousCount} icon={<Shield size={18} />} color="bg-red-400/10 text-red-400" />
          </div>

          {/* Breakdowns */}
          <div className="border border-gray-800 rounded-xl bg-gray-950/80 p-5 mb-6">
            <h2 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4">Visitor Breakdown (24h)</h2>
            <BreakdownBar data={data.breakdown.device} title="Device Type" />
            <BreakdownBar data={data.breakdown.browser} title="Browser" />
            <BreakdownBar data={data.breakdown.os} title="Operating System" />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mb-4">
            {(['all', 'active', 'known', 'suspicious'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-lg border transition-colors ${
                  filter === f
                    ? 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
                    : 'border-gray-800 bg-gray-950/80 text-gray-500 hover:text-gray-300'
                }`}
              >
                {f} ({f === 'all' ? data.sessions.length :
                  f === 'active' ? data.live.activeNow :
                  f === 'known' ? data.knownUsers :
                  data.suspiciousCount})
              </button>
            ))}
          </div>

          {/* Session list */}
          <div className="space-y-2">
            {filteredSessions.length === 0 && (
              <div className="text-center py-12 text-gray-600 text-xs font-mono">
                No sessions match this filter
              </div>
            )}
            {filteredSessions.map(session => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
