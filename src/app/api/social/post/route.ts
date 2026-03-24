import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getPlatformToken, upsertPlatformToken } from '@/lib/db';
import { postTweet, postTweetWithToken, refreshOAuth2Token, hasOAuth1aEnvVars } from '@/lib/xClient';

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { text, platforms, imageUrl, caption } = await request.json();

    if (!text) {
      return NextResponse.json(
        { error: 'text is required' },
        { status: 400 }
      );
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { error: 'at least one platform is required' },
        { status: 400 }
      );
    }

    const results: Record<string, { success: boolean; error?: string; id?: string }> = {};

    // Post to Bluesky
    if (platforms.includes('bluesky')) {
      try {
        const token = await getPlatformToken(userId, 'bluesky');
        if (!token) throw new Error('Bluesky not connected');

        const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: token.handle, password: token.access_token }),
        });
        const session = await sessionRes.json() as any;
        if (!sessionRes.ok) throw new Error(session.message || 'Bluesky auth failed');

        const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessJwt}` },
          body: JSON.stringify({
            repo: session.did,
            collection: 'app.bsky.feed.post',
            record: {
              $type: 'app.bsky.feed.post',
              text: text.substring(0, 300),
              createdAt: new Date().toISOString(),
            },
          }),
        });
        const postData = await postRes.json() as any;
        if (!postRes.ok) throw new Error(postData.message || 'Bluesky post failed');
        results.bluesky = { success: true, id: postData.uri };
      } catch (err) {
        results.bluesky = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Post to LinkedIn
    if (platforms.includes('linkedin')) {
      try {
        const token = await getPlatformToken(userId, 'linkedin');
        if (!token) throw new Error('LinkedIn not connected');

        const postRes = await fetch('https://api.linkedin.com/rest/posts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
            'LinkedIn-Version': '202401',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify({
            author: `urn:li:person:${token.person_urn}`,
            lifecycleState: 'PUBLISHED',
            specificContent: {
              'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text },
                shareMediaCategory: 'NONE',
              },
            },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
          }),
        });
        if (!postRes.ok) {
          const errData = await postRes.json() as any;
          throw new Error(errData.message || `LinkedIn post failed (${postRes.status})`);
        }
        results.linkedin = { success: true };
      } catch (err) {
        results.linkedin = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Post to X — try OAuth 2.0 DB token first, fall back to OAuth 1.0a env vars
    if (platforms.includes('x')) {
      try {
        const xToken = await getPlatformToken(userId!, 'x');
        if (xToken && xToken.access_token !== 'oauth1a-env') {
          // OAuth 2.0 — refresh and persist
          const refreshed = await refreshOAuth2Token(xToken);
          if (refreshed?.accessToken) {
            try {
              await upsertPlatformToken({
                user_id: userId!,
                platform: 'x',
                access_token: refreshed.accessToken,
                refresh_token: refreshed.refreshToken,
                handle: xToken.handle,
                expires_at: refreshed.expiresAt,
              });
            } catch { /* non-fatal */ }
            const xResult = await postTweetWithToken(text.substring(0, 280), {
              access_token: refreshed.accessToken,
              refresh_token: refreshed.refreshToken,
            });
            results.x = xResult.success
              ? { success: true, id: xResult.tweetId }
              : { success: false, error: xResult.error };
          } else {
            // Refresh failed — try env var fallback
            const xResult = await postTweet(text.substring(0, 280));
            results.x = xResult.success
              ? { success: true, id: xResult.tweetId }
              : { success: false, error: xResult.error };
          }
        } else {
          // oauth1a-env marker or no token — use env vars
          const xResult = await postTweet(text.substring(0, 280));
          results.x = xResult.success
            ? { success: true, id: xResult.tweetId }
            : { success: false, error: xResult.error };
        }
      } catch {
        const xResult = await postTweet(text.substring(0, 280));
        results.x = xResult.success
          ? { success: true, id: xResult.tweetId }
          : { success: false, error: xResult.error };
      }
    }

    // Post to Instagram
    if (platforms.includes('instagram')) {
      try {
        const token = await getPlatformToken(userId, 'instagram');
        if (!token) throw new Error('Instagram not connected');
        if (!token.person_urn) {
          throw new Error('No Instagram Business account found. Connect a Business or Creator account.');
        }

        if (!imageUrl) {
          results.instagram = {
            success: false,
            error: 'Instagram requires an image. Export your slides as PNGs, host them publicly, then provide the image URL.',
          };
        } else {
          // Step 1: Create media container
          const containerRes = await fetch(
            `https://graph.facebook.com/v18.0/${token.person_urn}/media`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_url: imageUrl,
                caption: caption || text,
                access_token: token.access_token,
              }),
            }
          );
          const container = await containerRes.json() as any;
          if (!container.id) {
            throw new Error(container.error?.message || 'Failed to create Instagram media container');
          }

          // Step 2: Publish (wait 2 seconds)
          await new Promise(resolve => setTimeout(resolve, 2000));
          const publishRes = await fetch(
            `https://graph.facebook.com/v18.0/${token.person_urn}/media_publish`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                creation_id: container.id,
                access_token: token.access_token,
              }),
            }
          );
          const publishData = await publishRes.json() as any;
          if (!publishRes.ok) {
            throw new Error(publishData.error?.message || 'Instagram publish failed');
          }
          results.instagram = { success: true, id: publishData.id };
        }
      } catch (err) {
        results.instagram = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Post to Threads
    if (platforms.includes('threads')) {
      try {
        const token = await getPlatformToken(userId, 'threads');
        if (!token) throw new Error('Threads not connected');

        // Step 1: Create container
        const containerRes = await fetch(
          `https://graph.threads.net/v1.0/${token.person_urn}/threads`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              media_type: 'TEXT',
              text: text.substring(0, 500),
              access_token: token.access_token,
            }),
          }
        );
        const container = await containerRes.json() as any;
        if (!container.id) throw new Error('Failed to create Threads container');

        // Step 2: Publish (wait 1 second)
        await new Promise(resolve => setTimeout(resolve, 1000));
        const publishRes = await fetch(
          `https://graph.threads.net/v1.0/${token.person_urn}/threads_publish`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              creation_id: container.id,
              access_token: token.access_token,
            }),
          }
        );
        const publishData = await publishRes.json() as any;
        if (!publishRes.ok) {
          throw new Error(publishData.error?.message || 'Threads publish failed');
        }
        results.threads = { success: true, id: publishData.id };
      } catch (err) {
        results.threads = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[API] Error in POST /api/social/post:', error);
    return NextResponse.json(
      { error: 'Failed to post to social platforms' },
      { status: 500 }
    );
  }
}
