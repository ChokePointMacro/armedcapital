/**
 * Instagram Graph API Client
 * Handles OAuth token management, publishing (single image, carousel),
 * and hashtag-enriched captions via Meta Graph API v18.0.
 *
 * DROP INTO: src/lib/instagramClient.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GRAPH_API = "https://graph.facebook.com/v18.0";
const IG_OAUTH = "https://api.instagram.com/oauth";
const IG_GRAPH = "https://graph.instagram.com";

// ─── OAuth Helpers ───────────────────────────────────────────────────────────

/**
 * Build the Instagram OAuth authorization URL.
 * Redirect the user here to begin the Connect Instagram flow.
 */
export function getInstagramAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/auth/instagram/callback`,
    scope: "instagram_basic,instagram_content_publish",
    response_type: "code",
    state,
  });
  return `${IG_OAUTH}/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for a short-lived access token,
 * then immediately exchange for a long-lived token (60 days).
 */
export async function exchangeCodeForTokens(code: string) {
  // Step 1: Short-lived token
  const shortRes = await fetch(`${IG_OAUTH}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/auth/instagram/callback`,
      code,
    }),
  });

  if (!shortRes.ok) {
    const err = await shortRes.json();
    throw new Error(`Instagram token exchange failed: ${JSON.stringify(err)}`);
  }

  const shortData = await shortRes.json();
  // shortData: { access_token, user_id }

  // Step 2: Long-lived token (60 days)
  const longRes = await fetch(
    `${IG_GRAPH}/access_token?` +
      new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        access_token: shortData.access_token,
      })
  );

  if (!longRes.ok) {
    const err = await longRes.json();
    throw new Error(`Long-lived token exchange failed: ${JSON.stringify(err)}`);
  }

  const longData = await longRes.json();
  // longData: { access_token, token_type, expires_in }

  // Step 3: Fetch username
  const meRes = await fetch(
    `${IG_GRAPH}/me?fields=id,username&access_token=${longData.access_token}`
  );
  const meData = meRes.ok ? await meRes.json() : { username: null };

  return {
    accessToken: longData.access_token,
    igUserId: shortData.user_id,
    username: meData.username,
    expiresIn: longData.expires_in, // seconds (60 days ~ 5184000)
  };
}

/**
 * Refresh a long-lived token before it expires.
 * Call this when token is 50+ days old.
 */
export async function refreshInstagramToken(
  currentToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(
    `${IG_GRAPH}/refresh_access_token?` +
      new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: currentToken,
      })
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Instagram token refresh failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

// ─── Token DB Helpers ────────────────────────────────────────────────────────

/**
 * Get a valid Instagram token for a user, auto-refreshing if needed.
 */
export async function getInstagramToken(userId: string) {
  const { data: token, error } = await supabase
    .from("platform_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "instagram")
    .single();

  if (error || !token) return null;

  // Check if token needs refresh (refresh at 50 days = 4320000 seconds)
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = token.expires_at || 0;
  const fiftyDaysFromNow = now + 50 * 24 * 60 * 60;

  if (expiresAt < fiftyDaysFromNow && expiresAt > now) {
    try {
      const refreshed = await refreshInstagramToken(token.access_token);
      const newExpiresAt = now + refreshed.expiresIn;

      await supabase
        .from("platform_tokens")
        .update({
          access_token: refreshed.accessToken,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", token.id);

      return { ...token, access_token: refreshed.accessToken, expires_at: newExpiresAt };
    } catch (e) {
      console.error("[Instagram] Token refresh failed, using existing:", e);
    }
  }

  if (expiresAt < now) {
    console.error("[Instagram] Token expired and refresh failed for user", userId);
    return null;
  }

  return token;
}

/**
 * Store Instagram tokens after OAuth callback.
 */
export async function storeInstagramToken(
  userId: string,
  accessToken: string,
  igUserId: string,
  username: string | null,
  expiresIn: number
) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  const { error } = await supabase.from("platform_tokens").upsert(
    {
      user_id: userId,
      platform: "instagram",
      access_token: accessToken,
      refresh_token: null, // Instagram uses token refresh endpoint, not refresh_token
      handle: username,
      person_urn: igUserId, // Store IG user ID in person_urn field
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform" }
  );

  if (error) throw new Error(`Failed to store Instagram token: ${error.message}`);
}

// ─── Publishing ──────────────────────────────────────────────────────────────

interface PublishResult {
  success: boolean;
  mediaId?: string;
  error?: string;
}

/**
 * Publish a single image post to Instagram.
 * @param imageUrl - Publicly accessible image URL (JPEG recommended)
 * @param caption - Post caption including hashtags
 * @param accessToken - Valid Instagram access token
 * @param igUserId - Instagram user ID
 */
export async function publishSingleImage(
  imageUrl: string,
  caption: string,
  accessToken: string,
  igUserId: string
): Promise<PublishResult> {
  try {
    // Step 1: Create media container
    const containerRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.json();
      return { success: false, error: `Container creation failed: ${JSON.stringify(err)}` };
    }

    const container = await containerRes.json();

    // Step 2: Wait for container to be ready (poll up to 30 seconds)
    const ready = await waitForContainer(container.id, accessToken);
    if (!ready) {
      return { success: false, error: "Container did not finish processing in time" };
    }

    // Step 3: Publish
    const publishRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: accessToken,
      }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json();
      return { success: false, error: `Publish failed: ${JSON.stringify(err)}` };
    }

    const published = await publishRes.json();
    return { success: true, mediaId: published.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Publish a carousel post (2-10 images) to Instagram.
 * @param imageUrls - Array of publicly accessible image URLs (2-10)
 * @param caption - Post caption including hashtags
 * @param accessToken - Valid Instagram access token
 * @param igUserId - Instagram user ID
 */
export async function publishCarousel(
  imageUrls: string[],
  caption: string,
  accessToken: string,
  igUserId: string
): Promise<PublishResult> {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    return { success: false, error: "Carousel requires 2-10 images" };
  }

  try {
    // Step 1: Create child containers for each image
    const childIds: string[] = [];
    for (const url of imageUrls) {
      const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          access_token: accessToken,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        return { success: false, error: `Child container failed: ${JSON.stringify(err)}` };
      }

      const child = await res.json();
      childIds.push(child.id);
    }

    // Step 2: Create parent carousel container
    const carouselRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
        access_token: accessToken,
      }),
    });

    if (!carouselRes.ok) {
      const err = await carouselRes.json();
      return { success: false, error: `Carousel container failed: ${JSON.stringify(err)}` };
    }

    const carousel = await carouselRes.json();

    // Step 3: Wait for processing
    const ready = await waitForContainer(carousel.id, accessToken);
    if (!ready) {
      return { success: false, error: "Carousel did not finish processing in time" };
    }

    // Step 4: Publish
    const publishRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: carousel.id,
        access_token: accessToken,
      }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json();
      return { success: false, error: `Carousel publish failed: ${JSON.stringify(err)}` };
    }

    const published = await publishRes.json();
    return { success: true, mediaId: published.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Check remaining publishing quota for the day.
 */
export async function getPublishingQuota(
  igUserId: string,
  accessToken: string
): Promise<{ used: number; total: number }> {
  try {
    const res = await fetch(
      `${GRAPH_API}/${igUserId}/content_publishing_limit?access_token=${accessToken}`
    );
    if (!res.ok) return { used: 0, total: 100 };
    const data = await res.json();
    return {
      used: data.data?.[0]?.quota_usage ?? 0,
      total: 100,
    };
  } catch {
    return { used: 0, total: 100 };
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Poll container status until FINISHED or timeout.
 */
async function waitForContainer(
  containerId: string,
  accessToken: string,
  maxWaitMs = 30000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `${GRAPH_API}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.status_code === "FINISHED") return true;
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") return false;
    }
    // Wait 2 seconds between polls
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
