import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  enabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Performance: sample 20% in prod
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Filter noisy server errors
  ignoreErrors: [
    'CLERK_SECRET_KEY',
    'string did not match expected pattern',
  ],

  environment: process.env.NODE_ENV || 'development',
});
