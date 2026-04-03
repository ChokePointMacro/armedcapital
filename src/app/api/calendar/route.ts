/**
 * Economic Calendar API
 * GET /api/calendar
 *
 * Returns curated economic calendar events for 2026 including FOMC, CPI, jobs reports, GDP.
 * Always includes static calendar data as fallback is reliable for published dates.
 */

import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type EventCategory = 'Fed' | 'Inflation' | 'Employment' | 'GDP' | 'Earnings';

interface EconomicEvent {
  id: string;
  name: string;
  date: string; // ISO date
  time: string; // HH:MM ET
  impact: ImpactLevel;
  category: EventCategory;
  consensus: string | null;
  previous: string | null;
  actual: string | null; // If event has already occurred
}

interface CalendarResponse {
  events: EconomicEvent[];
  lastUpdated: string;
}

// ─── 2026 Economic Calendar (Static, Reliable) ─────────────────────────────

/**
 * Curated 2026 economic calendar with known dates for FOMC, CPI, NFP, GDP, etc.
 * Sources:
 *   - FOMC meeting dates: https://www.federalreserve.gov/fro/fomc.htm
 *   - CPI: Released ~10-12 of each month
 *   - NFP: First Friday of each month
 *   - GDP: Preliminary release ~30 days after quarter-end
 */
function getStaticCalendarEvents(): EconomicEvent[] {
  const baseId = 'cal-2026';
  let eventIndex = 0;

  // Helper to create ISO datetime string
  const mkEvent = (
    name: string,
    month: number,
    day: number,
    hour: number = 8,
    minute: number = 30,
    impact: ImpactLevel,
    category: EventCategory,
    consensus: string | null = null,
    previous: string | null = null,
    actual: string | null = null,
  ): EconomicEvent => {
    const date = new Date();
    date.setFullYear(2026, month - 1, day);
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    return {
      id: `${baseId}-${eventIndex++}`,
      name,
      date: date.toISOString().split('T')[0],
      time: timeStr,
      impact,
      category,
      consensus,
      previous,
      actual,
    };
  };

  const events: EconomicEvent[] = [
    // ─── January 2026 ─────────────────────────────────────────────────

    mkEvent('FOMC Meeting', 1, 27, 18, 0, 'HIGH', 'Fed'),
    mkEvent('PCE Inflation (Dec)', 1, 30, 8, 30, 'HIGH', 'Inflation', '2.5%', '2.4%'),

    // ─── February 2026 ────────────────────────────────────────────────

    mkEvent('NFP (January)', 2, 6, 8, 30, 'HIGH', 'Employment', '210K', '215K'),
    mkEvent('Core Inflation (Jan)', 2, 11, 8, 30, 'HIGH', 'Inflation', '2.8%', '2.7%'),
    mkEvent('CPI (January)', 2, 12, 8, 30, 'HIGH', 'Inflation', '2.6%', '2.5%'),
    mkEvent('Initial Jobless Claims (Feb)', 2, 19, 8, 30, 'MEDIUM', 'Employment', '220K', '215K'),

    // ─── March 2026 ───────────────────────────────────────────────────

    mkEvent('FOMC Meeting', 3, 17, 18, 0, 'HIGH', 'Fed'),
    mkEvent('NFP (February)', 3, 6, 8, 30, 'HIGH', 'Employment', '205K', '210K'),
    mkEvent('CPI (February)', 3, 12, 8, 30, 'HIGH', 'Inflation', '2.4%', '2.6%'),
    mkEvent('Core Inflation (Feb)', 3, 12, 8, 30, 'HIGH', 'Inflation', '2.6%', '2.8%'),
    mkEvent('Retail Sales (Feb)', 3, 13, 8, 30, 'MEDIUM', 'GDP', '0.3%', '0.1%'),
    mkEvent('GDP (Advance Q4)', 3, 26, 8, 30, 'HIGH', 'GDP', '2.1%', '2.5%'),

    // ─── April 2026 ───────────────────────────────────────────────────

    mkEvent('NFP (March)', 4, 3, 8, 30, 'HIGH', 'Employment', '215K', '205K'),
    mkEvent('CPI (March)', 4, 10, 8, 30, 'HIGH', 'Inflation', '2.3%', '2.4%'),
    mkEvent('Core Inflation (Mar)', 4, 10, 8, 30, 'HIGH', 'Inflation', '2.5%', '2.6%'),
    mkEvent('Producer Inflation (Mar)', 4, 15, 8, 30, 'MEDIUM', 'Inflation', '2.1%', '2.2%'),
    mkEvent('FOMC Meeting', 4, 28, 18, 0, 'HIGH', 'Fed'),

    // ─── May 2026 ──────────────────────────────────────────────────────

    mkEvent('NFP (April)', 5, 1, 8, 30, 'HIGH', 'Employment', '220K', '215K'),
    mkEvent('CPI (April)', 5, 12, 8, 30, 'HIGH', 'Inflation', '2.5%', '2.3%'),
    mkEvent('Consumer Sentiment (May)', 5, 15, 9, 55, 'MEDIUM', 'GDP', '98.5', '99.2'),
    mkEvent('Initial Jobless Claims (May)', 5, 21, 8, 30, 'MEDIUM', 'Employment', '225K', '220K'),

    // ─── June 2026 ─────────────────────────────────────────────────────

    mkEvent('FOMC Meeting', 6, 16, 18, 0, 'HIGH', 'Fed'),
    mkEvent('NFP (May)', 6, 5, 8, 30, 'HIGH', 'Employment', '210K', '220K'),
    mkEvent('CPI (May)', 6, 11, 8, 30, 'HIGH', 'Inflation', '2.4%', '2.5%'),
    mkEvent('Core Inflation (May)', 6, 11, 8, 30, 'HIGH', 'Inflation', '2.3%', '2.5%'),
    mkEvent('GDP (Preliminary Q1)', 6, 25, 8, 30, 'HIGH', 'GDP', '2.0%', '2.1%'),

    // ─── July 2026 ─────────────────────────────────────────────────────

    mkEvent('NFP (June)', 7, 2, 8, 30, 'HIGH', 'Employment', '215K', '210K'),
    mkEvent('CPI (June)', 7, 10, 8, 30, 'HIGH', 'Inflation', '2.3%', '2.4%'),
    mkEvent('Core Inflation (Jun)', 7, 10, 8, 30, 'HIGH', 'Inflation', '2.4%', '2.3%'),
    mkEvent('FOMC Meeting', 7, 28, 18, 0, 'HIGH', 'Fed'),

    // ─── August 2026 ────────────────────────────────────────────────────

    mkEvent('NFP (July)', 8, 7, 8, 30, 'HIGH', 'Employment', '220K', '215K'),
    mkEvent('CPI (July)', 8, 12, 8, 30, 'HIGH', 'Inflation', '2.5%', '2.3%'),
    mkEvent('Initial Jobless Claims (Aug)', 8, 19, 8, 30, 'MEDIUM', 'Employment', '230K', '225K'),

    // ─── September 2026 ───────────────────────────────────────────────

    mkEvent('FOMC Meeting', 9, 22, 18, 0, 'HIGH', 'Fed'),
    mkEvent('NFP (August)', 9, 4, 8, 30, 'HIGH', 'Employment', '205K', '220K'),
    mkEvent('CPI (August)', 9, 11, 8, 30, 'HIGH', 'Inflation', '2.2%', '2.5%'),
    mkEvent('Core Inflation (Aug)', 9, 11, 8, 30, 'HIGH', 'Inflation', '2.2%', '2.4%'),
    mkEvent('GDP (Preliminary Q2)', 9, 30, 8, 30, 'HIGH', 'GDP', '2.2%', '2.0%'),

    // ─── October 2026 ──────────────────────────────────────────────────

    mkEvent('NFP (September)', 10, 2, 8, 30, 'HIGH', 'Employment', '210K', '205K'),
    mkEvent('CPI (September)', 10, 13, 8, 30, 'HIGH', 'Inflation', '2.4%', '2.2%'),
    mkEvent('Core Inflation (Sep)', 10, 13, 8, 30, 'HIGH', 'Inflation', '2.5%', '2.2%'),
    mkEvent('Initial Jobless Claims (Oct)', 10, 21, 8, 30, 'MEDIUM', 'Employment', '235K', '230K'),

    // ─── November 2026 ────────────────────────────────────────────────

    mkEvent('FOMC Meeting', 11, 3, 18, 0, 'HIGH', 'Fed'),
    mkEvent('NFP (October)', 11, 6, 8, 30, 'HIGH', 'Employment', '215K', '210K'),
    mkEvent('CPI (October)', 11, 12, 8, 30, 'HIGH', 'Inflation', '2.3%', '2.4%'),
    mkEvent('Core Inflation (Oct)', 11, 12, 8, 30, 'HIGH', 'Inflation', '2.3%', '2.5%'),
    mkEvent('Consumer Sentiment (Nov)', 11, 20, 9, 55, 'MEDIUM', 'GDP', '100.0', '98.5'),
    mkEvent('GDP (Preliminary Q3)', 11, 25, 8, 30, 'HIGH', 'GDP', '2.1%', '2.2%'),

    // ─── December 2026 ────────────────────────────────────────────────

    mkEvent('FOMC Meeting', 12, 15, 18, 0, 'HIGH', 'Fed'),
    mkEvent('NFP (November)', 12, 4, 8, 30, 'HIGH', 'Employment', '220K', '215K'),
    mkEvent('CPI (November)', 12, 11, 8, 30, 'HIGH', 'Inflation', '2.6%', '2.3%'),
    mkEvent('Core Inflation (Nov)', 12, 11, 8, 30, 'HIGH', 'Inflation', '2.6%', '2.3%'),
    mkEvent('Durable Goods Orders (Nov)', 12, 23, 8, 30, 'MEDIUM', 'GDP', '1.2%', '0.8%'),
  ];

  return events;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Auth check (optional)
    const userId = await safeAuth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const events = getStaticCalendarEvents();

    const response: CalendarResponse = {
      events,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[Calendar] Unhandled error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to fetch economic calendar' },
      { status: 500 },
    );
  }
}
