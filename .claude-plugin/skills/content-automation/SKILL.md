# Content Automation Skill

Domain knowledge for ArmedCapital's content publishing pipeline.

## Services Overview
ArmedCapital has four content channels, each with its own automation pipeline:

### 1. YouTube Shorts (Studio)
- **Service**: `studio/services/` — FastAPI backend
- **Pipeline**: Topic → Script → Assets → Render → Upload
- **LLM**: Dual provider — Ollama (fast/local) or Claude (quality)
- **Component**: `src/components/YouTubeShorts.tsx`
- **API**: `studio/api/server.py` on port 8100

### 2. Twitter/X Bot (Studio + Next.js)
- **Engine**: `studio/services/` — tweet generation
- **Client**: `src/lib/xClient.ts` — X API wrapper
- **API Route**: `src/app/api/post-to-x/`
- **Component**: `src/components/TwitterBotStudio.tsx`
- **Pattern**: Generate → Review → Post (or schedule)

### 3. Instagram
- **Client**: `src/lib/instagramClient.ts` — Instagram Graph API
- **Caption**: `src/app/api/instagram-caption/` — AI caption generation
- **Social API**: `src/app/api/social/` — unified social posting

### 4. Email/Substack
- **Email Digest**: `src/app/api/email-digest/`
- **Substack**: `src/app/api/substack-article/`
- **Resend**: `src/lib/resend.ts` — email sending
- **Reports**: `src/app/api/reports/`, `src/app/api/generate-report/`

## Scheduling
- **Scheduled Posts**: `src/app/api/scheduled-posts/`
- **Auto Schedule**: `src/app/api/auto-schedule/`
- **Cron Jobs**: `src/app/api/cron/`
- **Component**: `src/components/Schedule.tsx`

## Content Safety
- Financial content requires disclaimers ("Not financial advice")
- No market manipulation language
- Respect platform-specific content policies
- Rate limit all posting to stay under API quotas
- Always have a human review step before going fully automated

## Patterns
- Generate content with AI → store as draft → review → publish
- Use scheduling for consistent posting cadence
- Track performance metrics for optimization
- Fallback: if AI generation fails, queue for manual creation
- All API keys stored as environment variables, never in code
