// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { codeMessage, resendContacts, resendMailer, smtpMailer, smtpSettingsFrom } from './mailer.ts';

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

function fakeFetch(answers: number[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const status = answers.shift() ?? 200;
    return new Response(JSON.stringify(status < 300 ? { id: '1' } : { message: 'Contact bob@example.com already exists' }), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('Resend', () => {
  it('sends with extra headers, and reports refusals without email addresses', async () => {
    const { calls, fetchImpl } = fakeFetch([200, 403]);
    const mailer = resendMailer('re_key', 'Mizan <mizan@mail.example.com>', fetchImpl);
    await mailer.send!({ to: 'a@example.com', subject: 'Hi', text: 'Hello', headers: { 'List-Unsubscribe': '<https://x>' } });
    expect(calls[0].body).toEqual({
      from: 'Mizan <mizan@mail.example.com>',
      to: 'a@example.com',
      subject: 'Hi',
      text: 'Hello',
      headers: { 'List-Unsubscribe': '<https://x>' },
    });
    await expect(mailer.sendCode('a@example.com', '123456')).rejects.toThrow('Email provider returned 403: Contact [email] already exists');
  });

  it('adds contacts to the segment, and updates them when they already exist', async () => {
    const { calls, fetchImpl } = fakeFetch([200, 409, 200]);
    const list = resendContacts('re_key', 'seg_1', fetchImpl);
    await list.set('bob@example.com', true, 'fr');
    expect(calls[0]).toMatchObject({
      url: 'https://api.resend.com/contacts',
      method: 'POST',
      body: { email: 'bob@example.com', unsubscribed: false, properties: { language: 'fr' }, segments: [{ id: 'seg_1' }] },
    });
    await list.set('bob@example.com', false, 'fr');
    expect(calls[2]).toMatchObject({
      url: 'https://api.resend.com/contacts/bob%40example.com',
      method: 'PATCH',
      body: { unsubscribed: true },
    });
  });
});

describe('SMTP', () => {
  it('sends with the sender, headers and the shared sign-in wording', async () => {
    const sent: unknown[] = [];
    const mailer = smtpMailer({ host: 'smtp.example.com', port: 587, secure: false }, 'Mizan <mizan@mail.example.com>', {
      sendMail: async (m) => void sent.push(m),
    });
    await mailer.send!({ to: 'a@example.com', subject: 'Hi', text: 'Hello', headers: { 'List-Unsubscribe': '<https://x>' } });
    await mailer.sendCode('a@example.com', '123456');
    expect(sent).toEqual([
      {
        from: 'Mizan <mizan@mail.example.com>',
        to: 'a@example.com',
        subject: 'Hi',
        text: 'Hello',
        headers: { 'List-Unsubscribe': '<https://x>' },
      },
      { from: 'Mizan <mizan@mail.example.com>', ...codeMessage('a@example.com', '123456') },
    ]);
  });

  it('reports refusals without email addresses', async () => {
    const mailer = smtpMailer({ host: 'smtp.example.com', port: 587, secure: false }, 'Mizan <m@example.com>', {
      sendMail: async () => {
        throw new Error('550 Mailbox a@example.com unavailable');
      },
    });
    await expect(mailer.sendCode('a@example.com', '1')).rejects.toThrow('SMTP server refused the message: 550 Mailbox [email] unavailable');
  });

  it('reads its settings from the environment: STARTTLS on 587 by default, TLS on 465', () => {
    expect(smtpSettingsFrom({})).toBeUndefined();
    expect(smtpSettingsFrom({ SMTP_HOST: 'email-smtp.eu-west-2.amazonaws.com', SMTP_USER: 'AKIA', SMTP_PASSWORD: 'secret' })).toEqual({
      host: 'email-smtp.eu-west-2.amazonaws.com',
      port: 587,
      secure: false,
      user: 'AKIA',
      password: 'secret',
    });
    expect(smtpSettingsFrom({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465' })).toMatchObject({ port: 465, secure: true });
  });
});
