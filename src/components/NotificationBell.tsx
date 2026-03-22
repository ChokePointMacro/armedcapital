'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell, X, CheckCircle2, AlertTriangle, XCircle, Info, ExternalLink,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  agentId?: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  read: boolean;
  actionUrl?: string;
  timestamp: string;
}

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  info: <Info size={12} className="text-blue-400" />,
  warning: <AlertTriangle size={12} className="text-yellow-400" />,
  error: <XCircle size={12} className="text-red-400" />,
  success: <CheckCircle2 size={12} className="text-green-400" />,
};

const SEVERITY_BORDER: Record<string, string> = {
  info: 'border-l-blue-400',
  warning: 'border-l-yellow-400',
  error: 'border-l-red-400',
  success: 'border-l-green-400',
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/notifications?limit=20');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (id: string) => {
    await apiFetch('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ action: 'markRead', notificationId: id }),
    });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await apiFetch('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ action: 'markAllRead' }),
    });
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-btc-orange transition-colors"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[8px] font-mono text-white font-bold animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
            <span className="text-xs font-mono text-gray-400 uppercase">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[10px] font-mono text-btc-orange hover:text-btc-orange/80 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-80">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-gray-600 text-xs font-mono">No notifications</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`px-4 py-2.5 border-b border-gray-800/50 border-l-2 ${SEVERITY_BORDER[n.severity]} ${
                    n.read ? 'opacity-60' : ''
                  } hover:bg-gray-900/50 transition-colors cursor-pointer`}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {SEVERITY_ICONS[n.severity]}
                    <span className="text-xs font-medium text-gray-200 flex-1">{n.title}</span>
                    <span className="text-[9px] font-mono text-gray-600">{relativeTime(n.timestamp)}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 leading-relaxed ml-5">{n.message}</div>
                  {n.actionUrl && (
                    <Link
                      href={n.actionUrl}
                      className="text-[9px] font-mono text-btc-orange/70 hover:text-btc-orange flex items-center gap-1 mt-1 ml-5"
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink size={8} /> View
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
