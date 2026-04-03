/**
 * Token Manager — Unified credential fetch/refresh from Supabase
 *
 * On login (or first API hit), loads all platform credentials from Supabase
 * into runtime memory. When an integration reports auth failure, automatically
 * re-fetches the credential from Supabase and triggers reconnection.
 *
 * Integrations: TradingView, Yahoo (cookie), X/Twitter, Instagram, etc.
 */

import { createServerSupabase } from '@/lib/supabase';

// ── Types ───────────────────────────────────────────────────────────────────

interface TokenEntry {
  value: string;
  loadedAt: number;
  valid: boolean;
}

type RefreshCallback = (newToken: string) => void;

// ── Runtime Store ───────────────────────────────────────────────────────────

const tokens = new Map<string, TokenEntry>();
const refreshCallbacks = new Map<string, RefreshCallback>();
let initialized = false;
let initPromise: Promise<void> | null = null;

// Debounce: don't re-fetch the same token more than once per 30s
const REFRESH_COOLDOWN_MS = 30_000;
const lastRefreshAttempt = new Map<string, number>();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a callback that fires when a token is refreshed.
 * E.g. TradingView registers a callback that calls setSessionId().
 */
export function onTokenRefresh(platform: string, keyName: string, cb: RefreshCallback): void {
  const key = `${platform}:${keyName}`;
  refreshCallbacks.set(key, cb);
}

/**
 * Load all platform credentials from Supabase into memory.
 * Called on first API hit or explicitly after login.
 * Safe to call multiple times — deduplicates via initPromise.
 */
export async function initTokens(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const db = createServerSupabase();
      const { data, error } = await db
        .from('platform_credentials')
        .select('platform, key_name, key_value');

      if (error) {
        console.error('[TokenManager] Failed to load credentials:', error.message);
        return;
      }

      for (const row of data || []) {
        const key = `${row.platform}:${row.key_name}`;
        tokens.set(key, {
          value: row.key_value,
          loadedAt: Date.now(),
          valid: true,
        });
      }

      initialized = true;
      console.log(`[TokenManager] Loaded ${data?.length || 0} credentials`);

      // Fire callbacks for all loaded tokens
      for (const row of data || []) {
        const key = `${row.platform}:${row.key_name}`;
        const cb = refreshCallbacks.get(key);
        if (cb) {
          try { cb(row.key_value); } catch (e) {
            console.error(`[TokenManager] Callback error for ${key}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('[TokenManager] Init failed:', e);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Get a token from the runtime cache.
 * Returns null if not found or not yet loaded.
 */
export function getToken(platform: string, keyName: string): string | null {
  const key = `${platform}:${keyName}`;
  const entry = tokens.get(key);
  if (!entry || !entry.valid) return null;
  return entry.value;
}

/**
 * Mark a token as invalid and attempt to re-fetch from Supabase.
 * If the DB has a newer value, updates the cache and fires the refresh callback.
 */
export async function refreshToken(platform: string, keyName: string): Promise<string | null> {
  const key = `${platform}:${keyName}`;

  // Debounce
  const lastAttempt = lastRefreshAttempt.get(key) || 0;
  if (Date.now() - lastAttempt < REFRESH_COOLDOWN_MS) {
    console.log(`[TokenManager] Refresh cooldown for ${key}, skipping`);
    return tokens.get(key)?.value || null;
  }
  lastRefreshAttempt.set(key, Date.now());

  // Mark current as invalid
  const existing = tokens.get(key);
  if (existing) existing.valid = false;

  try {
    const db = createServerSupabase();
    const { data, error } = await db
      .from('platform_credentials')
      .select('key_value')
      .eq('platform', platform)
      .eq('key_name', keyName)
      .single();

    if (error || !data?.key_value) {
      console.warn(`[TokenManager] No credential found for ${key}`);
      return null;
    }

    const newValue = data.key_value;
    tokens.set(key, { value: newValue, loadedAt: Date.now(), valid: true });
    console.log(`[TokenManager] Refreshed ${key}`);

    // Fire callback
    const cb = refreshCallbacks.get(key);
    if (cb) {
      try { cb(newValue); } catch (e) {
        console.error(`[TokenManager] Callback error for ${key}:`, e);
      }
    }

    return newValue;
  } catch (e) {
    console.error(`[TokenManager] Refresh failed for ${key}:`, e);
    return null;
  }
}

/**
 * Store a new token in both Supabase and the runtime cache.
 */
export async function storeToken(platform: string, keyName: string, value: string): Promise<boolean> {
  const key = `${platform}:${keyName}`;

  try {
    const db = createServerSupabase();
    const { error } = await db
      .from('platform_credentials')
      .upsert({
        platform,
        key_name: keyName,
        key_value: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'platform,key_name' });

    if (error) {
      console.error(`[TokenManager] Failed to store ${key}:`, error.message);
      return false;
    }

    tokens.set(key, { value, loadedAt: Date.now(), valid: true });
    console.log(`[TokenManager] Stored ${key}`);

    // Fire callback
    const cb = refreshCallbacks.get(key);
    if (cb) {
      try { cb(value); } catch (e) {
        console.error(`[TokenManager] Callback error for ${key}:`, e);
      }
    }

    return true;
  } catch (e) {
    console.error(`[TokenManager] Store failed for ${key}:`, e);
    return false;
  }
}

/**
 * Check if tokens have been loaded from Supabase.
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Get status of all loaded tokens (for diagnostics).
 */
export function getTokenStatus(): Array<{ platform: string; keyName: string; valid: boolean; age: number }> {
  const result: Array<{ platform: string; keyName: string; valid: boolean; age: number }> = [];
  for (const [key, entry] of tokens) {
    const [platform, keyName] = key.split(':');
    result.push({
      platform,
      keyName,
      valid: entry.valid,
      age: Math.round((Date.now() - entry.loadedAt) / 1000),
    });
  }
  return result;
}
