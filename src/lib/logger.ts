/**
 * Structured logger for ArmedCapital.
 * Outputs JSON in production for log aggregation (Vercel, Sentry, Datadog).
 * Pretty-prints in development.
 * Drop-in replacement for console.log/warn/error.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  level: LogLevel;
  msg: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  route?: string;
  latencyMs?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const MIN_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'info'] || 20;
const IS_PROD = process.env.NODE_ENV === 'production';

function emit(entry: LogEntry) {
  const level = LOG_LEVELS[entry.level] || 20;
  if (level < MIN_LEVEL) return;

  const output = IS_PROD
    ? JSON.stringify(entry)
    : `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.msg}${entry.route ? ` (${entry.route})` : ''}${entry.latencyMs !== undefined ? ` ${entry.latencyMs}ms` : ''}`;

  if (level >= LOG_LEVELS.error) {
    console.error(output);
  } else if (level >= LOG_LEVELS.warn) {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function createLogFn(level: LogLevel) {
  return (msg: string, meta?: Record<string, unknown>) => {
    emit({
      level,
      msg,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  };
}

export const log = {
  debug: createLogFn('debug'),
  info: createLogFn('info'),
  warn: createLogFn('warn'),
  error: createLogFn('error'),
  fatal: createLogFn('fatal'),
};

/**
 * Create a child logger with preset context (e.g. route, userId)
 */
export function createLogger(context: Record<string, unknown>) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => log.debug(msg, { ...context, ...meta }),
    info: (msg: string, meta?: Record<string, unknown>) => log.info(msg, { ...context, ...meta }),
    warn: (msg: string, meta?: Record<string, unknown>) => log.warn(msg, { ...context, ...meta }),
    error: (msg: string, meta?: Record<string, unknown>) => log.error(msg, { ...context, ...meta }),
    fatal: (msg: string, meta?: Record<string, unknown>) => log.fatal(msg, { ...context, ...meta }),
  };
}

export default log;
