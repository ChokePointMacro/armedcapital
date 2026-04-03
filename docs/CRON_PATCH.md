# Cron Route Update for Instagram

Your current `src/app/api/cron/route.ts` skips Instagram posts (treats them as reminder-only).
Apply this change to enable actual Instagram posting from the cron.

## What to change

In your cron route, find the section that handles Instagram posts and replace the skip logic with this:

```typescript
// ─── ADD THIS IMPORT at the top of cron/route.ts ────────────────────────────
import {
  getInstagramToken,
  publishSingleImage,
} from "@/lib/instagramClient";

// ─── REPLACE the Instagram skip logic with this ─────────────────────────────
// Inside the loop that processes each scheduled post:

if (post.content?.startsWith("[INSTAGRAM]") || post.platform === "instagram") {
  const igContent = post.content.replace("[INSTAGRAM]", "").trim();

  // Get the user's Instagram token
  const igToken = await getInstagramToken(post.user_id);

  if (!igToken || !igToken.person_urn) {
    console.error(`[Cron] No Instagram token for user ${post.user_id}`);
    await supabase
      .from("scheduled_posts")
      .update({ status: "failed" })
      .eq("id", post.id);
    continue;
  }

  // Instagram requires an image — check if one is included in the post metadata
  const imageUrl = post.image_url || post.metadata?.image_url;

  if (!imageUrl) {
    console.error(`[Cron] Instagram post ${post.id} has no image URL — skipping`);
    await supabase
      .from("scheduled_posts")
      .update({ status: "failed" })
      .eq("id", post.id);
    continue;
  }

  const result = await publishSingleImage(
    imageUrl,
    igContent,
    igToken.access_token,
    igToken.person_urn
  );

  if (result.success) {
    console.log(`[Cron] ✓ Posted to Instagram: ${result.mediaId}`);
    await supabase
      .from("scheduled_posts")
      .update({ status: "posted" })
      .eq("id", post.id);
  } else {
    console.error(`[Cron] ✗ Instagram post failed: ${result.error}`);
    await supabase
      .from("scheduled_posts")
      .update({ status: "failed" })
      .eq("id", post.id);
  }
  continue;
}
```

## Database: Add image_url to scheduled_posts

Run this SQL in Supabase to support image URLs on scheduled posts:

```sql
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'x',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
```
