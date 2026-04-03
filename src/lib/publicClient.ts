/**
 * Shared Public.com API token management.
 * Handles token exchange and caching — used by markets/options and markets/insights.
 */

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getPublicToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await fetch('https://api.public.com/userapiauthservice/personal/access-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validityInMinutes: 60, secret: process.env.PUBLIC_SECRET_KEY }),
    });
    if (!res.ok) throw new Error(`Public.com token exchange failed ${res.status}`);
    const data = await res.json() as { accessToken: string };
    cachedToken = data.accessToken;
    tokenExpiry = Date.now() + 55 * 60 * 1000;
    return cachedToken!;
  } catch (error) {
    console.error('[PublicClient] Token exchange error:', error instanceof Error ? error.message : error);
    return '';
  }
}
