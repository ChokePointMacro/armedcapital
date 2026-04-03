import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import nodemailer from 'nodemailer';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { reportId, to } = await request.json();

    if (!to) {
      return NextResponse.json(
        { error: 'Recipient email (to) is required' },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json(
        {
          error: 'Email not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS to .env',
        },
        { status: 503 }
      );
    }

    // Fetch the report - in a real implementation, this would come from the database
    const reportResponse = await fetch(`/api/reports`).then(r => r.json()).catch(() => []);
    const reportRow = Array.isArray(reportResponse)
      ? reportResponse.find((r: any) => r.id === reportId)
      : null;

    if (!reportRow) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }

    const report = typeof reportRow.content === 'string'
      ? JSON.parse(reportRow.content)
      : reportRow.content;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const headlinesHtml = report.headlines
      .map(
        (h: any, i: number) => `
      <tr style="border-bottom:1px solid #1a1a1a;">
        <td style="padding:12px 8px;color:#f7931a;font-family:monospace;width:24px;">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:12px 8px;">
          <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${escapeHtml(h.title)}</p>
          <span style="font-size:11px;color:#888;font-family:monospace;text-transform:uppercase;">${escapeHtml(h.category)}</span>
          ${h.sentiment ? `<span style="margin-left:8px;font-size:10px;color:#f7931a;font-family:monospace;">${escapeHtml(h.sentiment)}</span>` : ''}
        </td>
      </tr>`
      )
      .join('');

    const html = `
      <div style="background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;">
        <div style="border-bottom:1px solid rgba(247,147,26,0.3);padding-bottom:24px;margin-bottom:24px;">
          <p style="color:#f7931a;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px;">Global Intelligence Brief</p>
          <h1 style="color:#ffffff;font-size:36px;font-style:italic;margin:0;">The Pulse.</h1>
          <p style="color:#888;font-size:12px;margin:8px 0 0;">${new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}</p>
        </div>
        <div style="background:rgba(247,147,26,0.05);border:1px solid rgba(247,147,26,0.2);padding:20px;margin-bottom:24px;">
          <p style="color:#f7931a;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">Strategic Summary</p>
          <p style="color:#d1d5db;line-height:1.6;margin:0;">${escapeHtml(report.analysis.overallSummary.substring(0, 600))}...</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${headlinesHtml}
        </table>
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(247,147,26,0.1);text-align:center;">
          <p style="color:#444;font-family:monospace;font-size:10px;text-transform:uppercase;margin:0;">Global Pulse · Intelligence Brief</p>
        </div>
      </div>`;

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `Intelligence Brief — ${new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })}`,
      html,
    });

    return NextResponse.json({
      success: true,
      messageId: info.messageId,
    });
  } catch (error) {
    console.error('[API] Email digest error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to send email: ${errorMsg}` },
      { status: 500 }
    );
  }
}
