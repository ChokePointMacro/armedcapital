/**
 * Integration tests for the full agent workflow.
 *
 * Tests the complete pipeline: registry → budget → audit → eval → notifications.
 * These tests validate that all agent bus modules work together correctly.
 *
 * Run: npx vitest run __tests__/integration.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAgent,
  getAgents,
  checkBudget,
  recordSpend,
  resetSpendLedger,
  logAuditEvent,
  getAuditLog,
  resetAuditLog,
  addNotification,
  getNotifications,
  resetNotifications,
  evaluateAgent,
  getFleetStatus,
  checkDependencies,
} from '../../src/lib/agentBus';
import { detectAnomalies } from '../../src/lib/anomalyDetector';

// ── Full Agent Lifecycle ─────────────────────────────────────────────────────

describe('Agent Lifecycle Integration', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
    resetNotifications();
  });

  it('should execute a complete agent task lifecycle', async () => {
    const agentId = 'intelligence';
    const agent = getAgent(agentId)!;

    // Step 1: Pre-flight — check budget
    const budget = checkBudget(agentId, agent.category, 0.10);
    expect(budget.allowed).toBe(true);

    // Step 2: Audit — log task start
    await logAuditEvent({
      type: 'task_execution',
      agentId,
      action: '[GENERATE] Starting intelligence generation',
      details: { opsMode: false },
    });

    // Step 3: Simulate work (in real code, this calls Claude)
    const taskResult = {
      text: 'BTC is trading at $87,000 with bullish momentum...',
      summary: 'Markets are risk-on with BTC leading.',
      tokens: { input: 500, output: 200 },
    };

    // Step 4: Record spend
    const estimatedCost = (taskResult.tokens.input * 0.003 + taskResult.tokens.output * 0.015) / 1000;
    recordSpend(agentId, agent.category, estimatedCost);

    // Step 5: Audit — log completion
    await logAuditEvent({
      type: 'task_execution',
      agentId,
      action: '[GENERATE] Completed intelligence generation',
      details: { cost: estimatedCost },
    });

    // Step 6: Notify
    addNotification({
      type: 'task_completed',
      title: 'ORACLE completed',
      message: taskResult.summary,
      agentId,
      severity: 'success',
      actionUrl: '/agents',
    });

    // Verify the full trail
    const auditEntries = getAuditLog(agentId);
    expect(auditEntries).toHaveLength(2);
    expect(auditEntries[0].action).toContain('Starting');
    expect(auditEntries[1].action).toContain('Completed');

    const notifs = getNotifications(agentId);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('task_completed');

    const budgetAfter = checkBudget(agentId, agent.category, 0);
    expect(budgetAfter.spent).toBeGreaterThan(0);
    expect(budgetAfter.spent).toBe(estimatedCost);
  });

  it('should block task when budget is exhausted', async () => {
    const agentId = 'intelligence';
    const agent = getAgent(agentId)!;

    // Exhaust budget
    recordSpend(agentId, agent.category, 5.0);

    // Try to execute
    const budget = checkBudget(agentId, agent.category, 0.01);
    expect(budget.allowed).toBe(false);

    // Log the block
    await logAuditEvent({
      type: 'budget_check',
      agentId,
      action: `[RUN] Budget blocked: ${budget.reason}`,
    });

    addNotification({
      type: 'budget_warning',
      title: 'Budget exhausted',
      message: budget.reason,
      agentId,
      severity: 'warning',
    });

    // Verify
    const auditEntries = getAuditLog(agentId);
    expect(auditEntries[0].type).toBe('budget_check');
    expect(auditEntries[0].action).toContain('Budget blocked');

    const notifs = getNotifications(agentId);
    expect(notifs[0].type).toBe('budget_warning');
  });

  it('should track errors and degrade agent eval', async () => {
    const agentId = 'market-scanner';

    // Simulate an error
    await logAuditEvent({
      type: 'error',
      agentId,
      action: '[SCANNER] Yahoo Finance API returned 503',
      details: { status: 503 },
    });

    addNotification({
      type: 'task_failed',
      title: 'SPECTRE failed',
      message: 'Yahoo Finance API returned 503',
      agentId,
      severity: 'error',
    });

    // Evaluate — should show the error
    const evalResult = evaluateAgent(agentId);
    const errorCheck = evalResult.checks.find((c) => c.check === 'No recent errors');
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.passed).toBe(false);
    expect(errorCheck!.detail).toContain('1 error');
  });
});

// ── Multi-Agent Ops Simulation ───────────────────────────────────────────────

describe('Multi-Agent Ops Simulation', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
    resetNotifications();
  });

  it('should run daily ops across all agents without cross-contamination', async () => {
    const agents = getAgents();

    for (const agent of agents) {
      // Budget check per agent
      const budget = checkBudget(agent.id, agent.category, 0.01);

      if (budget.allowed) {
        await logAuditEvent({
          type: 'task_execution',
          agentId: agent.id,
          action: `[DAILY OPS] Running ${agent.codename}`,
        });

        // Simulate spend
        recordSpend(agent.id, agent.category, 0.05);

        addNotification({
          type: 'task_completed',
          title: `${agent.codename} daily task`,
          message: `Completed successfully`,
          agentId: agent.id,
          severity: 'success',
        });
      }
    }

    // Verify each agent has its own audit trail
    for (const agent of agents) {
      const agentAudit = getAuditLog(agent.id);
      expect(agentAudit.length).toBeGreaterThanOrEqual(1);
      expect(agentAudit.every((e) => e.agentId === agent.id)).toBe(true);

      const agentNotifs = getNotifications(agent.id);
      expect(agentNotifs.length).toBeGreaterThanOrEqual(1);
      expect(agentNotifs.every((n) => n.agentId === agent.id)).toBe(true);
    }

    // Total notifications should equal number of agents
    const allNotifs = getNotifications();
    expect(allNotifs.length).toBe(agents.length);
  });

  it('should correctly grade agent performance after mixed results', async () => {
    // ORACLE succeeds
    await logAuditEvent({ type: 'task_execution', agentId: 'intelligence', action: 'Success' });
    recordSpend('intelligence', 'intelligence', 0.10);

    // SPECTRE fails
    await logAuditEvent({ type: 'error', agentId: 'market-scanner', action: 'Failed' });

    // MOSAIC succeeds
    await logAuditEvent({ type: 'task_execution', agentId: 'data-enrichment', action: 'Success' });

    // Evaluate fleet
    const oracleEval = evaluateAgent('intelligence');
    const spectreEval = evaluateAgent('market-scanner');
    const mosaicEval = evaluateAgent('data-enrichment');

    // ORACLE: budget spent but no errors → healthy except maybe deps
    const oracleErrors = oracleEval.checks.find((c) => c.check === 'No recent errors');
    expect(oracleErrors!.passed).toBe(true);

    // SPECTRE: has recent errors
    const spectreErrors = spectreEval.checks.find((c) => c.check === 'No recent errors');
    expect(spectreErrors!.passed).toBe(false);

    // MOSAIC: clean
    const mosaicErrors = mosaicEval.checks.find((c) => c.check === 'No recent errors');
    expect(mosaicErrors!.passed).toBe(true);
  });
});

// ── Scanner + AgentBus Integration ───────────────────────────────────────────

describe('Scanner + AgentBus Integration', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
    resetNotifications();
  });

  it('should generate notifications for critical scanner anomalies', () => {
    // Simulate scanner finding critical anomalies
    const crypto = [
      {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        current_price: 87000,
        market_cap: 1700000000000,
        total_volume: 35000000000,
        price_change_percentage_24h: -15.0, // critical crash
        market_cap_change_percentage_24h: -14.0,
      },
    ];

    const anomalies = detectAnomalies([], crypto, null);
    const critical = anomalies.filter((a) => a.severity === 'critical');
    expect(critical.length).toBeGreaterThan(0);

    // In the real route, this would trigger a notification
    if (critical.length > 0) {
      addNotification({
        type: 'system_alert',
        title: `${critical.length} Critical Anomalies Detected`,
        message: critical.map((a) => a.title).join('; '),
        agentId: 'market-scanner',
        severity: 'error',
        actionUrl: '/agents',
      });
    }

    const notifs = getNotifications('market-scanner');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].severity).toBe('error');
    expect(notifs[0].message).toContain('Bitcoin');
  });

  it('should NOT generate notifications for clean scans', () => {
    const anomalies = detectAnomalies([], [], null);
    expect(anomalies).toHaveLength(0);

    // No notification needed
    const notifs = getNotifications('market-scanner');
    expect(notifs).toHaveLength(0);
  });
});

// ── Fleet-Wide Evaluation ────────────────────────────────────────────────────

describe('Fleet-Wide Evaluation', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
  });

  it('should evaluate all agents in the registry', () => {
    const agents = getAgents();
    const results = agents.map((a) => evaluateAgent(a.id));

    expect(results).toHaveLength(agents.length);

    for (const result of results) {
      expect(result.agentId).toBeTruthy();
      expect(result.agentName).toBeTruthy();
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
      expect(typeof result.healthy).toBe('boolean');
    }
  });

  it('should accurately count fleet health in getFleetStatus', () => {
    const fleet = getFleetStatus();
    expect(fleet.total).toBeGreaterThan(0);
    expect(fleet.healthy + fleet.degraded).toBe(fleet.total);
    expect(fleet.checkedAt).toBeTruthy();

    // Every agent should have a valid category
    for (const agent of fleet.agents) {
      expect(['intelligence', 'data', 'social', 'execution', 'system']).toContain(agent.category);
    }
  });
});

// ── Stress / Boundary Tests ──────────────────────────────────────────────────

describe('Stress & Boundary Tests', () => {
  beforeEach(() => {
    resetSpendLedger();
    resetAuditLog();
    resetNotifications();
  });

  it('should handle rapid-fire audit events without crash', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        logAuditEvent({
          type: 'task_execution',
          agentId: `agent-${i % 5}`,
          action: `Rapid event ${i}`,
        })
      );
    }
    await Promise.all(promises);

    // getAuditLog has a default limit of 50
    const all = getAuditLog(undefined, 200);
    expect(all.length).toBe(100);
  });

  it('should handle rapid-fire notifications without crash', () => {
    for (let i = 0; i < 250; i++) {
      addNotification({
        type: 'task_completed',
        title: `Notif ${i}`,
        message: `Message ${i}`,
        agentId: `agent-${i % 5}`,
        severity: 'info',
      });
    }

    // Should be bounded at 200
    const all = getNotifications();
    expect(all.length).toBeLessThanOrEqual(200);
  });

  it('should handle exact budget boundary', () => {
    recordSpend('intelligence', 'intelligence', 4.95);
    const result = checkBudget('intelligence', 'intelligence', 0.01);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeCloseTo(0.05, 2);

    // Spend the rest to exhaust budget
    recordSpend('intelligence', 'intelligence', 0.05);
    const result2 = checkBudget('intelligence', 'intelligence', 0.001);
    expect(result2.allowed).toBe(false);
    expect(result2.remaining).toBe(0);
  });

  it('should produce consistent fleet status across repeated calls', () => {
    const fleet1 = getFleetStatus();
    const fleet2 = getFleetStatus();

    expect(fleet1.total).toBe(fleet2.total);
    expect(fleet1.agents.length).toBe(fleet2.agents.length);
    for (let i = 0; i < fleet1.agents.length; i++) {
      expect(fleet1.agents[i].id).toBe(fleet2.agents[i].id);
    }
  });
});
