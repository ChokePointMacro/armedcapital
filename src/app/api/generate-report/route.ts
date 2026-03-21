import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { saveReport } from '@/lib/db';
import {
  generateWeeklyReport,
  generateForecastReport,
  generateSpeculationReport,
} from '@/services/geminiService';

const REPORT_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    const { type, customTopic } = await request.json();

    const validTypes = ['global', 'crypto', 'equities', 'nasdaq', 'conspiracies', 'custom', 'forecast', 'china', 'speculation'];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'Invalid report type' },
        { status: 400 }
      );
    }

    if (type === 'custom' && !customTopic?.trim()) {
      return NextResponse.json(
        { error: 'Custom topic text is required' },
        { status: 400 }
      );
    }

    console.log(`[API] Generating ${type} report...`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('REPORT_TIMEOUT')), REPORT_TIMEOUT_MS)
    );

    const logProgress = (stage: string, percent: number) => {
      console.log(`[API] ${type} progress: ${percent}% — ${stage}`);
    };

    let resultPromise: Promise<any>;

    if (type === 'forecast') {
      resultPromise = generateForecastReport(logProgress);
    } else if (type === 'speculation') {
      resultPromise = generateSpeculationReport(logProgress);
    } else {
      resultPromise = generateWeeklyReport(type, customTopic, logProgress);
    }

    const report = await Promise.race([resultPromise, timeoutPromise]);

    if (type === 'forecast') {
      if (!report?.events?.length) {
        return NextResponse.json(
          { error: 'Failed to generate forecast: no events returned' },
          { status: 500 }
        );
      }
      console.log(`[API] Successfully generated forecast with ${report.events.length} events`);
    } else {
      if (!report?.headlines?.length) {
        return NextResponse.json(
          { error: 'Failed to generate report: no headlines returned' },
          { status: 500 }
        );
      }
      console.log(`[API] Successfully generated ${type} report with ${report.headlines.length} headlines`);
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error('[API] Report generation error:', error);
    const message = error instanceof Error ? error.message : String(error);

    let errorType = 'UNKNOWN';
    let userMessage = message;
    let statusCode = 500;

    if (message === 'REPORT_TIMEOUT') {
      errorType = 'TIMEOUT';
      statusCode = 504;
      userMessage = 'Report generation timed out after 3 minutes. The AI provider may be slow — please try again.';
    } else if (
      message.includes('AbortError') ||
      message.includes('aborted') ||
      message.includes('cancelled') ||
      message.includes('canceled')
    ) {
      errorType = 'CANCELLED';
      statusCode = 499;
      userMessage = 'Report generation was cancelled.';
    } else if (
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('fetch failed') ||
      message.includes('network')
    ) {
      errorType = 'NETWORK_ERROR';
      statusCode = 502;
      userMessage = 'Network error — could not reach the AI provider. Check your internet connection and try again.';
    } else if (
      message.includes('rate limit') ||
      message.includes('Rate limit') ||
      message.includes('429') ||
      message.includes('quota')
    ) {
      errorType = 'RATE_LIMIT';
      statusCode = 429;
      userMessage = 'Rate limit reached. Please upgrade your API plan or wait before retrying.';
    } else if (
      message.includes('invalid_api_key') ||
      message.includes('API key') ||
      message.includes('unauthorized') ||
      message.includes('UNAUTHENTICATED')
    ) {
      errorType = 'AUTH_ERROR';
      statusCode = 401;
      userMessage = 'API authentication failed. Please check your API keys.';
    } else if (message.includes('JSON') || message.includes('parse')) {
      errorType = 'PARSING_ERROR';
      statusCode = 500;
      userMessage = 'The AI returned invalid data format. This is usually temporary — please retry.';
    } else if (message.includes('All AI providers failed')) {
      errorType = 'ALL_PROVIDERS_FAILED';
      statusCode = 503;
      userMessage = 'All AI providers are currently unavailable. Please try again.';
    }

    return NextResponse.json(
      {
        error: userMessage,
        type: errorType,
        details: message.substring(0, 200),
      },
      { status: statusCode }
    );
  }
}
