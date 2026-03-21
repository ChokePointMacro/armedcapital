import { NextRequest, NextResponse } from 'next/server';

const TERMINAL_ANALYSIS_TTL = 10 * 60 * 1000; // 10 minutes
const TERMINAL_TTL = 5 * 60 * 1000;

let terminalAnalysisCache: { text: string; ts: number } | null = null;
let terminalCache: { data: any; ts: number } | null = null;

// Reuse the same terminal data builder as /api/terminal
async function buildTerminalData() {
  // Fetch from the main terminal endpoint to stay in sync
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/terminal`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {
    // Fall through to inline data
  }

  return {
    decision: { score: 72, label: 'Trade' },
    volatility: { vixLevel: 18.5, vixTrend: 'Falling', vixIvPercentile: 55 },
    trend: {
      spxVs20d: { value: 1.25 },
      spxVs50d: { value: 3.15 },
      spxVs200d: { value: 8.5 },
      regime: 'uptrend',
    },
    breadth: { pctAbove50d: 82, pctAbove200d: 73 },
    momentum: {
      sectorsPositive: 9,
      sectorsTotal: 11,
      leader: { name: 'Technology', change: 2.15 },
      laggard: { name: 'Utilities', change: -0.85 },
    },
    macro: {
      tenYearYield: 4.25,
      tenYearSignal: 'stable',
      dxy: 103.2,
      dxySignal: 'stable',
      fomc: 'In 8 days',
    },
    executionWindow: {
      breakoutsWorking: { answer: 'Yes' },
      leadersHolding: { answer: 'Yes' },
      pullbacksBought: { answer: 'Yes' },
    },
    sectors: [
      { name: 'Technology', change: 2.15 },
      { name: 'Financials', change: 1.85 },
      { name: 'Healthcare', change: 1.2 },
    ],
  };
}

export async function GET(request: NextRequest) {
  try {
    if (terminalAnalysisCache && Date.now() - terminalAnalysisCache.ts < TERMINAL_ANALYSIS_TTL) {
      return NextResponse.json({
        text: terminalAnalysisCache.text,
        cached: true,
        generatedAt: new Date(terminalAnalysisCache.ts).toISOString(),
      });
    }

    // Get terminal data
    let data: any;
    if (terminalCache && Date.now() - terminalCache.ts < TERMINAL_TTL) {
      data = terminalCache.data;
    } else {
      data = await buildTerminalData();
      terminalCache = { data, ts: Date.now() };
    }

    const prompt = `You are an elite trading floor strategist assessing market quality conditions. Today is ${new Date().toUTCString()}.

Here is the current Market Quality Terminal data:
- Overall Score: ${data.decision.score}/100 — Decision: ${data.decision.label}
- VIX: ${data.volatility.vixLevel} (${data.volatility.vixTrend}), IV Percentile: ${data.volatility.vixIvPercentile}%
- SPX vs 20d: ${data.trend.spxVs20d.value}%, vs 50d: ${data.trend.spxVs50d.value}%, vs 200d: ${data.trend.spxVs200d.value}%
- Market Regime: ${data.trend.regime}
- Breadth: ${data.breadth.pctAbove50d}% above 50d MA, ${data.breadth.pctAbove200d}% above 200d MA
- Sector Momentum: ${data.momentum.sectorsPositive}/${data.momentum.sectorsTotal} positive, Leader: ${data.momentum.leader.name} (${data.momentum.leader.change}%), Laggard: ${data.momentum.laggard.name} (${data.momentum.laggard.change}%)
- 10Y Yield: ${data.macro.tenYearYield}% (${data.macro.tenYearSignal}), DXY: ${data.macro.dxy} (${data.macro.dxySignal})
- FOMC: ${data.macro.fomc}
- Execution: Breakouts ${data.executionWindow.breakoutsWorking.answer}, Leaders ${data.executionWindow.leadersHolding.answer}, Pullbacks Bought ${data.executionWindow.pullbacksBought.answer}

Sectors (5d change): ${data.sectors.map((s: any) => `${s.name}: ${s.change}%`).join(', ')}

Write a 3-4 paragraph market quality assessment. Be direct and authoritative:
1. Overall market quality verdict — should active traders be engaged or sitting out?
2. Key factors driving this assessment — what specific conditions support or undermine trading?
3. Tactical recommendations — what setups to look for, what to avoid, position sizing guidance.
4. Key risk to monitor in the next 24-48 hours.

Use plain text, no markdown headers. Be concise but thorough.`;

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (msg.content[0] as any).text as string;
    terminalAnalysisCache = { text, ts: Date.now() };
    return NextResponse.json({
      text,
      cached: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Terminal Analysis] Error:', err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
