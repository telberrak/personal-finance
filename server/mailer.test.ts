// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resendContacts, resendMailer } from './mailer.ts';

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
