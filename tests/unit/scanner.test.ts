/**
 * Unit tests for /api/scanner anomaly detection engine.
 *
 * Tests the pure detectAnomalies() function with mock data.
 * Run: npx vitest run __tests__/scanner.test.ts
 */

import { describe, it, expect } from 'vitest';
import { detectAnomalies, Anomaly } from '../../src/lib/anomalyDetector';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQuote(symbol: string, overrides: Record<string, any> = {}) {
  return {
    symbol,
    price: 100,
    change: 0,
    changePct: 0,
    volume: 1000000,
    avgVolume: 1000000,
    ...overrides,
  };
}

function makeCryptoData(overrides: Record<string, any> = {}) {
  return {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    current_price: 87000,
    market_cap: 1700000000000,
    total_volume: 35000000000,
    price_change_percentage_24h: 1.5,
    market_cap_change_percentage_24h: 1.2,
    ...overrides,
  };
}

// ── Volume Spike Tests ───────────────────────────────────────────────────────

describe('Volume Spike Detection', () => {
  it('should detect 2x volume spike as medium severity', () => {
    const quotes = [makeQuote('SPY', { volume: 2500000, avgVolume: 1000000 })];
    const anomalies = detectAnomalies(quotes, [], null);

    const spike = anomalies.find((a) => a.type === 'volume_spike');
    expect(spike).toBeDefined();
    expect(spike!.severity).toBe('medium');
    expect(spike!.asset).toBe('SPY');
    expect(spike!.value).toBe(2.5);
  });

  it('should detect 3x volume spike as high severity', () => {
    const quotes = [makeQuote('QQQ', { volume: 3500000, avgVolume: 1000000 })];
    const anomalies = detectAnomalies(quotes, [], null);

    const spike = anomalies.find((a) => a.type === 'volume_spike');
    expect(spike).toBeDefined();
    expect(spike!.severity).toBe('high');
  });

  it('should detect 4x volume spike as critical severity', () => {
    const quotes = [makeQuote('VIX', { volume: 5000000, avgVolume: 1000000 })];
    const anomalies = detectAnomalies(quotes, [], null);

    const spike = anomalies.find((a) => a.type === 'volume_spike');
    expect(spike).toBeDefined();
    expect(spike!.severity).toBe('critical');
  });

  it('should NOT flag normal volume', () => {
    const quotes = [makeQuote('SPY', { volume: 1200000, avgVolume: 1000000 })];
    const anomalies = detectAnomalies(quotes, [], null);

    const spikes = anomalies.filter((a) => a.type === 'volume_spike');
    expect(spikes).toHaveLength(0);
  });

  it('should handle zero avgVolume gracefully', () => {
    const quotes = [makeQuote('SPY', { volume: 1000000, avgVolume: 0 })];
    const anomalies = detectAnomalies(quotes, [], null);
    const spikes = anomalies.filter((a) => a.type === 'volume_spike');
    expect(spikes).toHaveLength(0); // no division by zero crash
  });
});

// ── Crypto Price Move Tests ──────────────────────────────────────────────────

describe('Crypto Price Move Detection', () => {
  it('should detect >3% crypto move as low severity', () => {
    const crypto = [makeCryptoData({ price_change_percentage_24h: 3.5 })];
    const anomalies = detectAnomalies([], crypto, null);

    const move = anomalies.find((a) => a.type === 'price_move');
    expect(move).toBeDefined();
    expect(move!.severity).toBe('low');
  });

  it('should detect >5% crypto move as medium severity', () => {
    const crypto = [makeCryptoData({ price_change_percentage_24h: -6.0 })];
    const anomalies = detectAnomalies([], crypto, null);

    const move = anomalies.find((a) => a.type === 'price_move');
    expect(move).toBeDefined();
    expect(move!.severity).toBe('medium');
  });

  it('should detect >7% crypto move as high severity', () => {
    const crypto = [makeCryptoData({ price_change_percentage_24h: 8.0 })];
    const anomalies = detectAnomalies([], crypto, null);

    const move = anomalies.find((a) => a.type === 'price_move');
    expect(move).toBeDefined();
    expect(move!.severity).toBe('high');
  });

  it('should detect >10% crypto move as critical severity', () => {
    const crypto = [makeCryptoData({ price_change_percentage_24h: -12.0 })];
    const anomalies = detectAnomalies([], crypto, null);

    const move = anomalies.find((a) => a.type === 'price_move');
    expect(move).toBeDefined();
    expect(move!.severity).toBe('critical');
  });

  it('should NOT flag crypto move under 3%', () => {
    const crypto = [makeCryptoData({ price_change_percentage_24h: 2.5 })];
    const anomalies = detectAnomalies([], crypto, null);

    const moves = anomalies.filter((a) => a.type === 'price_move');
    expect(moves).toHaveLength(0);
  });

  it('should detect multiple crypto anomalies', () => {
    const crypto = [
      makeCryptoData({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', price_change_percentage_24h: 5.0 }),
      makeCryptoData({ id: 'ethereum', symbol: 'eth', name: 'Ethereum', price_change_percentage_24h: -8.0 }),
      makeCryptoData({ id: 'solana', symbol: 'sol', name: 'Solana', price_change_percentage_24h: 1.0 }),
    ];
    const anomalies = detectAnomalies([], crypto, null);

    const moves = anomalies.filter((a) => a.type === 'price_move');
    expect(moves).toHaveLength(2); // BTC 5% and ETH 8%, SOL 1% excluded
  });
});

// ── Fear & Greed Swing Tests ─────────────────────────────────────────────────

describe('Fear & Greed Swing Detection', () => {
  it('should detect 10+ point swing as medium severity', () => {
    const fg = { value: 65, classification: 'Greed' };
    const anomalies = detectAnomalies([], [], fg, 50);

    const swing = anomalies.find((a) => a.type === 'sentiment_swing');
    expect(swing).toBeDefined();
    expect(swing!.severity).toBe('medium');
    expect(swing!.value).toBe(15);
  });

  it('should detect 20+ point swing as high severity', () => {
    const fg = { value: 80, classification: 'Extreme Greed' };
    const anomalies = detectAnomalies([], [], fg, 55);

    const swing = anomalies.find((a) => a.type === 'sentiment_swing');
    expect(swing).toBeDefined();
    expect(swing!.severity).toBe('high');
  });

  it('should NOT flag small Fear & Greed changes', () => {
    const fg = { value: 55, classification: 'Greed' };
    const anomalies = detectAnomalies([], [], fg, 50);

    const swings = anomalies.filter((a) => a.type === 'sentiment_swing');
    expect(swings).toHaveLength(0);
  });

  it('should handle null Fear & Greed gracefully', () => {
    const anomalies = detectAnomalies([], [], null);
    const swings = anomalies.filter((a) => a.type === 'sentiment_swing');
    expect(swings).toHaveLength(0);
  });
});

// ── BTC Dominance Shift Tests ────────────────────────────────────────────────

describe('BTC Dominance Shift Detection', () => {
  it('should detect significant BTC MCap shift', () => {
    const crypto = [
      makeCryptoData({ market_cap: 1700000000000, market_cap_change_percentage_24h: 3.0 }),
      makeCryptoData({ id: 'ethereum', symbol: 'eth', market_cap: 400000000000, market_cap_change_percentage_24h: 0.5, price_change_percentage_24h: 0 }),
    ];
    const anomalies = detectAnomalies([], crypto, null);

    const shift = anomalies.find((a) => a.type === 'dominance_shift');
    expect(shift).toBeDefined();
    expect(shift!.asset).toBe('BTC');
  });

  it('should NOT flag small dominance changes', () => {
    const crypto = [
      makeCryptoData({ market_cap_change_percentage_24h: 0.5 }),
    ];
    const anomalies = detectAnomalies([], crypto, null);

    const shifts = anomalies.filter((a) => a.type === 'dominance_shift');
    expect(shifts).toHaveLength(0);
  });
});

// ── Equity/Macro Price Move Tests ────────────────────────────────────────────

describe('Equity Price Move Detection', () => {
  it('should detect >2% equity move', () => {
    const quotes = [makeQuote('^VIX', { changePct: 8.5 })];
    const anomalies = detectAnomalies(quotes, [], null);

    const move = anomalies.find((a) => a.type === 'price_move' && a.asset === '^VIX');
    expect(move).toBeDefined();
    expect(move!.severity).toBe('critical'); // 8.5% is critical
  });

  it('should NOT flag crypto symbols as equity moves', () => {
    // Crypto symbols contain '-USD', equity check excludes those
    const quotes = [makeQuote('BTC-USD', { changePct: 5.0 })];
    const anomalies = detectAnomalies(quotes, [], null);

    const equityMoves = anomalies.filter((a) => a.type === 'price_move');
    expect(equityMoves).toHaveLength(0); // BTC-USD is excluded from equity moves
  });
});

// ── Sorting Tests ────────────────────────────────────────────────────────────

describe('Anomaly Sorting', () => {
  it('should sort anomalies by severity: critical > high > medium > low', () => {
    const quotes = [
      makeQuote('SPY', { volume: 2500000, avgVolume: 1000000, changePct: 0 }), // medium volume spike
    ];
    const crypto = [
      makeCryptoData({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', price_change_percentage_24h: 12.0 }), // critical
      makeCryptoData({ id: 'ethereum', symbol: 'eth', name: 'Ethereum', price_change_percentage_24h: 3.5, market_cap: 400000000000, market_cap_change_percentage_24h: 0 }), // low
    ];

    const anomalies = detectAnomalies(quotes, crypto, null);

    // Verify critical comes before others
    if (anomalies.length >= 2) {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 1; i < anomalies.length; i++) {
        expect(severityOrder[anomalies[i].severity]).toBeGreaterThanOrEqual(
          severityOrder[anomalies[i - 1].severity]
        );
      }
    }
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('should handle empty inputs gracefully', () => {
    const anomalies = detectAnomalies([], [], null);
    expect(anomalies).toHaveLength(0);
  });

  it('should handle missing fields in crypto data', () => {
    const crypto = [{ id: 'unknown', symbol: 'unk' }]; // minimal data
    const anomalies = detectAnomalies([], crypto, null);
    // Should not crash
    expect(Array.isArray(anomalies)).toBe(true);
  });

  it('should generate unique IDs for each anomaly', () => {
    const crypto = [
      makeCryptoData({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', price_change_percentage_24h: 5.0 }),
      makeCryptoData({ id: 'ethereum', symbol: 'eth', name: 'Ethereum', price_change_percentage_24h: 6.0 }),
    ];
    const anomalies = detectAnomalies([], crypto, null);

    const ids = anomalies.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
