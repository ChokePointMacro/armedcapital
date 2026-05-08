import { Resend } from 'resend';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

/**
 * Singleton Resend client. RESEND_API_KEY is read at load time.
 * Use `sendEmail` below for typed/templated sends; the raw client is
 * exported for ad-hoc cases (attachments, scheduled, etc.).
 */
export const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_ADDRESS || 'onboarding@resend.dev';

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  /** A React Email component instance — preferred path. */
  template?: ReactElement;
  /** Or supply HTML directly (skip the template render). */
  html?: string;
  /** Plain-text fallback. Auto-derived from html if absent. */
  text?: string;
  /** Override the From address; defaults to RESEND_FROM_ADDRESS. */
  from?: string;
  /** Reply-To address (e.g. user's own inbox for transactional replies). */
  replyTo?: string | string[];
  /** Tags surface in Resend analytics. */
  tags?: { name: string; value: string }[];
}

/**
 * Type-safe send with React Email templates.
 *
 * Typical use:
 *   import { DailySynthesisEmail } from '@/emails/DailySynthesis';
 *   await sendEmail({
 *     to: process.env.RESEND_TO_ADDRESS!,
 *     subject: 'Daily Synthesis',
 *     template: DailySynthesisEmail({ date: new Date(), headlines: [...] }),
 *   });
 */
export async function sendEmail(args: SendEmailArgs) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not set — cannot send email');
  }

  const html = args.html ?? (args.template ? await render(args.template) : undefined);
  if (!html) {
    throw new Error('sendEmail requires either `template` or `html`');
  }

  return resend.emails.send({
    from: args.from ?? FROM,
    to: args.to,
    subject: args.subject,
    html,
    text: args.text,
    reply_to: args.replyTo,
    tags: args.tags,
  });
}
