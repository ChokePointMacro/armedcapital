import { auth } from '@clerk/nextjs/server';

/**
 * Graceful auth check that handles Clerk dev mode failures on mobile.
 * Mobile browsers block third-party cookies from *.clerk.accounts.dev,
 * causing auth() to throw "string did not match expected pattern".
 * Returns userId or null without throwing.
 */
export async function safeAuth(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId;
  } catch (error) {
    console.warn('[Auth] Clerk auth check failed (likely mobile dev mode):', error instanceof Error ? error.message : String(error));
    return null;
  }
}
