# Instagram Auto-Posting Integration Guide

## What's In This Folder

```
instagram-integration/
├── src/
│   ├── lib/
│   │   └── instagramClient.ts          ← Core library: OAuth, token mgmt, publishing
│   └── app/
│       ├── api/
│       │   ├── auth/instagram/
│       │   │   ├── route.ts             ← Start OAuth flow (GET /api/auth/instagram)
│       │   │   └── callback/route.ts    ← Token exchange (POST /api/auth/instagram/callback)
│       │   ├── post-to-instagram/
│       │   │   └── route.ts             ← Publish endpoint (single + carousel)
│       │   └── instagram-hashtags/
│       │       └── route.ts             ← AI hashtag generation via Claude
│       └── auth/instagram/callback/
│           └── page.tsx                 ← OAuth callback UI page
├── CRON_PATCH.md                        ← Instructions for updating cron/route.ts
└── IMPLEMENTATION_GUIDE.md              ← This file
```

---

## Step-by-Step Setup

### Step 1: Meta Developer App Configuration

Go to https://developers.facebook.com/apps/ and open your existing app.

1. **Add Instagram Product:**
   - In the left sidebar, click "Add Product"
   - Find "Instagram" and click "Set Up"

2. **Add required permissions:**
   - Go to App Review → Permissions and Features
   - Request: `instagram_basic` and `instagram_content_publish`
   - Note: While in Development Mode, you can test with your own account without App Review

3. **Set OAuth redirect URI:**
   - Go to Instagram → Basic Display (or Instagram Login)
   - Add redirect URI: `https://armedcapital.vercel.app/auth/instagram/callback`
   - Also add for local dev: `http://localhost:3000/auth/instagram/callback`

4. **Get your App ID and Secret:**
   - Go to Settings → Basic
   - Copy the App ID and App Secret

### Step 2: Set Environment Variables on Vercel

```bash
cd /Users/wissencapital/Desktop/armedcapital-push

npx vercel env add INSTAGRAM_APP_ID production
# Paste your Meta App ID

npx vercel env add INSTAGRAM_APP_SECRET production
# Paste your Meta App Secret
```

Also make sure `NEXT_PUBLIC_APP_URL` is set:
```bash
npx vercel env add NEXT_PUBLIC_APP_URL production
# Value: https://armedcapital.vercel.app
```

### Step 3: Copy Files Into Your Project

```bash
cd /Users/wissencapital/Desktop/armedcapital-push

# Core library
cp [path-to-this-folder]/src/lib/instagramClient.ts src/lib/

# OAuth initiation API
mkdir -p src/app/api/auth/instagram/callback
cp [path-to-this-folder]/src/app/api/auth/instagram/route.ts src/app/api/auth/instagram/

# OAuth callback API
cp [path-to-this-folder]/src/app/api/auth/instagram/callback/route.ts src/app/api/auth/instagram/callback/

# OAuth callback UI page
mkdir -p src/app/auth/instagram/callback
cp [path-to-this-folder]/src/app/auth/instagram/callback/page.tsx src/app/auth/instagram/callback/

# Publishing API
mkdir -p src/app/api/post-to-instagram
cp [path-to-this-folder]/src/app/api/post-to-instagram/route.ts src/app/api/post-to-instagram/

# AI Hashtag generation API
mkdir -p src/app/api/instagram-hashtags
cp [path-to-this-folder]/src/app/api/instagram-hashtags/route.ts src/app/api/instagram-hashtags/
```

### Step 4: Update Database Schema

Run this SQL in your Supabase SQL editor:

```sql
-- Add platform, image_url, and metadata columns to scheduled_posts
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'x',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
```

### Step 5: Update Settings.tsx — Connect Instagram Button

In your Settings.tsx, the "Connect Instagram" button already exists. Update its onClick to call:

```typescript
const connectInstagram = async () => {
  const res = await fetch("/api/auth/instagram");
  const data = await res.json();
  if (data.url) {
    // Open in popup (same pattern as Connect X)
    const popup = window.open(data.url, "instagram-auth", "width=600,height=700");

    // Listen for callback result
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "instagram-auth") {
        window.removeEventListener("message", handler);
        if (event.data.success) {
          // Refresh connection status
          // Show success toast: "Connected as @" + event.data.username
        } else {
          // Show error toast
        }
      }
    };
    window.addEventListener("message", handler);
  }
};
```

### Step 6: Update Compose.tsx — Instagram Posting with Hashtags

Add a hashtag generation button to the Compose page when Instagram is selected:

```typescript
const generateHashtags = async () => {
  const res = await fetch("/api/instagram-hashtags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: postContent,
      count: 5,
    }),
  });
  const data = await res.json();
  if (data.hashtags) {
    setHashtags(data.hashtagString);
  }
};

const postToInstagram = async () => {
  const res = await fetch("/api/post-to-instagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caption: postContent,
      imageUrl: selectedImageUrl, // Must be a publicly accessible URL
      hashtags: hashtags,
    }),
  });
  const data = await res.json();
  if (data.success) {
    // Show success — quotaRemaining tells how many posts left today
  }
};
```

### Step 7: Update Cron Route

See `CRON_PATCH.md` for the exact code changes to make in `src/app/api/cron/route.ts`.

### Step 8: Commit and Deploy

```bash
cd /Users/wissencapital/Desktop/armedcapital-push

git add src/lib/instagramClient.ts \
        src/app/api/auth/instagram/ \
        src/app/auth/instagram/ \
        src/app/api/post-to-instagram/ \
        src/app/api/instagram-hashtags/ \
        src/app/api/cron/route.ts

git commit -m "feat: Instagram OAuth 2.0, auto-posting with AI hashtags, carousel support"

git push origin main
```

---

## How It Works

### OAuth Flow
1. User clicks "Connect Instagram" in Settings
2. Popup opens → Instagram authorization page
3. User authorizes → redirects to `/auth/instagram/callback`
4. Callback exchanges code for short-lived token → long-lived token (60 days)
5. Tokens stored in `platform_tokens` table

### Posting Flow
1. User writes caption in Compose, selects Instagram, attaches image
2. "Generate Hashtags" button → Claude generates 3-5 relevant hashtags
3. User posts → creates media container → waits for processing → publishes
4. Or user schedules → stored in `scheduled_posts` with `platform: "instagram"`
5. Cron picks it up within 5 minutes and publishes automatically

### Token Refresh
- Long-lived tokens last 60 days
- `getInstagramToken()` auto-refreshes at 50 days
- If refresh fails, existing token is used until expiration
- User must reconnect after full expiration

### Image Requirement
Instagram API requires images at publicly accessible URLs. Options:
- Upload to Supabase Storage and use the public URL
- Use any CDN-hosted image URL
- Vercel Blob Storage is another option

---

## Rate Limits
- 100 posts per 24-hour rolling window
- Carousels count as 1 post
- The API checks quota before posting and returns `quotaRemaining`

## Environment Variables Needed
| Variable | Where | Value |
|----------|-------|-------|
| `INSTAGRAM_APP_ID` | Vercel | Meta App ID |
| `INSTAGRAM_APP_SECRET` | Vercel | Meta App Secret |
| `NEXT_PUBLIC_APP_URL` | Vercel | `https://armedcapital.vercel.app` |
