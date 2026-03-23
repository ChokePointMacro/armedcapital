import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only initialize if DSN is configured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance: sample 20% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Session replay: capture 10% of sessions, 100% on error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Filter out noisy errors
  ignoreErrors: [
    // Browser extensions
    'ResizeObserver loop',
    'Non-Error promise rejection',
    // Clerk dev mode
    'string did not match expected pattern',
    // Network flakes
    'Failed to fetch',
    'Load failed',
    'NetworkError',
  ],

  integrations: [
    Sentry.replayIntegration(),
  ],

  environment: process.env.NODE_ENV || 'development',
});
