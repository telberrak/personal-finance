/**
 * Sends email: sign-in codes, and confirmations for news by email. Production uses either any SMTP
 * server (SMTP_HOST: Amazon SES, Brevo, Postmark, Mailgun…) or Resend's HTTP API (RESEND_API_KEY);
 * with neither, messages are printed to the console, which is enough for local development.
 */
import nodemailer from 'nodemailer';

export interface Mailer {
  sendCode(email: string, code: string): Promise<void>;
  /** Any other message. Optional so test doubles only need what they use. */
  send?(message: MailMessage): Promise<void>;
}

/** One plain-text email, with optional extra headers (such as List-Unsubscribe). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

/** The sign-in code email, the same whichever provider sends it. */
export const codeMessage = (email: string, code: string): MailMessage => ({
  to: email,
  subject: `Your Mizan code: ${code}`,
  text: `Your Mizan sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for it, you can ignore this email.`,
});

/** Development: prints messages instead of sending them. */
export const consoleMailer: Mailer = {
  async sendCode(email, code) {
    console.log(`[mail] sign-in code for ${email}: ${code}`);
  },
  async send({ to, subject, text }) {
    console.log(`[mail] to ${to}: ${subject}\n${text}`);
  },
};

/** Resend's reason for a refused request, with email addresses taken out (logs never hold them). */
async function resendError(res: Response): Promise<Error> {
  const detail = await res
    .json()
    .then((body) => (body as { message?: string }).message ?? '')
    .catch(() => '');
  return new Error(`Email provider returned ${res.status}${detail ? `: ${detail.replace(/\S+@\S+/g, '[email]')}` : ''}`);
}

/** Production: sends through Resend's HTTP API from a verified sender (MAIL_FROM). */
export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  async function send({ to, subject, text, headers }: MailMessage) {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, ...(headers ? { headers } : {}) }),
    });
    if (!res.ok) throw await resendError(res);
  }
  return { send, sendCode: (email, code) => send(codeMessage(email, code)) };
}

/** Where and how to reach an SMTP server. */
export interface SmtpSettings {
  host: string;
  /** 587 (STARTTLS, the default) or 465 (TLS from the start). */
  port: number;
  /** True for port 465; with 587 the connection is upgraded with STARTTLS, which is required. */
  secure: boolean;
  user?: string;
  password?: string;
}

/** The part of a Nodemailer transport the mailer uses, so tests can pass a fake. */
export interface SmtpTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; headers?: Record<string, string> }): Promise<unknown>;
}

/**
 * Production: sends through any SMTP server from a verified sender (MAIL_FROM). Port 587 must
 * offer STARTTLS: the connection is never sent in clear text.
 */
export function smtpMailer(settings: SmtpSettings, from: string, transport?: SmtpTransport): Mailer {
  const smtp: SmtpTransport =
    transport ??
    nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: !settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.password ?? '' } : undefined,
    });
  async function send({ to, subject, text, headers }: MailMessage) {
    try {
      await smtp.sendMail({ from, to, subject, text, ...(headers ? { headers } : {}) });
    } catch (err) {
      // SMTP errors can quote the recipient: logs never hold addresses.
      const reason = err instanceof Error ? err.message.replace(/\S+@\S+/g, '[email]') : 'error';
      throw new Error(`SMTP server refused the message: ${reason}`);
    }
  }
  return { send, sendCode: (email, code) => send(codeMessage(email, code)) };
}

/** SMTP settings from the environment, or undefined without SMTP_HOST. */
export function smtpSettingsFrom(env: Record<string, string | undefined>): SmtpSettings | undefined {
  if (!env.SMTP_HOST) return undefined;
  const port = Number(env.SMTP_PORT || 587);
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
  };
}

/** Keeps a mailing list in step with the subscribers table, for sending news (Resend Broadcasts). */
export interface ContactList {
  /** Adds or re-subscribes a confirmed subscriber, or marks an unsubscribed one. */
  set(email: string, subscribed: boolean, language: string): Promise<void>;
}

/**
 * Resend Contacts: created on confirmation and marked unsubscribed when someone leaves, so
 * Broadcasts only reach people who said yes. With RESEND_SEGMENT_ID, new contacts join that segment.
 */
export function resendContacts(apiKey: string, segmentId?: string, fetchImpl: typeof fetch = fetch): ContactList {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  return {
    async set(email, subscribed, language) {
      const created = await fetchImpl('https://api.resend.com/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          unsubscribed: !subscribed,
          properties: { language },
          ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
        }),
      });
      if (created.ok) return;
      // Already a contact: update their subscription instead.
      const updated = await fetchImpl(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ unsubscribed: !subscribed }),
      });
      if (!updated.ok) throw await resendError(updated);
    },
  };
}
