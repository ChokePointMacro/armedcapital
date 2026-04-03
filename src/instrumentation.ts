export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');

    // Validate env vars at startup — log warnings for missing optional keys
    const { validateEnv } = await import('./lib/env');
    const { missing, warnings } = validateEnv();
    if (missing.length) console.error(`[Env] CRITICAL — missing required vars: ${missing.join(', ')}`);
    for (const w of warnings) console.warn(`[Env] ${w}`);
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
