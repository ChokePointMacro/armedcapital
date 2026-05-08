import Anthropic from '@anthropic-ai/sdk';

/**
 * Singleton Anthropic client. Reuses HTTP keepalive across calls instead of
 * the per-request `new Anthropic(...)` pattern that aiService.ts uses today.
 *
 * Model choice rationale (2026-05): claude-sonnet-4-6 is the latest/most
 * capable Sonnet for cost-effective structured summarization at the
 * projected daily synthesis volume. Revisit when Sonnet 4.7+ ships.
 */
let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
  }
  return _client;
}

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface CachedSystemMessageArgs {
  /** The static system prompt. Marked cache_control:ephemeral so Anthropic
   *  caches it across calls — first hit pays full read, subsequent hits read
   *  the cache (90% cheaper). Goal: daily synthesis system prompt. */
  systemPrompt: string;
  /** The user-turn content. */
  userMessage: string;
  /** Override default. */
  model?: string;
  /** Default 4096. */
  maxTokens?: number;
  /** Optional temperature override. */
  temperature?: number;
}

/**
 * Single-turn completion with prompt caching enabled on the system message.
 *
 * Usage:
 *   const text = await completeWithCachedSystem({
 *     systemPrompt: DAILY_SYNTHESIS_SYSTEM_PROMPT,
 *     userMessage: `Today's headlines:\n${headlines}`,
 *   });
 *
 * For streaming or multi-turn, call `anthropic().messages.create(...)` directly.
 */
export async function completeWithCachedSystem(args: CachedSystemMessageArgs): Promise<string> {
  const client = anthropic();

  const response = await client.messages.create({
    model: args.model ?? DEFAULT_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    temperature: args.temperature,
    system: [
      {
        type: 'text',
        text: args.systemPrompt,
        // Anthropic caches this block server-side. First call: cache_creation
        // tokens, charged at full rate. Subsequent calls within ~5min: cache_read
        // tokens at ~10% of input rate.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: args.userMessage }],
  });

  // Concatenate text blocks (Anthropic responses can have multiple).
  return response.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((b) => b.text)
    .join('');
}
