/**
 * Shared type exports for ArmedCapital
 *
 * Note: agentBus, taskQueue, and anomalyDetector types are defined
 * locally in the modules that use them. This file provides the
 * shared UserData interface used across the dashboard.
 */

/** User data passed to dashboard components */
export interface UserData {
  id: string;
  email: string;
  name: string;
  [key: string]: any;
}
