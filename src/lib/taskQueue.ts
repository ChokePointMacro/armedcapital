/**
 * Task Queue — Intelligent task generation engine for ArmedCapital agents.
 *
 * Evaluates each agent's responsibilities, checks current conditions
 * (time of day, last run, data freshness, market hours), and generates
 * a prioritized queue of recommended tasks with ready-to-execute prompts.
 *
 * DROP INTO: src/lib/taskQueue.ts
 */

import {
  getAgent,
  getAgents,
  checkBudget,
  checkDependencies,
  evaluateAgent,
  type AgentDefinition,
} from './agentBus';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskRecommendation {
  id: string;
  agentId: string;
  agentName: string;
  codename: string;
  title: string;
  description: string;
  prompt: string;
  runEndpoint: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  estimatedCost: string;
  reason: string;           // Why this task is recommended right now
  conditions: string[];     // What conditions triggered this recommendation
  tags: string[];
  expiresAt?: string;       // Some tasks are time-sensitive
  cooldownMinutes: number;
}

export interface TaskQueueResult {
  tasks: TaskRecommendation[];
  generatedAt: string;
  context: {
    timeOfDay: 'pre_market' | 'market_open' | 'market_hours' | 'after_hours' | 'evening' | 'overnight';
    dayOfWeek: number;      // 0=Sunday
    isWeekday: boolean;
    isWeekend: boolean;
    isMarketOpen: boolean;
    hour: number;
  };
  agentReadiness: {
    agentId: string;
    codename: string;
    ready: boolean;
    reason: string;
  }[];
  stats: {
    totalRecommended: number;
    byPriority: Record<string, number>;
    byAgent: Record<string, number>;
    estimatedTotalCost: string;
  };
}

// ── Time/Market Context ──────────────────────────────────────────────────────

export interface TimeContext {
  timeOfDay: 'pre_market' | 'market_open' | 'market_hours' | 'after_hours' | 'evening' | 'overnight';
  dayOfWeek: number;
  isWeekday: boolean;
  isWeekend: boolean;
  isMarketOpen: boolean;
  hour: number;
  dayName: string;
}

export function getTimeContext(now?: Date): TimeContext {
  const d = now ?? new Date();
  // Convert to Eastern Time (rough: UTC-5 or UTC-4 for DST)
  const utcHour = d.getUTCHours();
  const estOffset = isDST(d) ? -4 : -5;
  const etHour = (utcHour + estOffset + 24) % 24;
  const dayOfWeek = d.getUTCDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isWeekend = !isWeekday;

  // US market hours: 9:30am - 4:00pm ET
  const isMarketOpen = isWeekday && etHour >= 10 && etHour < 16; // approximate (9:30 rounds to 10)

  let timeOfDay: TimeContext['timeOfDay'];
  if (etHour >= 6 && etHour < 9) timeOfDay = 'pre_market';
  else if (etHour >= 9 && etHour < 10) timeOfDay = 'market_open';
  else if (etHour >= 10 && etHour < 16) timeOfDay = 'market_hours';
  else if (etHour >= 16 && etHour < 19) timeOfDay = 'after_hours';
  else if (etHour >= 19 && etHour < 23) timeOfDay = 'evening';
  else timeOfDay = 'overnight';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return {
    timeOfDay,
    dayOfWeek,
    isWeekday,
    isWeekend,
    isMarketOpen,
    hour: etHour,
    dayName: dayNames[dayOfWeek],
  };
}

function isDST(d: Date): boolean {
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < Math.max(jan, jul);
}

// ── Agent Responsibility Definitions ─────────────────────────────────────────
// Maps each agent's capabilities to concrete, promptable tasks
// with conditions for when each task should be recommended.

interface ResponsibilityDef {
  agentId: string;
  tasks: {
    id: string;
    title: string;
    description: string;
    promptTemplate: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    estimatedCost: string;
    tags: string[];
    cooldownMinutes: number;
    conditions: (ctx: TimeContext) => { shouldRun: boolean; reasons: string[] };
  }[];
}

const RESPONSIBILITIES: ResponsibilityDef[] = [
  // ── ORACLE (Intelligence) ────────────────────────────────────────────
  {
    agentId: 'intelligence',
    tasks: [
      {
        id: 'morning-brief',
        title: 'Morning Macro Intelligence Brief',
        description: 'Comprehensive daily market intelligence covering yields, equities, crypto, macro, and sentiment.',
        promptTemplate: `Generate a comprehensive daily macro intelligence brief for Armed Capital as of {date}.

Cover the following in structured sections with confidence ratings (1-5):

**1. Treasury & Rates** — DGS2, DGS10, T10Y2Y spread, T5YIE breakevens, FEDFUNDS. Key: is the curve steepening or flattening? What does the 2s10s say about recession probability?

**2. Equities** — SPX, QQQ, VIX positioning and key technical levels. Is VIX in contango or backwardation? Any major support/resistance tests today?

**3. Crypto** — BTC price, dominance %, ETH/SOL relative strength, DeFi TVL trends. Are funding rates positive or negative? Any major unlocks or catalysts?

**4. Macro Pulse** — Latest CPI/PCE trend, ICSA jobless claims, CFTC positioning shifts, TGA balance changes.

**5. Sentiment** — Fear & Greed index current reading + 7-day trend, put/call ratios, BTC perpetual funding rates.

**6. Key Risks & Catalysts (next 48h)** — Economic calendar events, Fed speakers, options expiry, protocol upgrades. Rate each risk probability (low/medium/high) and potential impact.

Format: Structured intelligence brief with 3-sentence executive summary at top. Use **bold** for key figures. End with overall risk posture (risk-on / risk-off / neutral) and conviction level.`,
        priority: 'high',
        estimatedCost: '$0.08',
        tags: ['daily', 'macro', 'intelligence', 'morning'],
        cooldownMinutes: 720, // 12 hours
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.isWeekday && (ctx.timeOfDay === 'pre_market' || ctx.timeOfDay === 'market_open')) {
            shouldRun = true;
            reasons.push(`It's ${ctx.dayName} ${ctx.timeOfDay.replace('_', ' ')} — prime time for the morning brief`);
          }
          if (ctx.isWeekend && ctx.hour >= 9 && ctx.hour <= 12) {
            shouldRun = true;
            reasons.push('Weekend morning — good time for a market setup overview before the week');
          }
          if (ctx.isWeekday && ctx.hour >= 6 && ctx.hour <= 10) {
            shouldRun = true;
            reasons.push('Morning window — intelligence brief should be generated before market open');
          }
          return { shouldRun, reasons };
        },
      },
      {
        id: 'weekly-risk-assessment',
        title: 'Weekly Portfolio Risk Assessment',
        description: '7-day risk analysis with sector rotation, volatility regime, and positioning review.',
        promptTemplate: `Generate the weekly Armed Capital risk assessment for the week ending {date}.

Deep analysis required:

**1. 7-Day Performance Review** — BTC, ETH, SOL, SPX, QQQ, DXY, GOLD, US10Y returns and drawdowns. Compare vs 30-day and 90-day trend. Which assets are diverging from their trend?

**2. Volatility Regime** — VIX level + term structure (contango/backwardation). Realized vs implied vol divergence for SPX and BTC. Crypto IV percentile rank (0-100). Are we in a low-vol compression or expansion regime?

**3. Sector Rotation (CFTC COT)** — Which sectors are institutions rotating into/out of? Net positioning changes for E-mini S&P, 10Y Notes, Gold, Euro FX, BTC futures. Compare this week vs 4-week average.

**4. Yield Curve Evolution** — Shape changes this week, credit spread widening/tightening (IG/HY), TED spread movement.

**5. DeFi Health** — TVL changes by chain (ETH, SOL, ARB, OP, BASE). Top protocol inflows vs outflows. Any depegging or exploit risk?

**6. Tail Risk Scenarios** — 3 specific "What could go wrong" scenarios with probability estimates and potential portfolio impact.

Output: Overall portfolio risk score 1-10, directional bias (risk-on/risk-off/neutral), confidence level (%). Include the tail risk section.`,
        priority: 'critical',
        estimatedCost: '$0.15',
        tags: ['weekly', 'risk', 'intelligence', 'portfolio'],
        cooldownMinutes: 4320, // 72 hours
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          // Best on Friday after close or Sunday evening
          if (ctx.dayOfWeek === 5 && ctx.hour >= 16) {
            shouldRun = true;
            reasons.push('Friday after-hours — ideal time for weekly risk review');
          }
          if (ctx.dayOfWeek === 0 && ctx.hour >= 17) {
            shouldRun = true;
            reasons.push('Sunday evening — prepare risk assessment before the trading week');
          }
          return { shouldRun, reasons };
        },
      },
      {
        id: 'btc-confluence',
        title: 'BTC Confluence Signal Report',
        description: 'Cross-reference on-chain, macro, technical, and sentiment for a scored BTC directional thesis.',
        promptTemplate: `Produce the Bitcoin confluence signal report for {date}.

Score each analysis layer 1-5 (1=strongly bearish, 3=neutral, 5=strongly bullish):

**Layer 1: Technical** — Weekly chart structure, key support/resistance zones, 200-week MA position relative to price, weekly RSI and MACD signal. Is there a clear pattern (H&S, wedge, channel)?

**Layer 2: Macro** — Real rates trend (T10Y minus T5YIE), DXY weekly close and trend, global M2 trajectory. Are macro winds tailwinds or headwinds for risk assets?

**Layer 3: On-Chain** — Exchange reserve trend (accumulation or distribution?), miner outflow behavior, long-term holder supply changes, MVRV ratio relative to historical bands.

**Layer 4: Sentiment** — Fear & Greed 7-day average, social volume trend, perpetual funding rate average this week. Are traders overleveraged in either direction?

**Layer 5: Positioning** — CFTC BTC futures net positioning change, options max pain level, put/call ratio, BTC ETF net flows this week.

Output: Score each layer, produce overall confluence score (5-25), classify conviction (low/medium/high), state directional bias with timeframe (1-week, 1-month). Flag any layer that disagrees with the majority.`,
        priority: 'high',
        estimatedCost: '$0.12',
        tags: ['weekly', 'btc', 'intelligence', 'confluence'],
        cooldownMinutes: 4320,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.dayOfWeek === 0 && ctx.hour >= 15) {
            shouldRun = true;
            reasons.push('Sunday afternoon — ideal time for weekly BTC confluence analysis');
          }
          if (ctx.dayOfWeek === 3 && ctx.hour >= 16) {
            shouldRun = true;
            reasons.push('Wednesday after-hours — mid-week BTC confluence check');
          }
          return { shouldRun, reasons };
        },
      },
      {
        id: 'rnd-pipeline',
        title: 'R&D Pipeline Review',
        description: 'Evaluate experimental data sources and models — ship/kill decisions.',
        promptTemplate: `Review the Armed Capital R&D pipeline as of {date}.

Evaluate each area:

**1. Active Experiments** — What alternative data sources or analytical models are being tested? (e.g., social sentiment NLP, whale wallet tracking, options flow analysis, macro leading indicators)

**2. Signal Quality** — Which experiments produced actionable signals this week? Which generated mostly noise? Rate signal-to-noise ratio 1-5 for each.

**3. Cost-Benefit** — Cost of running each data source/model vs value of insights generated. Any sources hitting rate limits or approaching paid tiers?

**4. Integration Readiness** — Which experiments have proven reliable enough to promote to production agents? What integration work is needed?

**5. Kill List** — Experiments to terminate due to low ROI, poor data quality, or redundancy with existing sources.

Output: For each experiment, recommend: SHIP (promote to production), CONTINUE (keep testing), or KILL (terminate). Justify each decision in 1-2 sentences.`,
        priority: 'low',
        estimatedCost: '$0.15',
        tags: ['weekly', 'rnd', 'intelligence'],
        cooldownMinutes: 10080, // 1 week
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.dayOfWeek === 6 && ctx.hour >= 10) {
            shouldRun = true;
            reasons.push('Saturday — good time for R&D review without market pressure');
          }
          return { shouldRun, reasons };
        },
      },
    ],
  },

  // ── SPECTRE (Market Scanner) ─────────────────────────────────────────
  {
    agentId: 'market-scanner',
    tasks: [
      {
        id: 'daily-anomaly-scan',
        title: 'Daily Market Anomaly Scan',
        description: 'Scan equities, crypto, and macro for anomalies, volume spikes, and momentum shifts.',
        promptTemplate: `Run a full daily anomaly scan across all monitored assets as of {date} {time} ET.

Check all thresholds:
- Volume spikes >2x 10-day average on any watchlist equity or crypto
- Price moves >3% in 24h on any top-20 crypto by market cap
- BTC dominance shift >1% from yesterday
- DeFi TVL changes >5% on any top-10 chain
- Stablecoin market cap changes >1% (USDT, USDC, DAI)
- Yield curve changes — any new inversions or un-inversions
- Fear & Greed index move >10 points from yesterday

Flag all anomalies with severity (low/medium/high/critical) and a 1-sentence impact assessment for each.`,
        priority: 'high',
        estimatedCost: '$0.00',
        tags: ['daily', 'scan', 'anomaly', 'data'],
        cooldownMinutes: 60,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.isWeekday && ctx.timeOfDay === 'pre_market') {
            shouldRun = true;
            reasons.push('Pre-market scan — catch overnight anomalies before open');
          }
          if (ctx.isWeekday && ctx.timeOfDay === 'after_hours') {
            shouldRun = true;
            reasons.push('After-hours scan — catch end-of-day anomalies');
          }
          if (ctx.isWeekday && ctx.timeOfDay === 'market_hours') {
            shouldRun = true;
            reasons.push('Mid-session scan — check for intraday anomalies');
          }
          // Crypto trades 24/7
          if (ctx.isWeekend && (ctx.hour >= 8 && ctx.hour <= 22)) {
            shouldRun = true;
            reasons.push('Weekend crypto scan — markets never sleep');
          }
          return { shouldRun, reasons };
        },
      },
      {
        id: 'fed-rate-analysis',
        title: 'Weekly FRED Rate Decision Analysis',
        description: 'Deep analysis of Fed-relevant data for rate path projections.',
        promptTemplate: `Comprehensive weekly Fed rate analysis as of {date}:

**1. Full Yield Curve** — DGS1M, DGS3M, DGS6M, DGS1, DGS2, DGS5, DGS7, DGS10, DGS20, DGS30 with week-over-week basis point changes. Plot the curve shape.

**2. Inflation Expectations** — T5YIE and T10YIE breakevens vs trailing realized CPI and core PCE. Are breakevens rising or falling? Gap between implied and realized.

**3. Labor Market** — ICSA initial claims 4-week trend, continuing claims, UNRATE, latest NFP. Is the labor market loosening?

**4. Financial Conditions** — DGS10 minus FEDFUNDS spread (policy restrictiveness), credit spreads (IG and HY), bank lending standards.

**5. Fed Funds Futures** — Implied probabilities for next 3 FOMC meetings: cut / hold / hike. How has this shifted week-over-week?

**6. Historical Context** — Current curve shape vs prior hiking/cutting cycle analogs. Which historical period most resembles current conditions?

Output: Fed rate path forecast with probability weightings for next 3 meetings. Clear statement on whether next move is more likely cut or hold, with conviction level.`,
        priority: 'high',
        estimatedCost: '$0.00',
        tags: ['weekly', 'fed', 'rates', 'macro'],
        cooldownMinutes: 4320,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.dayOfWeek === 5 && ctx.hour >= 17) {
            shouldRun = true;
            reasons.push('Friday evening — full week of data available for rate analysis');
          }
          return { shouldRun, reasons };
        },
      },
    ],
  },

  // ── MOSAIC (Data Enrichment) ─────────────────────────────────────────
  {
    agentId: 'data-enrichment',
    tasks: [
      {
        id: 'refresh-sources',
        title: 'Refresh All Data Sources',
        description: 'Force-refresh all 9+ enrichment data sources and verify freshness.',
        promptTemplate: `Force-refresh all enrichment data sources and report status as of {date} {time}:

Check each source and report: status (OK/STALE/FAILED), last updated timestamp, data points retrieved.

1. **FRED** — DGS2, DGS10, T10Y2Y, T5YIE, FEDFUNDS, ICSA, UNRATE, CPIAUCSL
2. **Finnhub** — Market quotes for SPY, QQQ, and watchlist equities
3. **CoinGecko** — Top 10 crypto by market cap, BTC dominance, global market cap
4. **CNN Fear & Greed** — Current index value and classification
5. **BLS** — Check for new CPI, PPI, or employment releases
6. **CFTC COT** — E-mini, 10Y, Gold, Euro FX, BTC net positioning
7. **Treasury** — TGA balance, total public debt, upcoming auction schedule
8. **DefiLlama** — Chain TVL (ETH, SOL, ARB, OP, BASE), stablecoin market caps
9. **Alternative.me** — Crypto Fear & Greed historical

Flag any source that is stale (>24h old) or failed to respond. Recommend corrective action for any failures.`,
        priority: 'medium',
        estimatedCost: '$0.00',
        tags: ['daily', 'data', 'refresh', 'infrastructure'],
        cooldownMinutes: 360, // 6 hours
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.isWeekday && ctx.hour >= 5 && ctx.hour <= 7) {
            shouldRun = true;
            reasons.push('Early morning — refresh all data before the trading day begins');
          }
          if (ctx.isWeekday && ctx.hour >= 12 && ctx.hour <= 14) {
            shouldRun = true;
            reasons.push('Midday refresh — catch any new economic releases');
          }
          if (ctx.isWeekend && ctx.hour >= 10 && ctx.hour <= 12) {
            shouldRun = true;
            reasons.push('Weekend data refresh — ensure sources are fresh for analysis');
          }
          return { shouldRun, reasons };
        },
      },
      {
        id: 'data-quality-audit',
        title: 'Weekly Data Quality Audit',
        description: 'Audit all data source reliability, freshness, and accuracy over the past 7 days.',
        promptTemplate: `Audit all data enrichment sources for the past week ending {date}:

**1. Uptime** — For each of the 9 sources, how many API calls succeeded vs failed this week? Calculate uptime percentage.

**2. Freshness** — Average data lag per source. Are any sources consistently behind by more than expected? Flag any source averaging >2h staleness.

**3. Rate Limits** — How close to rate limits per source?
   - FRED: 120 requests/min limit
   - Finnhub: 60 requests/min
   - CoinGecko: 10-30 requests/min (free tier)
   - Others: check documented limits

**4. Data Quality** — Any known discrepancies, corrections, or suspicious readings this week?

**5. Cost Tracking** — Any sources approaching paid tier thresholds? CoinGecko and Finnhub free tiers in particular.

**6. Recommendations** — Sources to add (what gaps exist?), remove (redundant?), or replace (unreliable?).

Output: Data infrastructure health score 1-10 with breakdown per source.`,
        priority: 'medium',
        estimatedCost: '$0.00',
        tags: ['weekly', 'audit', 'data', 'infrastructure'],
        cooldownMinutes: 10080,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.dayOfWeek === 1 && ctx.hour >= 6 && ctx.hour <= 10) {
            shouldRun = true;
            reasons.push('Monday morning — review last week\'s data quality before the new week');
          }
          return { shouldRun, reasons };
        },
      },
    ],
  },

  // ── HAWKEYE (TradingView Relay) ──────────────────────────────────────
  {
    agentId: 'tradingview-relay',
    tasks: [
      {
        id: 'signal-digest',
        title: 'Daily Signal Digest',
        description: 'Compile and analyze all TradingView signals from the last 24 hours.',
        promptTemplate: `Compile a digest of all TradingView webhook signals received in the last 24 hours ending {date} {time}.

Group and analyze:

**1. By Signal Type** — How many buy signals, sell signals, alerts, and indicator triggers? Which type dominated today?

**2. By Asset** — Which symbols fired the most signals? Rank top 5 most active. Any symbols with unusual signal frequency?

**3. By Timeframe** — Split intraday (1m-1h) vs swing (4h-1D) vs position (1W+) signals. Which timeframe is most active?

**4. Confluence Detection** — Flag any asset with 3+ signals pointing the same direction within 4 hours. These are the highest-conviction setups.

**5. Signal Quality** — Based on recent hit rates, which signal sources have been most accurate? Any to downweight or remove?

Output: Top 3 highest-conviction setups with full signal detail, confidence rating, and suggested action (watch / enter / avoid).`,
        priority: 'medium',
        estimatedCost: '$0.00',
        tags: ['daily', 'signals', 'tradingview', 'data'],
        cooldownMinutes: 720,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.isWeekday && ctx.timeOfDay === 'after_hours') {
            shouldRun = true;
            reasons.push('After market close — compile full day\'s signal activity');
          }
          if (ctx.isWeekday && ctx.timeOfDay === 'pre_market') {
            shouldRun = true;
            reasons.push('Pre-market — digest overnight signals before the session');
          }
          return { shouldRun, reasons };
        },
      },
    ],
  },

  // ── BROADCASTER (Auto-Schedule) ──────────────────────────────────────
  {
    agentId: 'auto-scheduler',
    tasks: [
      {
        id: 'generate-social-content',
        title: 'Generate Daily Social Content',
        description: 'Create tweet-ready content from latest intelligence for scheduled posting.',
        promptTemplate: `Using the latest market intelligence, generate 3-5 tweet-ready posts for @ChokepointMacro as of {date}.

Requirements:
- Each tweet MUST be <280 characters
- Lead with the most impactful or surprising data point
- Include relevant $TICKER cashtags or #hashtags (2-3 max per tweet)
- Mix of content types:
  1. One "key insight" tweet (connect two data points most people miss)
  2. One "data callout" tweet (striking number or stat with context)
  3. One "risk warning" tweet (what the market is ignoring)
  4. One-two optional: contrarian take, historical comparison, or question-style engagement tweet

Tone: Confident but not arrogant. Data-driven. Think "Bloomberg terminal meets fintwit."

CRITICAL: Queue ALL posts as PENDING for manual approval. Do NOT auto-publish. Include recommended posting times (staggered throughout the day, EST).`,
        priority: 'medium',
        estimatedCost: '$0.001',
        tags: ['daily', 'social', 'content', 'twitter'],
        cooldownMinutes: 720,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.isWeekday && ctx.hour >= 8 && ctx.hour <= 10) {
            shouldRun = true;
            reasons.push('Morning content generation — queue posts for the trading day');
          }
          return { shouldRun, reasons };
        },
      },
      {
        id: 'social-performance-review',
        title: 'Weekly Social Performance Review',
        description: 'Analyze posting performance, engagement patterns, and content effectiveness.',
        promptTemplate: `Review the past week's social posting performance for @ChokepointMacro ending {date}:

**1. Volume** — Posts scheduled vs actually posted vs failed. What was the success rate?

**2. Cadence** — Were there any gaps >12 hours? Any bunching (3+ posts within 2 hours)? What was the average posting interval?

**3. Content Performance** — By topic (macro, crypto, equities, risk), which category got the most engagement? By format (insight, data, risk warning, question), which format performed best?

**4. Failures** — What caused any posting failures? Are they one-offs or systemic issues?

**5. Queue Health** — Any stale pending posts (>48h old)? Any orphaned content that was never reviewed?

**6. Next Week Plan** — Based on this week's data, recommend:
   - Optimal posting schedule (times and frequency)
   - Content themes to focus on
   - Any format changes to test

Output: Actionable social ops plan for the coming week with specific posting schedule.`,
        priority: 'medium',
        estimatedCost: '$0.001',
        tags: ['weekly', 'social', 'performance', 'review'],
        cooldownMinutes: 10080,
        conditions: (ctx) => {
          const reasons: string[] = [];
          let shouldRun = false;

          if (ctx.dayOfWeek === 0 && ctx.hour >= 14 && ctx.hour <= 18) {
            shouldRun = true;
            reasons.push('Sunday afternoon — review last week\'s social performance and plan ahead');
          }
          return { shouldRun, reasons };
        },
      },
    ],
  },
];

// ── Task Queue Engine ────────────────────────────────────────────────────────

/**
 * Generate recommended tasks based on current conditions and agent readiness.
 */
export function generateTaskQueue(
  options?: {
    now?: Date;
    forceAll?: boolean;         // Ignore time conditions, show all tasks
    agentFilter?: string;       // Only show tasks for specific agent
    tagFilter?: string[];       // Only show tasks matching these tags
    lastRunTimes?: Record<string, string>; // taskId → ISO timestamp of last run
  }
): TaskQueueResult {
  const now = options?.now ?? new Date();
  const ctx = getTimeContext(now);
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = `${ctx.hour}:${now.getMinutes().toString().padStart(2, '0')}`;

  const tasks: TaskRecommendation[] = [];
  const agentReadiness: TaskQueueResult['agentReadiness'] = [];

  for (const resp of RESPONSIBILITIES) {
    // Filter by agent if requested
    if (options?.agentFilter && resp.agentId !== options.agentFilter) continue;

    const agent = getAgent(resp.agentId);
    if (!agent) continue;

    // Check agent readiness
    const deps = checkDependencies(agent);
    const budget = checkBudget(agent.id, agent.category, 0);
    const eval_ = evaluateAgent(agent.id);

    const ready = deps.healthy && budget.remaining > 0 && agent.status === 'active';
    agentReadiness.push({
      agentId: agent.id,
      codename: agent.codename,
      ready,
      reason: !deps.healthy
        ? `Missing deps: ${deps.missing.join(', ')}`
        : budget.remaining <= 0
          ? 'Budget exhausted'
          : agent.status !== 'active'
            ? `Agent status: ${agent.status}`
            : 'Ready',
    });

    for (const taskDef of resp.tasks) {
      // Tag filter
      if (options?.tagFilter && options.tagFilter.length > 0) {
        const hasMatch = options.tagFilter.some((t) => taskDef.tags.includes(t));
        if (!hasMatch) continue;
      }

      // Check time conditions (unless forceAll)
      const { shouldRun, reasons } = options?.forceAll
        ? { shouldRun: true, reasons: ['Force mode — all tasks shown'] }
        : taskDef.conditions(ctx);

      if (!shouldRun) continue;

      // Check cooldown
      if (options?.lastRunTimes?.[taskDef.id]) {
        const lastRun = new Date(options.lastRunTimes[taskDef.id]);
        const elapsed = (now.getTime() - lastRun.getTime()) / 60000;
        if (elapsed < taskDef.cooldownMinutes) {
          continue; // Still in cooldown
        }
      }

      // Hydrate prompt template
      const prompt = taskDef.promptTemplate
        .replace(/\{date\}/g, dateStr)
        .replace(/\{time\}/g, timeStr)
        .replace(/\{dayName\}/g, ctx.dayName);

      // Determine expiry (time-sensitive tasks expire after their window)
      let expiresAt: string | undefined;
      if (taskDef.tags.includes('daily')) {
        const expiry = new Date(now);
        expiry.setHours(expiry.getHours() + 4);
        expiresAt = expiry.toISOString();
      }

      tasks.push({
        id: `${taskDef.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        agentId: resp.agentId,
        agentName: agent.name,
        codename: agent.codename,
        title: taskDef.title,
        description: taskDef.description,
        prompt,
        runEndpoint: agent.runEndpoint,
        priority: taskDef.priority,
        category: agent.category,
        estimatedCost: taskDef.estimatedCost,
        reason: reasons[0] || 'Scheduled task',
        conditions: reasons,
        tags: taskDef.tags,
        expiresAt,
        cooldownMinutes: taskDef.cooldownMinutes,
      });
    }
  }

  // Sort by priority: critical > high > medium > low
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Build stats
  const byPriority: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  let totalCost = 0;

  for (const t of tasks) {
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    byAgent[t.codename] = (byAgent[t.codename] || 0) + 1;
    totalCost += parseFloat(t.estimatedCost.replace('$', '') || '0');
  }

  return {
    tasks,
    generatedAt: now.toISOString(),
    context: {
      timeOfDay: ctx.timeOfDay,
      dayOfWeek: ctx.dayOfWeek,
      isWeekday: ctx.isWeekday,
      isWeekend: ctx.isWeekend,
      isMarketOpen: ctx.isMarketOpen,
      hour: ctx.hour,
    },
    agentReadiness,
    stats: {
      totalRecommended: tasks.length,
      byPriority,
      byAgent,
      estimatedTotalCost: `$${totalCost.toFixed(4)}`,
    },
  };
}

/**
 * Get all responsibility definitions (for introspection / dashboard display).
 */
export function getResponsibilities(): ResponsibilityDef[] {
  return RESPONSIBILITIES;
}

/**
 * Get a specific task definition by its ID (without hydrated prompt).
 */
export function getTaskDefinition(taskId: string) {
  for (const resp of RESPONSIBILITIES) {
    const task = resp.tasks.find((t) => t.id === taskId);
    if (task) {
      return { agentId: resp.agentId, ...task };
    }
  }
  return null;
}

/**
 * Get all task IDs for a specific agent.
 */
export function getAgentTaskIds(agentId: string): string[] {
  const resp = RESPONSIBILITIES.find((r) => r.agentId === agentId);
  return resp ? resp.tasks.map((t) => t.id) : [];
}
