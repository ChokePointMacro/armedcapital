# Next.js Patterns Skill

Domain knowledge for ArmedCapital's Next.js 14 application.

## Project Structure
- **App Router**: `src/app/` — file-based routing
- **API Routes**: `src/app/api/` — backend endpoints
- **Components**: `src/components/` — React components
- **Libraries**: `src/lib/` — shared utilities
- **Types**: `src/types/` — TypeScript type definitions
- **Config**: `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`

## Import Conventions
```typescript
// ALWAYS use @/ aliases
import { SomeComponent } from '@/components/SomeComponent';
import { supabase } from '@/lib/supabase';
import { getAuth } from '@/lib/authHelper';
import type { SomeType } from '@/types';

// NEVER use relative imports for src/ files
// BAD: import { thing } from '../../lib/thing';
```

## API Route Pattern
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/authHelper';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  // 1. Auth check
  const auth = await getAuth(request);
  if (!auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Input validation
  const { searchParams } = new URL(request.url);
  const param = searchParams.get('param');

  // 3. Business logic with Supabase
  const { data, error } = await supabase
    .from('table')
    .select('*')
    .eq('user_id', auth.userId);

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // 4. Return response
  return NextResponse.json({ data });
}
```

## Dynamic Imports (Critical)
```typescript
// agentBus MUST be dynamically imported in route handlers
export async function POST(request: NextRequest) {
  const { agentBus } = await import('@/lib/agentBus');
  // ... use agentBus
}
```

## Component Patterns
- Use `"use client"` directive only when needed (hooks, browser APIs, interactivity)
- Server components by default
- SSE for real-time: `src/lib/useSSE.ts`
- Tailwind CSS only — no CSS modules or inline styles
- TradingView widgets loaded via dynamic import

## Environment Variables
- Server-only: `process.env.SECRET_KEY` (in API routes)
- Client-exposed: `NEXT_PUBLIC_*` prefix
- Never log or return env vars in responses

## Error Handling
- API routes: try/catch with proper status codes
- Components: Error boundaries for graceful failures
- Forms: Validation with `src/lib/validate.ts`
- Rate limiting: `src/lib/rateLimit.ts` on public endpoints

## Testing
- Framework: vitest (`vitest.config.ts`)
- Unit tests: `tests/unit/`
- Integration tests: `tests/integration/`
- Run: `npx vitest`
- Type check: `npx tsc --noEmit`
