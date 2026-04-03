/**
 * Unit tests for lib/agentBus.ts
 *
 * Tests: agent registry, budget control, audit logging, notifications, evaluations.
 * Run: npx vitest run __tests__/agentBus.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAgents,
  getAgent,
  checkDependencies,
  checkBudget,
  recordSpend,
  getTodaySpend,
  getSpendLedger,
  resetSpendLedger,
  logAuditEvent,
  getAuditLog,
  resetAuditLog,
  addNotification,
  getNotifications,
  markNotificationRead,
  resetNotifications,
  evaluateAgent,
  getFleetStatus,
  AGENT_REGISTRY,
} from '../../src/lib/agentBus';

// ── Agent Registry Tests ─────────────────────────────────────────────────────

describe('Agent Registry', () => {
  it('should return all registered agents', () => {
    const agents = getAgents();
    expect(agents.length).toBeGreaterThanOrEqual(5);
    expect(agents.map((a) => a.id)).toContain('intelligence');
    expect(agents.map((a) => a.id)).toContain('market-scanner');
    expect(agents.map((a) => a.id)).toContain('data-enrichment');
    expect(agents.map((a) => a.id)).toContain('tradingview-relay');
    expect(agents.map((a) => a.id)).toContain('auto-scheduler');
  });

  it('should get agent by ID', () => {
    const agent = getAgent('intelligence');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('Intelligence (ORACLE)');
    expect(agent!.codename).toBe('ORACLE');
    expect(agent!.category).toBe('intelligence');
  });

  it('should return undefined for unknown agent', () => {
    const agent = getAgent('nonexistent-agent');
    expect(agent).toBeUndefined();
  });

  it('should have valid structure for every agent', () => {
    for (const agent of AGENT_REGISTRY) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.codename).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(['intelligence', 'data', 'social', 'execution', 'system']).toContain(agent.category);
      expect(['active', 'degraded', 'offline']).toContain(agent.status);
      expect(agent.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(agent.dependencies.length).toBeGreaterThan(0);
      expect(agent.runEndpoint).toMatch(/^\//);
      expect(agent.evalEndpoint).toMatch(/^\//);

      // Profile
      expect(agent.profile.role).toBeTruthy();
      expect(agent.profile.strengths.length).toBeGreaterThan(0);
      expect(agent.profile.weaknesses.length).toBeGreaterThan(0);

      // Risk
      expect(['low', 'medium', 'high', 'critical']).toContain(agent.risk.level);
      expect(agent.risk.score).toBeGreaterThanOrEqual(0);
      expect(agent.risk.score).toBeLessThanOrEqual(10);
      expect(typeof agent.risk.canPublish).toBe('boolean');
      expect(typeof agent.risk.canSpend).toBe('boolean');
    }
  });

  it('should have unique agent IDs', () => {
    const ids = AGENT_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have unique codenames', () => {
    const codenames = AGENT_REGISTRY.map((a) => a.codename);
    expect(new Set(codenames).size).toBe(codenames.length);
  });

  it('BROADCASTER should be the only agent that can publish externally', () => {
    const publishers = AGENT_REGISTRY.filter((a) => a.risk.canPublish);
    expect(publishers.length).toBe(1);
    expect(publishers[0].codename).toBe('BROADCASTER');
    expect(publishers[0].risk.level).toBe('critical');
  });
});

// ── Dependency Checks ────────────────────────────────────────────────────────

describe('Dependency Checks', () => {
  it('should report missing deps when env vars are not set', () => {
    const agent = getAgent('intelligence')!;
    const result = checkDependencies(agent);
    // In test env, ANTHROPIC_API_KEY and SUPABASE_URL are probably not set
    expect(result.total).toBe(agent.dependencies.length);
    expect(typeof result.healthy).toBe('boolean');
    expect(typeof result.configured).toBe('number');
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it('should return healthy when all deps are present', () => {
    // Mock env vars
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      ANTHROPIC_API_KEY: 'test-key',
      SUPABASE_URL: 'https://test.supabase.co',
    };

    const agent = getAgent('intelligence')!;
    const result = checkDependencies(agent);
    expect(result.healthy).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.configured).toBe(result.total);

    process.env = originalEnv;
  });
});

// ── Budget Control ───────────────────────────────────────────────────────────

describe('Budget Control', () => {
  beforeEach(() => {
    resetSpendLedger();
  });

  it('should allow spend within budget', () => {
    const result = checkBudget('intelligence', 'intelligence', 0.10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
    expect(result.spent).toBe(0);
    expect(result.limit).toBe(5.0);
  });

  it('should block spend over budget', () => {
    // Spend the full budget
    recordSpend('intelligence', 'intelligence', 5.0);

    const result = checkBudget('intelligence', 'intelligence', 0.01);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.spent).toBe(5.0);
    expect(result.reason).toContain('exceeded');
  });

  it('should track spend across multiple records', () => {
    recordSpend('intelligence', 'intelligence', 1.0);
    recordSpend('intelligence', 'intelligence', 1.5);
    recordSpend('intelligence', 'intelligence', 0.5);

    const total = getTodaySpend('intelligence');
    expect(total).toBe(3.0);

    const budget = checkBudget('intelligence', 'intelligence', 0.10);
    expect(budget.spent).toBe(3.0);
    expect(budget.remaining).toBe(2.0);
    expect(budget.allowed).toBe(true);
  });

  it('should track spend per agent independently', () => {
    recordSpend('intelligence', 'intelligence', 2.0);
    recordSpend('market-scanner', 'data', 0.5);

    expect(getTodaySpend('intelligence')).toBe(2.0);
    expect(getTodaySpend('market-scanner')).toBe(0.5);
  });

  it('should use default limit for unknown categories', () => {
    const result = checkBudget('test-agent', 'unknown-category', 0.10);
    expect(result.limit).toBe(2.0); // default limit
  });

  it('should return spend ledger entries', () => {
    recordSpend('intelligence', 'intelligence', 1.0);
    recordSpend('market-scanner', 'data', 0.5);

    const ledger = getSpendLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[0].agentId).toBe('intelligence');
    expect(ledger[0].amount).toBe(1.0);
    expect(ledger[1].agentId).toBe('market-scanner');
  });

  it('should reset spend ledger', () => {
    recordSpend('intelligence', 'intelligence', 1.0);
    expect(getSpendLedger()).toHaveLength(1);

    resetSpendLedger();
    expect(getSpendLedger()).toHaveLength(0);
  });

  it('should allow zero-cost operations without budget impact', () => {
    const result = checkBudget('market-scanner', 'data', 0);
    expect(result.allowed).toBe(true);
  });
});

// ── Audit Logging ────────────────────────────────────────────────────────────

describe('Audit Logging', () => {
  beforeEach(() => {
    resetAuditLog();
  });

  it('should log audit events', async () => {
    const event = await logAuditEvent({
      type: 'task_execution',
      agentId: 'intelligence',
      action: 'Test audit event',
    });

    expect(event.type).toBe('task_execution');
    expect(event.agentId).toBe('intelligence');
    expect(event.timestamp).toBeTruthy();
  });

  it('should retrieve audit log', async () => {
    await logAuditEvent({ type: 'task_execution', agentId: 'intelligence', action: 'Event 1' });
    await logAuditEvent({ type: 'error', agentId: 'market-scanner', action: 'Event 2' });
    await logAuditEvent({ type: 'task_execution', agentId: 'intelligence', action: 'Event 3' });

    const all = getAuditLog();
    expect(all).toHaveLength(3);

    const filtered = getAuditLog('intelligence');
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.agentId === 'intelligence')).toBe(true);
  });

  it('should respect limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await logAuditEvent({ type: 'task_execution', agentId: 'test', action: `Event ${i}` });
    }

    const limited = getAuditLog(undefined, 3);
    expect(limited).toHaveLength(3);
  });

  it('should auto-add timestamp', async () => {
    const event = await logAuditEvent({
      type: 'task_execution',
      agentId: 'test',
      action: 'No timestamp provided',
    });
    expect(event.timestamp).toBeTruthy();
    expect(new Date(event.timestamp!).getTime()).toBeGreaterThan(0);
  });

  it('should preserve provided timestamp', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const event = await logAuditEvent({
      type: 'task_execution',
      agentId: 'test',
      action: 'Custom timestamp',
      timestamp: ts,
    });
    expect(event.timestamp).toBe(ts);
  });
});

// ── Notifications ────────────────────────────────────────────────────────────

describe('Notifications', () => {
  beforeEach(() => {
    resetNotifications();
  });

  it('should add notifications', () => {
    const notif = addNotification({
      type: 'task_completed',
      title: 'Test',
      message: 'Test notification',
      agentId: 'intelligence',
      severity: 'success',
    });

    expect(notif.id).toBeTruthy();
    expect(notif.timestamp).toBeTruthy();
    expect(notif.read).toBe(false);
  });

  it('should retrieve notifications newest first', () => {
    addNotification({ type: 'task_completed', title: 'First', message: '1', agentId: 'a', severity: 'info' });
    addNotification({ type: 'task_completed', title: 'Second', message: '2', agentId: 'b', severity: 'info' });
    addNotification({ type: 'task_completed', title: 'Third', message: '3', agentId: 'a', severity: 'info' });

    const all = getNotifications();
    expect(all).toHaveLength(3);
    expect(all[0].title).toBe('Third'); // newest first

    const filtered = getNotifications('a');
    expect(filtered).toHaveLength(2);
  });

  it('should mark notifications as read', () => {
    const notif = addNotification({
      type: 'task_completed',
      title: 'Read me',
      message: 'test',
      agentId: 'test',
      severity: 'info',
    });

    expect(notif.read).toBe(false);
    const success = markNotificationRead(notif.id!);
    expect(success).toBe(true);

    const updated = getNotifications();
    expect(updated[0].read).toBe(true);
  });

  it('should return false for unknown notification ID', () => {
    const success = markNotificationRead('nonexistent');
    expect(success).toBe(false);
  });
});

// ── Agent Evaluation ─────────────────────────────────────────────────────────

describe('Agent Evaluation', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
  });

  it('should evaluate a known agent', () => {
    const result = evaluateAgent('intelligence');
    expect(result.agentId).toBe('intelligence');
    expect(result.agentName).toBe('Intelligence (ORACLE)');
    expect(result.timestamp).toBeTruthy();
    expect(result.checks.length).toBeGreaterThanOrEqual(4);
    expect(typeof result.healthy).toBe('boolean');
    expect(result.summary).toBeTruthy();
  });

  it('should fail evaluation for unknown agent', () => {
    const result = evaluateAgent('nonexistent');
    expect(result.healthy).toBe(false);
    expect(result.checks[0].check).toBe('Agent exists');
    expect(result.checks[0].passed).toBe(false);
  });

  it('should detect budget exhaustion in eval', () => {
    recordSpend('intelligence', 'intelligence', 5.0); // exhaust budget
    const result = evaluateAgent('intelligence');
    const budgetCheck = result.checks.find((c) => c.check === 'Budget available');
    expect(budgetCheck).toBeDefined();
    expect(budgetCheck!.passed).toBe(false);
  });

  it('should detect recent errors in eval', async () => {
    await logAuditEvent({
      type: 'error',
      agentId: 'intelligence',
      action: 'Test error',
    });

    const result = evaluateAgent('intelligence');
    const errorCheck = result.checks.find((c) => c.check === 'No recent errors');
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.passed).toBe(false);
  });

  it('should pass risk check for low-risk agents', () => {
    const result = evaluateAgent('tradingview-relay'); // risk score 1
    const riskCheck = result.checks.find((c) => c.check === 'Risk within bounds');
    expect(riskCheck).toBeDefined();
    expect(riskCheck!.passed).toBe(true);
  });

  it('should check all 5 evaluation criteria', () => {
    const result = evaluateAgent('intelligence');
    const checkNames = result.checks.map((c) => c.check);
    expect(checkNames).toContain('Dependencies configured');
    expect(checkNames).toContain('Budget available');
    expect(checkNames).toContain('Agent status');
    expect(checkNames).toContain('Risk within bounds');
    expect(checkNames).toContain('No recent errors');
  });
});

// ── Fleet Status ─────────────────────────────────────────────────────────────

describe('Fleet Status', () => {
  it('should return full fleet with health data', () => {
    const fleet = getFleetStatus();
    expect(fleet.total).toBe(AGENT_REGISTRY.length);
    expect(fleet.agents.length).toBe(AGENT_REGISTRY.length);
    expect(typeof fleet.healthy).toBe('number');
    expect(typeof fleet.degraded).toBe('number');
    expect(fleet.healthy + fleet.degraded).toBe(fleet.total);
    expect(fleet.checkedAt).toBeTruthy();
  });

  it('should include dependency info per agent', () => {
    const fleet = getFleetStatus();
    for (const agent of fleet.agents) {
      expect(typeof agent.depsHealthy).toBe('boolean');
      expect(typeof agent.depsTotal).toBe('number');
      expect(typeof agent.depsConfigured).toBe('number');
      expect(Array.isArray(agent.missingDeps)).toBe(true);
    }
  });
});
