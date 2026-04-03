'use client';

import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  TrendingUp,
  Calendar as CalendarIcon,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type EventCategory = 'Fed' | 'Inflation' | 'Employment' | 'GDP' | 'Earnings';

interface EconomicEvent {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM ET
  impact: ImpactLevel;
  category: EventCategory;
  consensus: string | null;
  previous: string | null;
  actual: string | null;
}

interface CalendarResponse {
  events: EconomicEvent[];
  lastUpdated: string;
}

// ─── Category Icons ────────────────────────────────────────────────────────────

function getCategoryIcon(category: EventCategory) {
  const iconMap: Record<EventCategory, React.ReactNode> = {
    Fed: '🏦',
    Inflation: '📈',
    Employment: '👥',
    GDP: '💰',
    Earnings: '📊',
  };
  return iconMap[category];
}

// ─── Calendar Grid View ────────────────────────────────────────────────────────

interface CalendarGridProps {
  events: EconomicEvent[];
  month: number;
  year: number;
  onMonthChange: (delta: number) => void;
}

function CalendarGrid({ events, month, year, onMonthChange }: CalendarGridProps) {
  // Get days in month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  // Create month grid
  const days = [];
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  // Filter events for this month
  const monthEvents = events.filter(e => {
    const [y, m, d] = e.date.split('-').map(Number);
    return y === year && m === month + 1;
  });

  // Map events by date
  const eventsByDate: Record<number, EconomicEvent[]> = {};
  for (const event of monthEvents) {
    const day = parseInt(event.date.split('-')[2], 10);
    if (!eventsByDate[day]) eventsByDate[day] = [];
    eventsByDate[day].push(event);
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getImpactColor = (impact: ImpactLevel) => {
    switch (impact) {
      case 'HIGH':
        return 'bg-red-500';
      case 'MEDIUM':
        return 'bg-yellow-500';
      case 'LOW':
        return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-mono font-bold text-white">
          {monthNames[month]} {year}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => onMonthChange(-1)}
            className="p-1.5 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
          >
            <ChevronLeft size={16} className="text-gray-400" />
          </button>
          <button
            onClick={() => onMonthChange(1)}
            className="p-1.5 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
          >
            <ChevronRight size={16} className="text-gray-400" />
          </button>
        </div>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayNames.map(day => (
          <div key={day} className="text-center text-xs font-mono font-bold text-gray-500 py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, idx) => (
          <div
            key={idx}
            className={cn(
              'min-h-24 p-1.5 rounded border text-xs font-mono',
              day === null
                ? 'bg-gray-950 border-gray-800'
                : 'bg-gray-900 border-gray-700 hover:border-gray-600',
            )}
          >
            {day && (
              <div className="space-y-1">
                <div className="font-bold text-white">{day}</div>
                {eventsByDate[day] && (
                  <div className="space-y-1">
                    {eventsByDate[day].slice(0, 2).map(event => (
                      <div
                        key={event.id}
                        className={cn(
                          'px-1 py-0.5 rounded text-[10px] font-bold text-white truncate',
                          getImpactColor(event.impact),
                        )}
                        title={event.name}
                      >
                        {event.name.substring(0, 12)}
                      </div>
                    ))}
                    {eventsByDate[day].length > 2 && (
                      <div className="text-[9px] text-gray-400">
                        +{eventsByDate[day].length - 2} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upcoming Events List ──────────────────────────────────────────────────────

interface UpcomingListProps {
  events: EconomicEvent[];
  filters: {
    impact?: ImpactLevel[];
    category?: EventCategory[];
  };
}

function UpcomingList({ events, filters }: UpcomingListProps) {
  // Filter to next 30 days
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  let filtered = events.filter(e => {
    const eventDate = new Date(e.date);
    return eventDate >= now && eventDate <= thirtyDaysFromNow;
  });

  if (filters.impact && filters.impact.length > 0) {
    filtered = filtered.filter(e => filters.impact!.includes(e.impact));
  }
  if (filters.category && filters.category.length > 0) {
    filtered = filtered.filter(e => filters.category!.includes(e.category));
  }

  return (
    <div className="space-y-3">
      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 text-xs font-mono py-8">
          No events match filters
        </div>
      ) : (
        filtered.map(event => (
          <div
            key={event.id}
            className="border border-gray-700 rounded-lg p-3 bg-gray-900/50 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{getCategoryIcon(event.category)}</span>
                  <h4 className="text-xs font-mono font-bold text-white truncate">
                    {event.name}
                  </h4>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400 mb-2">
                  <CalendarIcon size={10} />
                  {new Date(event.date).toLocaleDateString()} {event.time} ET
                </div>

                {/* Data row */}
                {(event.consensus || event.previous) && (
                  <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                    {event.consensus && (
                      <div>
                        <span className="text-gray-500">Consensus: </span>
                        <span className="text-blue-400">{event.consensus}</span>
                      </div>
                    )}
                    {event.previous && (
                      <div>
                        <span className="text-gray-500">Previous: </span>
                        <span className="text-gray-300">{event.previous}</span>
                      </div>
                    )}
                    {event.actual && (
                      <div>
                        <span className="text-gray-500">Actual: </span>
                        <span className="text-green-400">{event.actual}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Impact badge */}
              <div className="shrink-0">
                <div
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-bold text-white whitespace-nowrap',
                    event.impact === 'HIGH'
                      ? 'bg-red-500/20 text-red-400'
                      : event.impact === 'MEDIUM'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-gray-500/20 text-gray-400',
                  )}
                >
                  {event.impact}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export const EconomicCalendar = () => {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  // Filters
  const [impactFilter, setImpactFilter] = useState<Set<ImpactLevel>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<EventCategory>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/calendar');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('[EconomicCalendar] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3600_000); // Refresh hourly

    return () => clearInterval(interval);
  }, []);

  const handleMonthChange = (delta: number) => {
    let newMonth = currentMonth + delta;
    let newYear = currentYear;

    if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    }

    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
  };

  const toggleImpactFilter = (impact: ImpactLevel) => {
    const newSet = new Set(impactFilter);
    if (newSet.has(impact)) {
      newSet.delete(impact);
    } else {
      newSet.add(impact);
    }
    setImpactFilter(newSet);
  };

  const toggleCategoryFilter = (category: EventCategory) => {
    const newSet = new Set(categoryFilter);
    if (newSet.has(category)) {
      newSet.delete(category);
    } else {
      newSet.add(category);
    }
    setCategoryFilter(newSet);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={24} className="animate-spin text-btc-orange" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-red-400 font-mono text-sm">
        Failed to load Economic Calendar data
      </div>
    );
  }

  const activeImpactCount = impactFilter.size;
  const activeCategoryCount = categoryFilter.size;

  return (
    <div className="space-y-6">
      {/* View Toggle + Briefing Button */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border border-gray-700 rounded-lg p-1 bg-gray-900/50">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'px-3 py-1.5 text-xs font-mono rounded transition-colors',
              viewMode === 'grid'
                ? 'bg-btc-orange/20 text-btc-orange'
                : 'text-gray-400 hover:text-gray-300',
            )}
          >
            <CalendarIcon size={12} className="inline mr-1" /> Grid
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'px-3 py-1.5 text-xs font-mono rounded transition-colors',
              viewMode === 'list'
                ? 'bg-btc-orange/20 text-btc-orange'
                : 'text-gray-400 hover:text-gray-300',
            )}
          >
            <TrendingUp size={12} className="inline mr-1" /> Upcoming
          </button>
        </div>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 bg-btc-orange/10 border border-btc-orange/40 rounded text-xs font-mono text-btc-orange hover:bg-btc-orange/20 transition-colors"
          title="Generate pre-event briefing AI analysis (coming soon)"
        >
          <Sparkles size={12} /> Pre-Event Brief
        </button>
      </div>

      {/* Filters */}
      <div className="border border-gray-700 rounded-lg p-3 bg-gray-900/50 space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-mono font-bold text-gray-400 uppercase">Impact Level</p>
          <div className="flex gap-2 flex-wrap">
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map(level => (
              <button
                key={level}
                onClick={() => toggleImpactFilter(level)}
                className={cn(
                  'px-2 py-1 rounded text-xs font-mono transition-colors',
                  impactFilter.has(level)
                    ? level === 'HIGH'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                      : level === 'MEDIUM'
                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                        : 'bg-gray-500/20 text-gray-400 border border-gray-500/40'
                    : 'border border-gray-600 text-gray-400 hover:text-gray-300',
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono font-bold text-gray-400 uppercase">Category</p>
          <div className="flex gap-2 flex-wrap">
            {(['Fed', 'Inflation', 'Employment', 'GDP', 'Earnings'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => toggleCategoryFilter(cat)}
                className={cn(
                  'px-2 py-1 rounded text-xs font-mono transition-colors',
                  categoryFilter.has(cat)
                    ? 'bg-btc-orange/20 text-btc-orange border border-btc-orange/40'
                    : 'border border-gray-600 text-gray-400 hover:text-gray-300',
                )}
              >
                {getCategoryIcon(cat)} {cat}
              </button>
            ))}
          </div>
        </div>

        {(activeImpactCount > 0 || activeCategoryCount > 0) && (
          <button
            onClick={() => {
              setImpactFilter(new Set());
              setCategoryFilter(new Set());
            }}
            className="text-xs font-mono text-btc-orange hover:text-orange-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      {viewMode === 'grid' ? (
        <CalendarGrid
          events={data.events}
          month={currentMonth}
          year={currentYear}
          onMonthChange={handleMonthChange}
        />
      ) : (
        <UpcomingList
          events={data.events}
          filters={{
            impact: Array.from(impactFilter),
            category: Array.from(categoryFilter),
          }}
        />
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 pt-4 border-t border-gray-800">
        <span>ECONOMIC CALENDAR 2026</span>
        <span>{new Date(data.lastUpdated).toLocaleTimeString()}</span>
      </div>
    </div>
  );
};
