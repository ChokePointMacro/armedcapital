/**
 * Shared type exports for ArmedCapital
 *
 * Re-export types from lib modules so components and routes
 * can import from '@/types' instead of reaching into lib internals.
 */

/** User data passed to dashboard components */
export interface UserData {
  id: string;
  email: string;
  name: string;
  [key: string]: any;
}

export type {
  AgentDefinition,
  AuditEvent,
  BudgetCheckResult,
  Notification,
  EvalCheck,
  EvalResult,
} from '@/lib/agentBus';

export type {
  TaskRecommendation,
  TaskQueueResult,
  TimeContext,
} from '@/lib/taskQueue';

export type {
  Anomaly,
  QuoteData,
  ScanResult,
} from '@/lib/anomalyDetector';
