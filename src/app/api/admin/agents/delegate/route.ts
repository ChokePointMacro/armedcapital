import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Plugin Agent → System Prompt File Map ──────────────────────────────────
// Maps agent IDs to their .claude-plugin/agents/*.md system prompts

const PLUGIN_AGENT_FILES: Record<string, string> = {
  'plugin-planner': 'planner.md',
  'plugin-architect': 'architect.md',
  'plugin-code-reviewer': 'code-reviewer.md',
  'plugin-ts-reviewer': 'typescript-reviewer.md',
  'plugin-python-reviewer': 'python-reviewer.md',
  'plugin-security': 'security-reviewer.md',
  'plugin-build-resolver': 'build-error-resolver.md',
  'plugin-e2e-runner': 'e2e-runner.md',
  'plugin-refactor': 'refactor-cleaner.md',
  'plugin-doc-updater': 'doc-updater.md',
  'plugin-db-reviewer': 'database-reviewer.md',
  'plugin-migration-reviewer': 'migration-reviewer.md',
  'plugin-auth-reviewer': 'clerk-auth-reviewer.md',
  'plugin-tradingbot-reviewer': 'tradingbot-reviewer.md',
  'plugin-market-debugger': 'market-data-debugger.md',
  'plugin-polymarket': 'polymarket-advisor.md',
  'plugin-coinbase': 'coinbase-advisor.md',
  'plugin-tv-debugger': 'tradingview-debugger.md',
  'plugin-youtube': 'youtube-pipeline.md',
  'plugin-twitter-reviewer': 'twitter-bot-reviewer.md',
  'plugin-fastapi': 'fastapi-reviewer.md',
  'plugin-agentbus-debugger': 'agent-bus-debugger.md',
  'plugin-instagram': 'instagram-reviewer.md',
  'plugin-deploy': 'deploy-advisor.md',
  'plugin-ops-monitor': 'ops-monitor.md',
  'plugin-chief-of-staff': 'chief-of-staff.md',
  'plugin-loop-operator': 'loop-operator.md',
};

// ── Load system prompt from .claude-plugin/agents/ ──────────────────────────

function loadAgentPrompt(agentId: string): string | null {
  const filename = PLUGIN_AGENT_FILES[agentId];
  if (!filename) return null;

  const pluginPath = join(process.cwd(), '.claude-plugin', 'agents', filename);
  if (!existsSync(pluginPath)) return null;

  return readFileSync(pluginPath, 'utf-8');
}

// ── POST: Delegate a task to a plugin agent via Claude ──────────────────────

export async function POST(request: NextRequest) {
  try {
    await safeAuth();

    const { agentId, task, context } = await request.json();

    if (!agentId || !task) {
      return NextResponse.json(
        { error: 'agentId and task are required' },
        { status: 400 }
      );
    }

    // Load the agent's system prompt
    const systemPrompt = loadAgentPrompt(agentId);
    if (!systemPrompt) {
      return NextResponse.json(
        { error: `Agent "${agentId}" not found or has no prompt file` },
        { status: 404 }
      );
    }

    // Check for Anthropic API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 503 }
      );
    }

    const client = new Anthropic({ apiKey });

    // Build the full system prompt with project context
    const fullSystem = [
      systemPrompt,
      '',
      '## Project Context',
      'ArmedCapital is a full-stack financial intelligence platform:',
      '- Frontend: Next.js 14, TypeScript, Tailwind CSS, TradingView widgets',
      '- Backend: Supabase (auth + DB), Clerk auth, Next.js API routes',
      '- AI: Multi-agent system (agentBus, taskQueue) with Claude-only trading AI',
      '- TradingBot: Python on DigitalOcean NYC — Polymarket + Coinbase, paper-first',
      '- Studio: FastAPI (port 8100) — YouTube Shorts + Twitter/X bot, dual LLM',
      '',
      context ? `## Additional Context\n${context}` : '',
    ].join('\n');

    // Call Claude with the agent's specialized prompt
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: fullSystem,
      messages: [
        {
          role: 'user',
          content: task,
        },
      ],
    });

    // Extract text response
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return NextResponse.json({
      agentId,
      task,
      response: responseText,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Agent delegation error:', err);
    const message = err instanceof Error ? err.message : 'Delegation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
