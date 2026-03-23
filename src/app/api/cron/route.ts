import { NextRequest, NextResponse } from 'next/server';
import {
  getPendingScheduledPosts,
  updateScheduledPostStatus,
  getScheduledReports,
  updateScheduledReport,
  saveReport,
  getAppSetting,
} from '@/lib/db';
import {
  generateWeeklyReport,
  generateForecastReport,
  generateSpeculationReport,
} from '@/services/geminiService';
import nodemailer from 'nodemailer';
import { postTweet } from '@/lib/xClient';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(request: NextRequest) {
  try {
    // Verify the cron secret
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const results: any = {
      postsProcessed: 0,
      reportsGenerated: 0,
      emailsSent: 0,
      errors: [],
    };

    // Process scheduled social posts — actually post to X
    try {
      const pending = await getPendingScheduledPosts();

      // Only post if scheduled_at is in the past (or within 5 min window)
      const now = Date.now();
      const postable = pending.filter((p: any) => {
        const scheduledAt = new Date(p.scheduled_at).getTime();
        return scheduledAt <= now + 5 * 60 * 1000;
      });

      for (const post of postable) {
        try {
          const content = (post.content || '').replace(/^\[(INSTAGRAM|SUBSTACK)\]\s*/i, '').trim();

          // Skip non-tweet content (Instagram/Substack reminders)
          if ((post.content || '').startsWith('[INSTAGRAM]') || (post.content || '').startsWith('[SUBSTACK]')) {
            await updateScheduledPostStatus(post.id, 'posted');
            results.postsProcessed++;
            continue;
          }

          // Mark as processing FIRST to prevent double-post on concurrent cron runs
          await updateScheduledPostStatus(post.id, 'processing' as any);

          // Post via shared xClient (has timeout + retry built in)
          const xResult = await postTweet(content.substring(0, 280));

          if (xResult.success) {
            console.log(`[Cron] ✓ Posted tweet ${xResult.tweetId} for scheduled post ${post.id}`);
            await updateScheduledPostStatus(post.id, 'posted');
            results.postsProcessed++;
          } else {
            console.error(`[Cron] Tweet failed for post ${post.id}: ${xResult.error} (${xResult.code})`);
            await updateScheduledPostStatus(post.id, 'failed');
            results.errors.push(`Post ${post.id}: ${xResult.error}`);
            // If rate limited, stop processing remaining posts
            if (xResult.code === 'RATE_LIMITED') {
              console.warn('[Cron] Rate limited — stopping batch');
              break;
            }
          }

          // Rate limit safety: wait 2s between tweets
          if (postable.indexOf(post) < postable.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`[Cron] Failed to post tweet for post ${post.id}:`, error);
          await updateScheduledPostStatus(post.id, 'failed');
          results.errors.push(`Post ${post.id}: ${error}`);
        }
      }
    } catch (err) {
      console.error('Scheduled posts task error:', err);
      results.errors.push(`Posts task: ${err}`);
    }

    // Process scheduled report generation
    try {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const currentDay = now.getDay().toString();
      const todayStr = now.toISOString().split('T')[0];

      const schedules = await getScheduledReports();

      for (const schedule of schedules) {
        if (!schedule.enabled) continue;

        const scheduleDays = schedule.days.split(',').map((d: string) => d.trim());
        if (!scheduleDays.includes(currentDay)) continue;

        // Check if we already ran today
        if (schedule.last_run) {
          const lastRunDate = new Date(schedule.last_run).toISOString().split('T')[0];
          if (lastRunDate === todayStr) continue;
        }

        try {
          console.log(`[Cron] Generating scheduled ${schedule.report_type} report...`);

          let report: any;
          if (schedule.report_type === 'forecast') {
            report = await generateForecastReport();
          } else if (schedule.report_type === 'speculation') {
            report = await generateSpeculationReport();
          } else {
            report = await generateWeeklyReport(schedule.report_type, schedule.custom_topic || undefined);
          }

          const reportId = `${schedule.report_type}-${Date.now()}`;
          await saveReport({
            id: reportId,
            type: schedule.report_type,
            content: report,
            custom_topic: schedule.custom_topic || undefined,
            auto_generated: true,
          });

          await updateScheduledReport(schedule.id, {
            last_run: new Date().toISOString(),
          });

          results.reportsGenerated++;
          console.log(`[Cron] ✓ Scheduled report generated: ${reportId}`);

          // Auto-send email digest if configured
          try {
            const digestEmail = await getAppSetting('digest_email');
            if (
              digestEmail &&
              process.env.SMTP_HOST &&
              process.env.SMTP_USER &&
              process.env.SMTP_PASS
            ) {
              const r = report as any;
              const headlines = r.headlines || r.events || [];
              const summary = r.analysis?.overallSummary || r.analysis?.dominantTheme || '';

              const headlinesHtml = headlines
                .slice(0, 8)
                .map(
                  (h: any, i: number) => `
                <tr style="border-bottom:1px solid #1a1a1a;">
                  <td style="padding:12px 8px;color:#f7931a;font-family:monospace;width:24px;">${String(i + 1).padStart(2, '0')}</td>
                  <td style="padding:12px 8px;">
                    <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${escapeHtml(h.title || h.expectedDate || '')}</p>
                    ${h.summary ? `<p style="margin:0;font-size:12px;color:#888;">${escapeHtml(h.summary.substring(0, 200))}</p>` : ''}
                  </td>
                </tr>`
                )
                .join('');

              const typeLabel =
                schedule.report_type.charAt(0).toUpperCase() + schedule.report_type.slice(1);

              const html = `
                <div style="background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;">
                  <div style="border-bottom:1px solid rgba(247,147,26,0.3);padding-bottom:24px;margin-bottom:24px;">
                    <p style="color:#f7931a;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px;">Intelligence Brief</p>
                    <h1 style="color:#ffffff;font-size:32px;font-style:italic;margin:0;">${escapeHtml(typeLabel)} Pulse.</h1>
                    <p style="color:#888;font-size:12px;margin:8px 0 0;">${new Date().toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}</p>
                  </div>
                  ${
                    summary
                      ? `<div style="background:rgba(247,147,26,0.05);border:1px solid rgba(247,147,26,0.2);padding:20px;margin-bottom:24px;">
                    <p style="color:#f7931a;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">Summary</p>
                    <p style="color:#d1d5db;line-height:1.6;margin:0;">${escapeHtml(summary.substring(0, 600))}</p>
                  </div>`
                      : ''
                  }
                  <table style="width:100%;border-collapse:collapse;">${headlinesHtml}</table>
                  <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(247,147,26,0.1);text-align:center;">
                    <p style="color:#444;font-family:monospace;font-size:10px;text-transform:uppercase;margin:0;">Intelligence Brief · Automated Digest</p>
                  </div>
                </div>`;

              const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_PORT === '465',
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS,
                },
              });

              await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: digestEmail,
                subject: `${typeLabel} Brief — ${new Date().toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}`,
                html,
              });

              results.emailsSent++;
              console.log(`[Cron] ✓ Email digest sent to ${digestEmail}`);
            }
          } catch (emailErr) {
            console.error('[Cron] Email digest failed:', emailErr);
            results.errors.push(`Email: ${emailErr}`);
          }
        } catch (err) {
          console.error(`[Cron] Failed to generate scheduled report ${schedule.id}:`, err);
          results.errors.push(`Report ${schedule.id}: ${err}`);
        }
      }
    } catch (err) {
      console.error('Scheduled reports task error:', err);
      results.errors.push(`Reports task: ${err}`);
    }

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error) {
    console.error('[Cron] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}
