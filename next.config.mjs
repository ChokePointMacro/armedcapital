import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['bcryptjs', 'ws', 'bufferutil', 'utf-8-validate'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pbs.twimg.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

// Sentry build-time wrapper — no-ops cleanly when SENTRY_AUTH_TOKEN/org/project
// envs are absent (e.g. local dev). On Vercel, enables source-map upload and
// auto-instrumentation of cron monitors so /api/cron is observed for free.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  widenClientFileUpload: true,
  tunnelRoute: undefined,
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
});
