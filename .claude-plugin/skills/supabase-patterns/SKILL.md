# Supabase Patterns Skill

Domain knowledge for ArmedCapital's Supabase usage.

## Setup
- **Client**: `src/lib/supabase.ts` — server-side Supabase client
- **DB Utils**: `src/lib/db.ts` — helper functions
- **Migrations**: `scripts/` — SQL migration files

## Query Patterns

### Standard CRUD
```typescript
// READ
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .eq('user_id', userId)
  .order('created_at', { ascending: false });

// CREATE
const { data, error } = await supabase
  .from('table_name')
  .insert({ column: value })
  .select()
  .single();

// UPDATE
const { data, error } = await supabase
  .from('table_name')
  .update({ column: newValue })
  .eq('id', recordId)
  .select()
  .single();

// DELETE (prefer soft delete)
const { error } = await supabase
  .from('table_name')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', recordId);
```

### Auth Integration
```typescript
// In API routes — always validate auth first
import { getAuth } from '@/lib/authHelper';

const auth = await getAuth(request);
if (!auth.userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// Then query with user context
const { data } = await supabase
  .from('user_data')
  .select('*')
  .eq('user_id', auth.userId);
```

### Error Handling
```typescript
const { data, error } = await supabase.from('table').select('*');
if (error) {
  console.error('Database error:', error.message);
  return NextResponse.json(
    { error: 'Database error' }, // Don't leak internal error details
    { status: 500 }
  );
}
```

## Security Patterns
- **RLS**: Every table must have Row Level Security enabled
- **No raw SQL**: Always use the Supabase client (parameterized queries)
- **Least privilege**: API routes only access tables they need
- **Audit fields**: All tables should have `created_at`, `updated_at`

## Migration Patterns
- One migration per logical change
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Add columns as nullable first, backfill, then add constraints
- Always include rollback SQL as comments
- Test on Supabase branch before production

## Performance
- Add indexes for frequently queried columns
- Use `.select('col1, col2')` instead of `.select('*')` for large tables
- Paginate results: `.range(offset, offset + limit - 1)`
- Use database functions for complex queries
- Cache hot queries with `src/lib/cache.ts`
