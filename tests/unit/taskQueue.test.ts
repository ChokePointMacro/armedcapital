/**
 * Unit + Integration tests for lib/taskQueue.ts
 *
 * Tests: time context, task generation, filtering, cooldowns, prompt hydration,
 * agent readiness, and full queue lifecycle.
 *
 * Run: npx vitest run __tests__/taskQueue.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTimeContext,
  generateTaskQueue,
  getResponsibilities,
  getTaskDefinition,
  getAgentTaskIds,
  type TimeContext,
  type TaskRecommendation,
} from '../../src/lib/taskQueue';
import {
  resetSpendLedger,
  resetAuditLog,
  resetNotifications,
  recordSpend,
  getAgents,
} from '../../src/lib/agentBus';

// ── Time Context Tests ───────────────────────────────────────────────────────

describe('Time Context', () => {
  it('should detect pre-market on a Tuesday morning (7am ET)', () => {
    // Tuesday 7am ET = Tuesday 12:00 UTC (during EST, UTC-5)
    const d = new Date('2026-01-06T12:00:00Z'); // Tuesday in January (EST)
    const ctx = getTimeContext(d);
    expect(ctx.timeOfDay).toBe('pre_market');
    expect(ctx.isWeekday).toBe(true);
    expect(ctx.isWeekend).toBe(false);
    expect(ctx.dayName).toBe('Tuesday');
  });

  it('should detect market hours on a Wednesday afternoon (1pm ET)', () => {
    // Wednesday 1pm ET = Wednesday 18:00 UTC (EST)
    const d = new Date('2026-01-07T18:00:00Z');
    const ctx = getTimeContext(d);
    expect(ctx.timeOfDay).toBe('market_hours');
    expect(ctx.isMarketOpen).toBe(true);
  });

  it('should detect after-hours on Friday (5pm ET)', () => {
    // Friday 5pm ET = Friday 22:00 UTC (EST)
    const d = new Date('2026-01-09T22:00:00Z');
    const ctx = getTimeContext(d);
    expect(ctx.timeOfDay).toBe('after_hours');
    expect(ctx.dayName).toBe('Friday');
  });

  it('should detect weekend correctly', () => {
    // Saturday 10am ET = Saturday 15:00 UTC (EST)
    const d = new Date('2026-01-10T15:00:00Z');
    const ctx = getTimeContext(d);
    expect(ctx.isWeekend).toBe(true);
    expect(ctx.isWeekday).toBe(false);
    expect(ctx.isMarketOpen).toBe(false);
  });

  it('should detect evening time', () => {
    // Monday 9pm ET = Tuesday 02:00 UTC (EST)
    const d = new Date('2026-01-06T02:00:00Z'); // This is actually Monday 9pm ET
    // Wait, 02:00 UTC - 5 = 21:00 ET (9pm) on Monday Jan 5
    const ctx = getTimeContext(d);
    expect(ctx.timeOfDay).toBe('evening');
  });

  it('should detect overnight', () => {
    // 2am ET = 07:00 UTC (EST)
    const d = new Date('2026-01-06T07:00:00Z');
    const ctx = getTimeContext(d);
    expect(ctx.timeOfDay).toBe('overnight');
  });
});

// ── Responsibility Definitions ───────────────────────────────────────────────

describe('Responsibility Definitions', () => {
  it('should have responsibilities for all 5 agents', () => {
    const resps = getResponsibilities();
    const agentIds = resps.map((r) => r.agentId);
    expect(agentIds).toContain('intelligence');
    expect(agentIds).toContain('market-scanner');
    expect(agentIds).toContain('data-enrichment');
    expect(agentIds).toContain('tradingview-relay');
    expect(agentIds).toContain('auto-scheduler');
  });

  it('should have at least one task per agent', () => {
    const resps = getResponsibilities();
    for (const r of resps) {
      expect(r.tasks.length).toBeGreaterThan(0);
    }
  });

  it('should have valid structure for all task definitions', () => {
    const resps = getResponsibilities();
    for (const r of resps) {
      for (const task of r.tasks) {
        expect(task.id).toBeTruthy();
        expect(task.title).toBeTruthy();
        expect(task.description).toBeTruthy();
        expect(task.promptTemplate).toBeTruthy();
        expect(['low', 'medium', 'high', 'critical']).toContain(task.priority);
        expect(task.estimatedCost).toMatch(/^\$/);
        expect(task.tags.length).toBeGreaterThan(0);
        expect(task.cooldownMinutes).toBeGreaterThan(0);
        expect(typeof task.conditions).toBe('function');
      }
    }
  });

  it('should have unique task IDs across all agents', () => {
    const resps = getResponsibilities();
    const allIds = resps.flatMap((r) => r.tasks.map((t) => t.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('ORACLE should have the most tasks (intelligence is the heaviest agent)', () => {
    const resps = getResponsibilities();
    const oracle = resps.find((r) => r.agentId === 'intelligence')!;
    const others = resps.filter((r) => r.agentId !== 'intelligence');
    for (const other of others) {
      expect(oracle.tasks.length).toBeGreaterThanOrEqual(other.tasks.length);
    }
  });
});

// ── Task Definition Lookups ──────────────────────────────────────────────────

describe('Task Definition Lookups', () => {
  it('should find task by ID', () => {
    const task = getTaskDefinition('morning-brief');
    expect(task).toBeDefined();
    expect(task!.agentId).toBe('intelligence');
    expect(task!.title).toBe('Morning Macro Intelligence Brief');
  });

  it('should return null for unknown task ID', () => {
    const task = getTaskDefinition('nonexistent-task');
    expect(task).toBeNull();
  });

  it('should get all task IDs for an agent', () => {
    const ids = getAgentTaskIds('intelligence');
    expect(ids).toContain('morning-brief');
    expect(ids).toContain('weekly-risk-assessment');
    expect(ids).toContain('btc-confluence');
    expect(ids).toContain('rnd-pipeline');
  });

  it('should return empty array for unknown agent', () => {
    const ids = getAgentTaskIds('nonexistent');
    expect(ids).toHaveLength(0);
  });
});

// ── Task Queue Generation ────────────────────────────────────────────────────

describe('Task Queue Generation', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
    resetNotifications();
  });

  it('should generate tasks for a Tuesday pre-market window', () => {
    // Tuesday 7:30am ET = 12:30 UTC in January (EST)
    const now = new Date('2026-01-06T12:30:00Z');
    const queue = generateTaskQueue({ now });

    expect(queue.tasks.length).toBeGreaterThan(0);
    expect(queue.context.timeOfDay).toBe('pre_market');
    expect(queue.context.isWeekday).toBe(true);
    expect(queue.generatedAt).toBeTruthy();

    // Should include morning brief and anomaly scan at minimum
    const titles = queue.tasks.map((t) => t.title);
    expect(titles).toContain('Morning Macro Intelligence Brief');
    expect(titles).toContain('Daily Market Anomaly Scan');
  });

  it('should generate tasks for Friday after-hours', () => {
    // Friday 5:30pm ET = 22:30 UTC in January (EST)
    const now = new Date('2026-01-09T22:30:00Z');
    const queue = generateTaskQueue({ now });

    expect(queue.context.timeOfDay).toBe('after_hours');

    // Should include weekly tasks triggered on Friday
    const titles = queue.tasks.map((t) => t.title);
    expect(titles).toContain('Weekly FRED Rate Decision Analysis');
    expect(titles).toContain('Weekly Portfolio Risk Assessment');
  });

  it('should generate tasks for Sunday afternoon', () => {
    // Sunday 4pm ET = 21:00 UTC in January (EST)
    const now = new Date('2026-01-11T21:00:00Z');
    const queue = generateTaskQueue({ now });

    expect(queue.context.isWeekend).toBe(true);

    // Should include BTC confluence and social review
    const titles = queue.tasks.map((t) => t.title);
    expect(titles).toContain('BTC Confluence Signal Report');
    expect(titles).toContain('Weekly Social Performance Review');
  });

  it('should return empty queue during overnight when no conditions match', () => {
    // Tuesday 3am ET = 08:00 UTC in January (EST)
    const now = new Date('2026-01-06T08:00:00Z');
    const queue = generateTaskQueue({ now });

    expect(queue.context.timeOfDay).toBe('overnight');
    // Might be empty or very few tasks
    expect(queue.tasks.length).toBeLessThanOrEqual(2);
  });

  it('forceAll should return all tasks regardless of time', () => {
    const now = new Date('2026-01-06T08:00:00Z'); // overnight
    const queue = generateTaskQueue({ now, forceAll: true });

    // Should have all defined tasks
    const resps = getResponsibilities();
    const totalTaskDefs = resps.reduce((s, r) => s + r.tasks.length, 0);
    expect(queue.tasks.length).toBe(totalTaskDefs);
  });
});

// ── Filtering ────────────────────────────────────────────────────────────────

describe('Filtering', () => {
  it('should filter by agent ID', () => {
    const queue = generateTaskQueue({
      forceAll: true,
      agentFilter: 'intelligence',
    });

    expect(queue.tasks.length).toBeGreaterThan(0);
    expect(queue.tasks.every((t) => t.agentId === 'intelligence')).toBe(true);
  });

  it('should filter by tags', () => {
    const queue = generateTaskQueue({
      forceAll: true,
      tagFilter: ['weekly'],
    });

    expect(queue.tasks.length).toBeGreaterThan(0);
    expect(queue.tasks.every((t) => t.tags.includes('weekly'))).toBe(true);
  });

  it('should combine agent and tag filters', () => {
    const queue = generateTaskQueue({
      forceAll: true,
      agentFilter: 'intelligence',
      tagFilter: ['weekly'],
    });

    expect(queue.tasks.length).toBeGreaterThan(0);
    expect(queue.tasks.every((t) => t.agentId === 'intelligence' && t.tags.includes('weekly'))).toBe(true);
  });

  it('should return empty for non-matching filters', () => {
    const queue = generateTaskQueue({
      forceAll: true,
      tagFilter: ['nonexistent-tag'],
    });

    expect(queue.tasks).toHaveLength(0);
  });
});

// ── Prompt Hydration ─────────────────────────────────────────────────────────

describe('Prompt Hydration', () => {
  it('should replace {date} placeholder with actual date', () => {
    const now = new Date('2026-03-25T15:00:00Z');
    const queue = generateTaskQueue({ now, forceAll: true });

    for (const task of queue.tasks) {
      expect(task.prompt).not.toContain('{date}');
      expect(task.prompt).toContain('2026-03-25');
    }
  });

  it('should replace {time} placeholder with actual time', () => {
    const now = new Date('2026-03-25T15:00:00Z');
    const queue = generateTaskQueue({ now, forceAll: true });

    for (const task of queue.tasks) {
      expect(task.prompt).not.toContain('{time}');
    }
  });

  it('should produce non-empty prompts for all tasks', () => {
    const queue = generateTaskQueue({ forceAll: true });

    for (const task of queue.tasks) {
      expect(task.prompt.length).toBeGreaterThan(100);
    }
  });
});

// ── Cooldowns ────────────────────────────────────────────────────────────────

describe('Cooldowns', () => {
  it('should skip tasks within cooldown window', () => {
    const now = new Date('2026-01-06T12:30:00Z'); // Tuesday pre-market

    // First run — should include morning brief
    const queue1 = generateTaskQueue({ now });
    const hasBrief1 = queue1.tasks.some((t) => t.title.includes('Morning'));
    expect(hasBrief1).toBe(true);

    // Second run with lastRunTimes showing it just ran
    const queue2 = generateTaskQueue({
      now,
      lastRunTimes: {
        'morning-brief': new Date(now.getTime() - 30 * 60000).toISOString(), // 30 min ago
      },
    });
    const hasBrief2 = queue2.tasks.some((t) => t.title.includes('Morning'));
    expect(hasBrief2).toBe(false); // should be skipped (cooldown is 720 min)
  });

  it('should include tasks past cooldown window', () => {
    const now = new Date('2026-01-06T12:30:00Z');

    const queue = generateTaskQueue({
      now,
      lastRunTimes: {
        'morning-brief': new Date(now.getTime() - 800 * 60000).toISOString(), // 800 min ago (>720)
      },
    });
    const hasBrief = queue.tasks.some((t) => t.title.includes('Morning'));
    expect(hasBrief).toBe(true);
  });
});

// ── Priority Sorting ─────────────────────────────────────────────────────────

describe('Priority Sorting', () => {
  it('should sort tasks by priority: critical > high > medium > low', () => {
    const queue = generateTaskQueue({ forceAll: true });

    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

    for (let i = 1; i < queue.tasks.length; i++) {
      expect(priorityOrder[queue.tasks[i].priority]).toBeGreaterThanOrEqual(
        priorityOrder[queue.tasks[i - 1].priority]
      );
    }
  });
});

// ── Agent Readiness ──────────────────────────────────────────────────────────

describe('Agent Readiness', () => {
  beforeEach(() => {
    resetSpendLedger();
  });

  it('should report readiness for all agents in queue result', () => {
    const queue = generateTaskQueue({ forceAll: true });
    const agents = getAgents();

    expect(queue.agentReadiness.length).toBe(agents.length);
    for (const ar of queue.agentReadiness) {
      expect(ar.agentId).toBeTruthy();
      expect(ar.codename).toBeTruthy();
      expect(typeof ar.ready).toBe('boolean');
      expect(ar.reason).toBeTruthy();
    }
  });

  it('should mark agent not ready when budget is exhausted', () => {
    // Set env vars so deps pass, then exhaust budget
    const origEnv = process.env;
    process.env = {
      ...origEnv,
      ANTHROPIC_API_KEY: 'test-key',
      SUPABASE_URL: 'https://test.supabase.co',
      FRED_API_KEY: 'test',
      FINNHUB_API_KEY: 'test',
      TWITTER_API_KEY: 'test',
    };

    recordSpend('intelligence', 'intelligence', 5.0);

    const queue = generateTaskQueue({ forceAll: true });
    const oracleReady = queue.agentReadiness.find((a) => a.agentId === 'intelligence');
    expect(oracleReady).toBeDefined();
    expect(oracleReady!.ready).toBe(false);
    expect(oracleReady!.reason).toContain('Budget');

    process.env = origEnv;
  });
});

// ── Queue Stats ──────────────────────────────────────────────────────────────

describe('Queue Stats', () => {
  it('should compute accurate stats', () => {
    const queue = generateTaskQueue({ forceAll: true });

    expect(queue.stats.totalRecommended).toBe(queue.tasks.length);

    // byPriority should sum to total
    const prioritySum = Object.values(queue.stats.byPriority).reduce((s, n) => s + n, 0);
    expect(prioritySum).toBe(queue.stats.totalRecommended);

    // byAgent should sum to total
    const agentSum = Object.values(queue.stats.byAgent).reduce((s, n) => s + n, 0);
    expect(agentSum).toBe(queue.stats.totalRecommended);

    // Cost should be a dollar string
    expect(queue.stats.estimatedTotalCost).toMatch(/^\$/);
  });
});

// ── Task Result Structure ────────────────────────────────────────────────────

describe('Task Recommendation Structure', () => {
  it('should have all required fields on every task', () => {
    const queue = generateTaskQueue({ forceAll: true });

    for (const task of queue.tasks) {
      expect(task.id).toBeTruthy();
      expect(task.agentId).toBeTruthy();
      expect(task.agentName).toBeTruthy();
      expect(task.codename).toBeTruthy();
      expect(task.title).toBeTruthy();
      expect(task.description).toBeTruthy();
      expect(task.prompt).toBeTruthy();
      expect(task.runEndpoint).toMatch(/^\//);
      expect(['low', 'medium', 'high', 'critical']).toContain(task.priority);
      expect(task.category).toBeTruthy();
      expect(task.estimatedCost).toMatch(/^\$/);
      expect(task.reason).toBeTruthy();
      expect(task.conditions.length).toBeGreaterThan(0);
      expect(task.tags.length).toBeGreaterThan(0);
      expect(task.cooldownMinutes).toBeGreaterThan(0);
    }
  });

  it('should generate unique IDs for tasks even from same definition', () => {
    const queue1 = generateTaskQueue({ forceAll: true });
    const queue2 = generateTaskQueue({ forceAll: true });

    const ids1 = new Set(queue1.tasks.map((t) => t.id));
    const ids2 = new Set(queue2.tasks.map((t) => t.id));

    // IDs within each queue should be unique
    expect(ids1.size).toBe(queue1.tasks.length);
    expect(ids2.size).toBe(queue2.tasks.length);

    // IDs between queues should not overlap (they have timestamps)
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }
  });
});

// ── Integration: Full Queue Lifecycle ────────────────────────────────────────

describe('Full Queue Lifecycle', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
    resetNotifications();
  });

  it('should produce actionable queue → simulate execution → verify cooldown', () => {
    // Step 1: Generate queue at Tuesday 8am ET
    const now = new Date('2026-01-06T13:00:00Z');
    const queue = generateTaskQueue({ now });

    expect(queue.tasks.length).toBeGreaterThan(0);

    // Step 2: Pick the first task
    const task = queue.tasks[0];
    expect(task.prompt.length).toBeGreaterThan(100);
    expect(task.runEndpoint).toBeTruthy();

    // Step 3: Simulate execution recording
    const baseTaskId = task.id.replace(/-\d+-[a-z0-9]+$/, '');
    const lastRunTimes: Record<string, string> = {
      [baseTaskId]: now.toISOString(),
    };

    // Step 4: Re-generate queue — the task should be in cooldown
    const queue2 = generateTaskQueue({ now, lastRunTimes });
    const sameTaskAgain = queue2.tasks.find((t) => t.title === task.title);
    expect(sameTaskAgain).toBeUndefined(); // should be filtered by cooldown
  });

  it('should respect budget across the full lifecycle', () => {
    // Exhaust intelligence budget
    recordSpend('intelligence', 'intelligence', 5.0);

    const queue = generateTaskQueue({ forceAll: true });

    // ORACLE should show as not ready
    const oracleReady = queue.agentReadiness.find((a) => a.agentId === 'intelligence');
    expect(oracleReady!.ready).toBe(false);

    // ORACLE tasks should still appear (they're recommendations)
    // but the readiness flag tells the UI not to auto-execute them
    const oracleTasks = queue.tasks.filter((t) => t.agentId === 'intelligence');
    expect(oracleTasks.length).toBeGreaterThan(0);
  });
});
