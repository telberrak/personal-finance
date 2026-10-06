/**
 * Sends email: sign-in codes, and confirmations for news by email. Production uses Resend's HTTP
 * API (RESEND_API_KEY); without a key, messages are printed to the console, which is enough for
 * local development.
 */
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
  return {
    send,
    sendCode: (email, code) =>
      send({
        to: email,
        subject: `Your Mizan code: ${code}`,
        text: `Your Mizan sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for it, you can ignore this email.`,
      }),
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
