'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface OpsTask {
  agent_id: string;
  agent_name: string;
  title: string;
  description: string;
  priority: string;
  risk_level: string;
  risk_score: number;
  estimated_cost: string;
  category: string;
}

interface AgentPerf {
  agent_id: string;
  agent_name: string;
  tasks_run: number;
  tasks_completed: number;
  tasks_failed: number;
  total_cost: string;
  avg_elapsed_ms: number;
  grade: string;
}

interface OpsResult {
  agent_id: string;
  agent_name: string;
  task_title: string;
  status: 'completed' | 'failed' | 'skipped';
  priority: string;
  risk_level: string;
  risk_score: number;
  category: string;
  elapsed_ms: number;
  cost: string;
  summary: string;
  error?: string;
}

interface OpsSummary {
  id: string;
  type: 'daily' | 'weekly';
  started_at: string;
  completed_at: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  total_cost: string;
  total_elapsed_ms: number;
  risk_assessment: {
    highest_risk: string;
    critical_count: number;
    high_count: number;
    avg_risk_score: number;
    risk_summary: string;
  };
  priority_breakdown: { critical: number; high: number; medium: number; low: number };
  agent_performance: AgentPerf[];
  results: OpsResult[];
  recommendations: string[];
}

interface TaskPreview {
  type: string;
  tasks: OpsTask[];
  total: number;
  estimated_total_cost: string;
}

const priorityColor: Record<string, string> = {
  critical: 'text-red-400 bg-red-900/30 border-red-700/50',
  high: 'text-orange-400 bg-orange-900/30 border-orange-700/50',
  medium: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
  low: 'text-gray-400 bg-gray-800/50 border-gray-700/50',
};

const riskColor: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-green-400',
};

const gradeColor: Record<string, string> = {
  A: 'text-green-400 bg-green-900/40',
  B: 'text-blue-400 bg-blue-900/40',
  C: 'text-yellow-400 bg-yellow-900/40',
  D: 'text-orange-400 bg-orange-900/40',
  F: 'text-red-400 bg-red-900/40',
};

const statusIcon: Record<string, string> = {
  completed: 'â',
  failed: 'â',
  skipped: 'â',
};

const statusColor: Record<string, string> = {
  completed: 'text-green-400',
  failed: 'text-red-400',
  skipped: 'text-gray-500',
};

export function DailyOps() {
  const [opsType, setOpsType] = useState<'daily' | 'weekly'>('daily');
  const [preview, setPreview] = useState<TaskPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<OpsSummary | null>(null);
  const [history, setHistory] = useState<OpsSummary[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [tab, setTab] = useState<'tasks' | 'report' | 'history'>('tasks');
  const [runningTask, setRunningTask] = useState<number | null>(null);
  const [taskResults, setTaskResults] = useState<Record<number, OpsResult>>({});

  // Fetch task preview
  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops-route?type=${opsType}`);
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      }
    } catch {
      // ignore
    }
  }, [opsType]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Execute ops
  const runOps = useCallback(async () => {
    setRunning(true);
    setProgress(`Starting ${opsType} operations...`);
    setTab('report');
    setReport(null);
    setTaskResults({});
    try {
      const res = await fetch('/api/ops-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: opsType }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setReport(data);
        setHistory((prev) => [data, ...prev].slice(0, 20));
        setProgress('');
      } else {
        setProgress(`Error: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setProgress(`Network error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }, [opsType]);

  // Execute a single task by index
  const runSingleTask = useCallback(async (index: number) => {
    setRunningTask(index);
    try {
      const res = await fetch('/api/ops-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: opsType, taskIndex: index }),
      });
      const data = await res.json();
      if (res.ok && data.result) {
        setTaskResults((prev) => ({ ...prev, [index]: data.result }));
      } else {
        setTaskResults((prev) => ({
          ...prev,
          [index]: {
            agent_id: '', agent_name: '', task_title: preview?.tasks[index]?.title || '',
            status: 'failed' as const, priority: '', risk_level: '', risk_score: 0,
            category: '', elapsed_ms: 0, cost: '$0.00',
            summary: data.error || 'Unknown error', error: data.error,
          },
        }));
      }
    } catch (err: any) {
      setTaskResults((prev) => ({
        ...prev,
        [index]: {
          agent_id: '', agent_name: '', task_title: preview?.tasks[index]?.title || '',
          status: 'failed' as const, priority: '', risk_level: '', risk_score: 0,
          category: '', elapsed_ms: 0, cost: '$0.00',
          summary: `Network error: ${err.message}`, error: err.message,
        },
      }));
    } finally {
      setRunningTask(null);
    }
  }, [opsType, preview]);

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Daily Operations</h2>
          <p className="text-[11px] font-mono text-gray-500 mt-0.5">
            Agent task orchestration with risk monitoring and output reports
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpsType('daily')}
            className={cn(
              'px-3 py-1.5 rounded font-mono text-xs transition-colors',
              opsType === 'daily'
                ? 'bg-btc-orange text-black font-semibold'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            Daily
          </button>
          <button
            onClick={() => setOpsType('weekly')}
            className={cn(
              'px-3 py-1.5 rounded font-mono text-xs transition-colors',
              opsType === 'weekly'
                ? 'bg-btc-orange text-black font-semibold'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-800 pb-0">
        {(['tasks', 'report', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors',
              tab === t
                ? 'border-btc-orange text-btc-orange'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t === 'tasks' ? 'Task Queue' : t === 'report' ? 'Run Report' : 'History'}
            {t === 'report' && report && (
              <span className="ml-1.5 text-[9px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded-full">
                {report.completed_tasks}/{report.total_tasks}
              </span>
            )}
            {t === 'history' && history.length > 0 && (
              <span className="ml-1.5 text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
                {history.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ââ Task Queue Tab ââ */}
      {tab === 'tasks' && (
        <div className="space-y-4">
          {/* Run button + cost estimate */}
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono text-gray-500">
              {preview
                ? `${preview.total} tasks Â· Est. cost: $${preview.estimated_total_cost}`
                : 'Loading tasks...'}
            </div>
            <button
              onClick={runOps}
              disabled={running}
              className={cn(
                'px-5 py-2 rounded font-mono text-sm font-semibold transition-colors',
                running
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-btc-orange text-black hover:bg-btc-orange/90'
              )}
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                  Running...
                </span>
              ) : (
                `Run ${opsType === 'weekly' ? 'Weekly' : 'Daily'} Ops`
              )}
            </button>
          </div>

          {progress && (
            <div className="rounded border border-btc-orange/50 bg-btc-orange/10 px-4 py-2.5 text-sm font-mono text-btc-orange flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-btc-orange border-t-transparent rounded-full animate-spin" />
              {progress}
            </div>
          )}

          {/* Task list */}
          {preview?.tasks.map((task, i) => {
            const result = taskResults[i];
            const isRunning = runningTask === i;
            return (
              <div
                key={i}
                className={cn(
                  'rounded border bg-gray-900/50 p-4 space-y-2 transition-colors',
                  result?.status === 'completed' ? 'border-green-800/60' :
                  result?.status === 'failed' ? 'border-red-800/60' :
                  isRunning ? 'border-btc-orange/50' : 'border-gray-800'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-[10px] font-mono px-2 py-0.5 rounded border', priorityColor[task.priority])}>
                        {task.priority.toUpperCase()}
                      </span>
                      <span className={cn('text-[10px] font-mono', riskColor[task.risk_level])}>
                        Risk: {task.risk_score}/10
                      </span>
                      <span className="text-[10px] font-mono text-gray-600">{task.category}</span>
                      {result && (
                        <span className={cn('text-[10px] font-mono font-semibold', statusColor[result.status])}>
                          {statusIcon[result.status]} {result.status.toUpperCase()}
                          {result.elapsed_ms > 0 && ` Â· ${formatMs(result.elapsed_ms)}`}
                          {result.cost !== '$0.00' && result.cost !== '$0.0000' && ` Â· ${result.cost}`}
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-white">{task.title}</h4>
                    <p className="text-[11px] text-gray-400 mt-0.5">{task.description}</p>
                  </div>
                  <div className="text-right ml-4 shrink-0 flex flex-col items-end gap-1.5">
                    <p className="text-[10px] font-mono text-gray-500">{task.agent_name}</p>
                    <p className="text-[10px] font-mono text-btc-orange">{task.estimated_cost}</p>
                    <button
                      onClick={() => runSingleTask(i)}
                      disabled={isRunning || running}
                      className={cn(
                        'mt-1 px-3 py-1 rounded font-mono text-[10px] font-semibold transition-colors',
                        isRunning
                          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          : result?.status === 'completed'
                          ? 'bg-green-900/40 text-green-400 hover:bg-green-900/60 border border-green-700/50'
                          : result?.status === 'failed'
                          ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60 border border-red-700/50'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700'
                      )}
                    >
                      {isRunning ? (
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                          Running...
                        </span>
                      ) : result ? 'Re-run' : 'Run'}
                    </button>
                  </div>
                </div>
                {/* Show result summary inline */}
                {result && (
                  <div className={cn(
                    'mt-2 p-3 rounded text-xs font-mono border',
                    result.status === 'completed'
                      ? 'bg-green-900/10 border-green-800/40 text-green-300'
                      : 'bg-red-900/10 border-red-800/40 text-red-300'
                  )}>
                    <p className="whitespace-pre-wrap leading-relaxed">{result.summary?.slice(0, 500)}</p>
                    {result.error && <p className="text-red-400 mt-1">Error: {result.error}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ââ Report Tab ââ */}
      {tab === 'report' && (
        <div className="space-y-4">
          {!report && !running && (
            <div className="text-center py-12 text-gray-600 font-mono text-sm">
              No report yet. Run {opsType} ops to generate a report.
            </div>
          )}

          {report && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded border border-gray-800 bg-gray-900/50 p-3">
                  <p className="text-[10px] font-mono text-gray-500 uppercase">Tasks</p>
                  <p className="text-xl font-bold text-white mt-1">
                    {report.completed_tasks}
                    <span className="text-sm text-gray-500">/{report.total_tasks}</span>
                  </p>
                  {report.failed_tasks > 0 && (
                    <p className="text-[10px] font-mono text-red-400 mt-0.5">{report.failed_tasks} failed</p>
                  )}
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/50 p-3">
                  <p className="text-[10px] font-mono text-gray-500 uppercase">Cost</p>
                  <p className="text-xl font-bold text-btc-orange mt-1">{report.total_cost}</p>
                  <p className="text-[10px] font-mono text-gray-500 mt-0.5">{formatMs(report.total_elapsed_ms)} total</p>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/50 p-3">
                  <p className="text-[10px] font-mono text-gray-500 uppercase">Risk</p>
                  <p className={cn('text-xl font-bold mt-1', riskColor[report.risk_assessment.highest_risk])}>
                    {report.risk_assessment.highest_risk.toUpperCase()}
                  </p>
                  <p className="text-[10px] font-mono text-gray-500 mt-0.5">
                    Avg: {report.risk_assessment.avg_risk_score}/10
                  </p>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/50 p-3">
                  <p className="text-[10px] font-mono text-gray-500 uppercase">Duration</p>
                  <p className="text-xl font-bold text-white mt-1">{formatMs(report.total_elapsed_ms)}</p>
                  <p className="text-[10px] font-mono text-gray-500 mt-0.5">{formatTime(report.completed_at)}</p>
                </div>
              </div>

              {/* Risk summary */}
              <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
                <h4 className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">Risk Assessment</h4>
                <p className="text-sm text-gray-300">{report.risk_assessment.risk_summary}</p>
              </div>

              {/* Agent performance */}
              <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
                <h4 className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Agent Performance</h4>
                <div className="space-y-2">
                  {report.agent_performance.map((agent) => (
                    <div key={agent.agent_id} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className={cn('text-xs font-mono font-bold w-7 h-7 rounded flex items-center justify-center', gradeColor[agent.grade])}>
                          {agent.grade}
                        </span>
                        <div>
                          <p className="text-sm text-white">{agent.agent_name}</p>
                          <p className="text-[10px] font-mono text-gray-500">
                            {agent.tasks_completed}/{agent.tasks_run} tasks Â· {formatMs(agent.avg_elapsed_ms)} avg
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono text-btc-orange">{agent.total_cost}</p>
                        {agent.tasks_failed > 0 && (
                          <p className="text-[10px] font-mono text-red-400">{agent.tasks_failed} failed</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Task results */}
              <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
                <h4 className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Task Results</h4>
                <div className="space-y-2">
                  {report.results.map((result, i) => (
                    <div key={i}>
                      <button
                        onClick={() => setExpandedTask(expandedTask === result.task_title ? null : result.task_title)}
                        className="w-full text-left flex items-center justify-between py-2 px-3 rounded hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('text-sm', statusColor[result.status])}>{statusIcon[result.status]}</span>
                          <span className="text-sm text-white">{result.task_title}</span>
                          <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', priorityColor[result.priority])}>
                            {result.priority}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500">
                          <span>{formatMs(result.elapsed_ms)}</span>
                          <span className="text-btc-orange">{result.cost}</span>
                        </div>
                      </button>
                      {expandedTask === result.task_title && (
                        <div className="ml-7 mt-1 mb-3 p-3 rounded bg-gray-800/50 border border-gray-700/50">
                          <p className="text-[10px] font-mono text-gray-500 mb-1">
                            Agent: {result.agent_name} Â· Category: {result.category} Â· Risk: {result.risk_score}/10
                          </p>
                          <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {result.summary}
                          </p>
                          {result.error && (
                            <p className="text-xs text-red-400 mt-2 font-mono">Error: {result.error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              <div className="rounded border border-gray-800 bg-gray-900/50 p-4">
                <h4 className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Recommendations</h4>
                <div className="space-y-2">
                  {report.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-btc-orange text-xs mt-0.5">â¸</span>
                      <p className="text.xs text-gray-300">{rec}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ââ History Tab ââ */}
      {tab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 && (
            <div className="text-center py-12 text-gray-600 font-mono text-sm">
              No run history yet. Complete a daily or weekly run to see results here.
            </div>
          )}
          {history.map((run) => (
            <button
              key={run.id}
              onClick={() => { setReport(run); setTab('report'); }}
              className="w-full text-left rounded border border-gray-800 bg-gray-900/50 p-4 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'text-[10px] font-mono font-semibold px-2 py-0.5 rounded',
                    run.type === 'weekly' ? 'bg-purple-900/40 text-purple-400' : 'bg-blue-900/40 text-blue-400'
                  )}>
                    {run.type.toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm text-white">
                      {run.completed_tasks}/{run.total_tasks} completed
                      {run.failed_tasks > 0 && <span className="text-red-400 ml-1">({run.failed_tasks} failed)</span>}
                    </p>
                    <p className="text-[10px] font-mono text-gray-500">{formatTime(run.started_at)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-btc-orange">{run.total_cost}</p>
                  <p className="text-[10px] font-mono text-gray-500">{formatMs(run.total_elapsed_ms)}</p>
                </div>
              </div>
              {/* Mini agent grades */}
              <div className="flex gap-1.5 mt-2">
                {run.agent_performance.map((a) => (
                  <span
                    key={a.agent_id}
                    className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 rounded', gradeColor[a.grade])}
                    title={a.agent_name}
                  >
                    {a.agent_name.match(/\((\w+)\)/)?.[1] || a.agent_id}: {a.grade}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
