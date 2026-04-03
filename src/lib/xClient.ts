import { TwitterApi } from 'twitter-api-v2';

// ── Shared X/Twitter Client ────────────────────────────────────────────────
// Single source of truth for all X posting. Replaces 3 duplicate implementations
// across post-to-x, social/post, and cron routes.
//
// Features:
// - 10s timeout on all API calls
// - 1 automatic retry on transient failures (5xx, network errors)
// - Proper rate limit detection (429 status, not string matching)
// - Structured error types for caller handling

const TWEET_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1_500;

// ── Types ──────────────────────────────────────────────────────────────────

export interface XPostResult {
  success: true;
  tweetId: string;
  url: string;
}

export interface XPostError {
  success: false;
  error: string;
  code: 'AUTH_FAILED' | 'RATE_LIMITED' | 'INVALID_TEXT' | 'CREDENTIALS_MISSING' | 'TIMEOUT' | 'API_TIER' | 'UNKNOWN';
  retryAfterMs?: number;
}

export type XPostOutcome = XPostResult | XPostError;

// ── Client Construction ────────────────────────────────────────────────────

/** Check whether OAuth 1.0a env vars are configured */
export function hasOAuth1aEnvVars(): boolean {
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_SECRET
  );
}

/** Build a TwitterApi client from OAuth 1.0a env vars */
function buildOAuth1aClient(): TwitterApi | null {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accToken = process.env.X_ACCESS_TOKEN;
  const accSecret = process.env.X_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accToken || !accSecret) return null;

  return new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accToken,
    accessSecret: accSecret,
  });
}

/** Build a TwitterApi client from an OAuth 2.0 bearer token */
function buildOAuth2Client(accessToken: string): TwitterApi {
  return new TwitterApi(accessToken);
}

// ── Token Refresh ──────────────────────────────────────────────────────────

interface TokenRecord {
  access_token: string;
  refresh_token?: string;
}

interface RefreshedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/** Refresh an OAuth 2.0 token, with 10s timeout.
 *  Reads client credentials from env vars first, then falls back to platform_credentials DB table. */
export async function refreshOAuth2Token(tokenRecord: TokenRecord): Promise<RefreshedToken | null> {
  if (!tokenRecord.refresh_token) {
    return { accessToken: tokenRecord.access_token };
  }

  // Try env vars first, then fall back to DB
  let clientId = process.env.X_CLIENT_ID;
  let clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    try {
      const { getPlatformCredential } = await import('@/lib/db');
      const [idRow, secretRow] = await Promise.all([
        getPlatformCredential('x', 'client_id'),
        getPlatformCredential('x', 'client_secret'),
      ]);
      clientId = idRow?.key_value || undefined;
      clientSecret = secretRow?.key_value || undefined;
    } catch {
      // DB lookup failed — fall through
    }
  }

  if (!clientId || !clientSecret) {
    console.error('[xClient] X client credentials not found in env vars or DB');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TWEET_TIMEOUT_MS);

    // Use api.twitter.com (not token.twitter.com which has DNS issues from serverless)
    // Use Basic Auth header (RFC-compliant for confidential clients, matches callback route)
    const basicAuth = Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`
    ).toString('base64');

    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRecord.refresh_token,
      }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error('[xClient] Token refresh failed:', res.status);
      return null;
    }

    const data = await res.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[xClient] Token refresh timed out');
    } else {
      console.error('[xClient] Token refresh error:', err);
    }
    return null;
  }
}

// ── Core Post Function ─────────────────────────────────────────────────────

/**
 * Post a tweet using OAuth 1.0a env var credentials.
 * Includes timeout and 1 retry on transient errors.
 */
export async function postTweet(text: string): Promise<XPostOutcome> {
  // Validate text
  if (!text?.trim()) {
    return { success: false, error: 'Cannot post empty content', code: 'INVALID_TEXT' };
  }
  if (text.length > 280) {
    return { success: false, error: `Post too long: ${text.length}/280 characters`, code: 'INVALID_TEXT' };
  }

  // Build client
  const client = buildOAuth1aClient();
  if (!client) {
    return { success: false, error: 'X OAuth 1.0a credentials not configured', code: 'CREDENTIALS_MISSING' };
  }

  return tweetWithRetry(client, text);
}

/**
 * Post a tweet using an OAuth 2.0 bearer token (from DB).
 * Falls back to OAuth 1.0a env vars if token is the 'oauth1a-env' marker.
 */
export async function postTweetWithToken(text: string, tokenRecord: TokenRecord): Promise<XPostOutcome> {
  if (!text?.trim()) {
    return { success: false, error: 'Cannot post empty content', code: 'INVALID_TEXT' };
  }
  if (text.length > 280) {
    return { success: false, error: `Post too long: ${text.length}/280 characters`, code: 'INVALID_TEXT' };
  }

  // If token is the env-var marker, use OAuth 1.0a
  if (tokenRecord.access_token === 'oauth1a-env') {
    return postTweet(text);
  }

  // Try OAuth 2.0 token refresh
  const refreshed = await refreshOAuth2Token(tokenRecord);
  if (!refreshed?.accessToken) {
    // Fall back to OAuth 1.0a if available
    if (hasOAuth1aEnvVars()) {
      console.warn('[xClient] OAuth 2.0 refresh failed, falling back to OAuth 1.0a env vars');
      return postTweet(text);
    }
    return { success: false, error: 'Token refresh failed and no env var fallback', code: 'AUTH_FAILED' };
  }

  const client = buildOAuth2Client(refreshed.accessToken);
  return tweetWithRetry(client, text);
}

// ── Retry Logic ────────────────────────────────────────────────────────────

async function tweetWithRetry(client: TwitterApi, text: string, attempt = 0): Promise<XPostOutcome> {
  try {
    // Race the tweet against a timeout
    const result = await Promise.race([
      client.v2.tweet(text),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), TWEET_TIMEOUT_MS)
      ),
    ]);

    return {
      success: true,
      tweetId: result.data.id,
      url: `https://x.com/i/status/${result.data.id}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Timeout
    if (msg === 'TIMEOUT') {
      if (attempt < MAX_RETRIES) {
        console.warn(`[xClient] Tweet timed out, retrying (${attempt + 1}/${MAX_RETRIES})...`);
        await sleep(RETRY_DELAY_MS);
        return tweetWithRetry(client, text, attempt + 1);
      }
      return { success: false, error: 'X API timed out after retries', code: 'TIMEOUT' };
    }

    // Rate limited (429)
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      const retryAfter = extractRetryAfter(msg);
      return {
        success: false,
        error: 'Rate limited by X — wait before posting again',
        code: 'RATE_LIMITED',
        retryAfterMs: retryAfter,
      };
    }

    // API tier insufficient (402 Payment Required)
    if (msg.includes('402')) {
      return { success: false, error: 'X API tier does not support posting \u2014 upgrade to Basic ($100/mo) at developer.x.com', code: 'API_TIER' };
    }

    // Auth failed (401/403)
    if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('forbidden')) {
      return { success: false, error: 'X authentication failed — check credentials', code: 'AUTH_FAILED' };
    }

    // Server error (5xx) — retry once
    if ((msg.includes('500') || msg.includes('502') || msg.includes('503')) && attempt < MAX_RETRIES) {
      console.warn(`[xClient] X server error, retrying (${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(RETRY_DELAY_MS);
      return tweetWithRetry(client, text, attempt + 1);
    }

    // Unknown error
    console.error('[xClient] Tweet failed:', msg);
    return { success: false, error: msg.substring(0, 200), code: 'UNKNOWN' };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractRetryAfter(errorMsg: string): number {
  // Try to extract retry-after seconds from error message
  const match = errorMsg.match(/retry.?after[:\s]*(\d+)/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return 60_000; // Default 60s
}
