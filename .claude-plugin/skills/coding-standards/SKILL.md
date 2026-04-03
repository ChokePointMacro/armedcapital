# Coding Standards Skill

ArmedCapital coding conventions and quality standards.

## TypeScript (Next.js)
- **Strict mode**: No implicit `any`, enable all strict checks
- **Imports**: Always use `@/` path aliases
- **Types**: Shared types in `src/types/`, inline types only for component-local use
- **Naming**: PascalCase for components/types, camelCase for functions/variables, UPPER_SNAKE for constants
- **Files**: PascalCase for components (`Markets.tsx`), camelCase for utilities (`supabase.ts`)

## Python (TradingBot + Studio)
- **Type hints**: All function signatures
- **Docstrings**: Google style for public functions
- **Naming**: snake_case for functions/variables, PascalCase for classes
- **No print()**: Use structured logging in production
- **Dependencies**: Pin versions in requirements.txt

## API Routes
- Always auth-first: check authentication before any business logic
- Validate inputs: use `src/lib/validate.ts`
- Return consistent JSON: `{ data }` for success, `{ error }` for failures
- Use proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- Rate limit public endpoints

## Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Never commit secrets or `.env` files
- One logical change per commit
- Branch naming: `feature/`, `fix/`, `refactor/`

## Testing
- Write tests for new features and bug fixes
- TypeScript: vitest in `tests/unit/` and `tests/integration/`
- Python: pytest in `tradingbot/tests/` and `studio/tests/`
- Test names describe behavior: `it('should return 401 when not authenticated')`

## Security
- No secrets in code, logs, or client bundles
- Environment variables for all API keys
- Parameterized queries only (via Supabase client)
- Auth on all non-public routes
- Input validation on all endpoints
- Rate limiting on public endpoints

## Performance
- Dynamic imports for heavy modules (agentBus, TradingView)
- Cache with appropriate TTL (`src/lib/cache.ts`)
- Paginate database queries
- Use `.select('specific_columns')` over `.select('*')`
- Memoize expensive React computations
