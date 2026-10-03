/**
 * Sends sign-in codes. Production uses Resend's HTTP API (RESEND_API_KEY); without a key the
 * code is printed to the console, which is enough for local development.
 */
export interface Mailer {
  sendCode(email: string, code: string): Promise<void>;
}

export const consoleMailer: Mailer = {
  async sendCode(email, code) {
    console.log(`[mail] sign-in code for ${email}: ${code}`);
  },
};

export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async sendCode(email, code) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: email,
          subject: `Your Ledger code: ${code}`,
          text: `Your Ledger sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for it, you can ignore this email.`,
        }),
      });
      if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
    },
  };
}
