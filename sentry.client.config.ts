// Sentry client (browser) configuration — safe no-op when DSN is not set.
// Mirrors the gated dynamic-import pattern used by sentry.{server,edge}.config.ts.
export {};

if (typeof window !== 'undefined' && (process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN)) {
  import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      // Free tier: 10% sample to stay under 5k transactions/mo on prod.
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      replaysOnErrorSampleRate: 0,
      replaysSessionSampleRate: 0,
      debug: false,
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',
      ],
    });
  });
}
