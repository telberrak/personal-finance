/**
 * Open Banking (account information only: balances and transactions, never payments).
 *
 * Providers are behind one interface. GoCardless Bank Account Data is used when its keys are set;
 * the sandbox bank (development and tests) needs nothing. Transactions pass through the server on
 * their way to the device and are never stored here. Only the connection (bank name, status,
 * expiry) is kept, so the device can reconnect and so consent can be withdrawn.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { BankAccount, BankLink, BankTransaction, Institution } from '../shared/api.ts';
import type { Sql } from './db.ts';

/**
 * An Open Banking aggregator (GoCardless, or the sandbox bank): institutions, consent links, accounts and
 * transactions.
 */
export interface BankProvider {
  name: string;
  institutions(country: string): Promise<Institution[]>;
  /** Starts consent at the bank. The bank sends the user back to `redirect`. */
  createLink(input: {
    institutionId: string;
    redirect: string;
    reference: string;
    language: string;
  }): Promise<{ ref: string; url: string; days: number }>;
  status(ref: string): Promise<{ status: BankLink['status']; accountIds: string[] }>;
  account(id: string): Promise<BankAccount>;
  transactions(accountId: string, from: string): Promise<BankTransaction[]>;
  remove(ref: string): Promise<void>;
}

const fail = (status: 400 | 404 | 502, error: string): never => {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) });
};

const toPence = (amount: string | number) => Math.round(Number(amount) * 100);

// ------------------------------------------------------------------ sandbox

/** A pretend bank with steady, realistic transactions, so the whole flow can be tried and tested. */
export function sandboxProvider(): BankProvider {
  const linked = new Set<string>();
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  const all = (): BankTransaction[] => {
    const out: BankTransaction[] = [];
    for (let i = 1; i <= 89; i++) {
      const date = day(i);
      const dom = Number(date.slice(8, 10));
      if (i % 2 === 0) out.push({ id: `sbx-${date}-coffee`, date, amount: -320, description: 'PRET A MANGER LONDON', currency: 'GBP' });
      if (i % 7 === 3)
        out.push({ id: `sbx-${date}-tesco`, date, amount: -4385 - (i % 5) * 100, description: 'TESCO STORES 3297', currency: 'GBP' });
      if (dom === 25) out.push({ id: `sbx-${date}-salary`, date, amount: 245000, description: 'ACME LTD SALARY', currency: 'GBP' });
      if (dom === 1) out.push({ id: `sbx-${date}-rent`, date, amount: -95000, description: 'RENT STANDING ORDER', currency: 'GBP' });
      if (dom === 12) out.push({ id: `sbx-${date}-netflix`, date, amount: -1099, description: 'NETFLIX.COM', currency: 'GBP' });
    }
    return out;
  };
  return {
    name: 'sandbox',
    async institutions() {
      return [{ id: 'SANDBOX_LEDGER', name: 'Mizan Sandbox Bank', logo: null }];
    },
    async createLink({ institutionId, redirect }) {
      if (institutionId !== 'SANDBOX_LEDGER') fail(400, 'Unknown bank.');
      const ref = `sbx-${randomUUID()}`;
      linked.add(ref); // consent is given straight away
      return { ref, url: redirect, days: 90 };
    },
    async status(ref) {
      return linked.has(ref) ? { status: 'linked', accountIds: ['sbx-current'] } : { status: 'expired', accountIds: [] };
    },
    async account(id) {
      if (id !== 'sbx-current') return fail(404, 'No such account.');
      const balance = 120_000 + all().reduce((s, t) => s + t.amount, 0);
      return { id, name: 'Sandbox current account', mask: '••6789', currency: 'GBP', balance };
    },
    async transactions(accountId, from) {
      if (accountId !== 'sbx-current') return fail(404, 'No such account.');
      return all().filter((t) => t.date >= from);
    },
    async remove(ref) {
      linked.delete(ref);
    },
  };
}

// ------------------------------------------------------------------ GoCardless Bank Account Data

const GC = 'https://bankaccountdata.gocardless.com/api/v2';

interface GcTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  creditorName?: string;
  debtorName?: string;
}

/**
 * GoCardless Bank Account Data: short-lived access tokens are fetched and refreshed as needed; responses are
 * mapped to our shapes.
 */
export function goCardlessProvider(secretId: string, secretKey: string, fetchImpl: typeof fetch = fetch): BankProvider {
  let token: { value: string; until: number } | undefined;

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!token || token.until < Date.now()) {
      const res = await fetchImpl(`${GC}/token/new/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
      });
      if (!res.ok) fail(502, 'The bank data service is unavailable.');
      const data = (await res.json()) as { access: string; access_expires: number };
      token = { value: data.access, until: Date.now() + (data.access_expires - 60) * 1000 };
    }
    const res = await fetchImpl(`${GC}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json', accept: 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 429) fail(502, 'The bank has limited how often it can be read. Try again later.');
    if (!res.ok) fail(502, 'The bank data service returned an error.');
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  return {
    name: 'gocardless',
    async institutions(country) {
      const list = await call<{ id: string; name: string; logo?: string }[]>(`/institutions/?country=${encodeURIComponent(country)}`);
      return list.map((i) => ({ id: i.id, name: i.name, logo: i.logo ?? null }));
    },
    async createLink({ institutionId, redirect, reference, language }) {
      const days = 90;
      const agreement = await call<{ id: string }>('/agreements/enduser/', {
        body: {
          institution_id: institutionId,
          max_historical_days: 90,
          access_valid_for_days: days,
          access_scope: ['balances', 'details', 'transactions'],
        },
      });
      const req = await call<{ id: string; link: string }>('/requisitions/', {
        body: { redirect, institution_id: institutionId, reference, agreement: agreement.id, user_language: language.toUpperCase() },
      });
      return { ref: req.id, url: req.link, days };
    },
    async status(ref) {
      const req = await call<{ status: string; accounts: string[] }>(`/requisitions/${ref}/`);
      const status =
        req.status === 'LN' ? 'linked' : req.status === 'EX' ? 'expired' : ['RJ', 'SU'].includes(req.status) ? 'failed' : 'pending';
      return { status, accountIds: req.accounts ?? [] };
    },
    async account(id) {
      const [details, balances] = await Promise.all([
        call<{ account: { name?: string; product?: string; iban?: string; currency?: string } }>(`/accounts/${id}/details/`),
        call<{ balances: { balanceAmount: { amount: string }; balanceType: string }[] }>(`/accounts/${id}/balances/`),
      ]);
      const preferred = ['interimAvailable', 'closingBooked', 'expected', 'interimBooked'];
      const balance = [...balances.balances].sort((a, b) => preferred.indexOf(a.balanceType) - preferred.indexOf(b.balanceType))[0];
      const iban = details.account.iban;
      return {
        id,
        name: details.account.name ?? details.account.product ?? 'Account',
        mask: iban ? `••${iban.slice(-4)}` : null,
        currency: details.account.currency ?? 'GBP',
        balance: balance ? toPence(balance.balanceAmount.amount) : null,
      };
    },
    async transactions(accountId, from) {
      const res = await call<{ transactions: { booked: GcTransaction[] } }>(`/accounts/${accountId}/transactions/?date_from=${from}`);
      return res.transactions.booked.flatMap((t) => {
        const date = t.bookingDate ?? t.valueDate;
        if (!date) return [];
        const description =
          t.remittanceInformationUnstructured ??
          t.remittanceInformationUnstructuredArray?.join(' ') ??
          t.creditorName ??
          t.debtorName ??
          '';
        return [
          {
            id: t.transactionId ?? t.internalTransactionId ?? `${date}|${t.transactionAmount.amount}|${description}`,
            date,
            amount: toPence(t.transactionAmount.amount),
            description: description.trim(),
            currency: t.transactionAmount.currency,
          },
        ];
      });
    },
    async remove(ref) {
      await call(`/requisitions/${ref}/`, { method: 'DELETE' });
    },
  };
}

// ------------------------------------------------------------------ routes

type Env = { Variables: { userId: string; sessionId: string } };

/**
 * Bank connection routes for signed-in users. Only link ids and consent state are stored; transactions go
 * straight to the device.
 */
export function bankRoutes(authed: Hono<Env>, sql: Sql, provider: BankProvider | undefined, origins: string[]) {
  const need = () => provider ?? fail(404, 'Bank connections are not available on this server.');

  async function linkFor(userId: string, id: string) {
    const [row] = await sql.query<{
      id: string;
      provider_ref: string;
      institution_name: string;
      status: string;
      expires_at: Date;
      created_at: Date;
    }>('SELECT id, provider_ref, institution_name, status, expires_at, created_at FROM bank_links WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ]);
    return row ?? fail(404, 'No such bank connection.');
  }

  authed.get('/banks/available', (c) => c.json({ available: !!provider, provider: provider?.name ?? null }));

  authed.get('/banks/institutions', async (c) => {
    const country = (c.req.query('country') ?? 'GB').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) fail(400, 'Invalid country.');
    return c.json(await need().institutions(country));
  });

  authed.post('/banks/links', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      institutionId?: string;
      institutionName?: string;
      returnTo?: string;
      language?: string;
    };
    const p = need();
    if (typeof body.institutionId !== 'string' || !body.institutionId) return fail(400, 'Choose a bank.');
    // Only send people back to the app itself.
    const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '';
    if (!origins.some((o) => returnTo.startsWith(`${o}/`))) return fail(400, 'Invalid return address.');
    const id = randomUUID();
    const redirect = `${returnTo}${returnTo.includes('?') ? '&' : '?'}link=${id}`;
    const { ref, url, days } = await p.createLink({
      institutionId: body.institutionId,
      redirect,
      reference: id,
      language: body.language ?? 'en',
    });
    await sql.query(
      `INSERT INTO bank_links (id, user_id, provider, provider_ref, institution_id, institution_name, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
      [
        id,
        c.get('userId'),
        p.name,
        ref,
        body.institutionId,
        String(body.institutionName ?? body.institutionId).slice(0, 120),
        new Date(Date.now() + days * 86_400_000),
      ],
    );
    return c.json({ id, url });
  });

  authed.get('/banks/links', async (c) => {
    const rows = await sql.query<{ id: string; institution_name: string; status: string; expires_at: Date; created_at: Date }>(
      'SELECT id, institution_name, status, expires_at, created_at FROM bank_links WHERE user_id = $1 ORDER BY created_at',
      [c.get('userId')],
    );
    const links: BankLink[] = rows.map((r) => ({
      id: r.id,
      institutionName: r.institution_name,
      status: r.status as BankLink['status'],
      expiresAt: new Date(r.expires_at).toISOString(),
    }));
    return c.json(links);
  });

  /** Checks consent with the bank and lists the accounts it gave access to. */
  authed.get('/banks/links/:id/accounts', async (c) => {
    const link = await linkFor(c.get('userId'), c.req.param('id'));
    const p = need();
    const { status, accountIds } = await p.status(link.provider_ref);
    if (status !== link.status) await sql.query('UPDATE bank_links SET status = $2 WHERE id = $1', [link.id, status]);
    const accounts = status === 'linked' ? await Promise.all(accountIds.map((a) => p.account(a))) : [];
    return c.json({ status, accounts });
  });

  authed.get('/banks/links/:id/accounts/:account/transactions', async (c) => {
    const link = await linkFor(c.get('userId'), c.req.param('id'));
    const from = c.req.query('from') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) fail(400, 'Invalid date.');
    const p = need();
    const { status, accountIds } = await p.status(link.provider_ref);
    if (status !== 'linked') {
      await sql.query('UPDATE bank_links SET status = $2 WHERE id = $1', [link.id, status]);
      return fail(400, 'The bank connection has expired. Reconnect it.');
    }
    if (!accountIds.includes(c.req.param('account'))) return fail(404, 'No such account.');
    const [transactions, account] = await Promise.all([p.transactions(c.req.param('account'), from), p.account(c.req.param('account'))]);
    return c.json({ transactions, balance: account.balance });
  });

  authed.delete('/banks/links/:id', async (c) => {
    const link = await linkFor(c.get('userId'), c.req.param('id'));
    await provider?.remove(link.provider_ref).catch(() => undefined);
    await sql.query('DELETE FROM bank_links WHERE id = $1', [link.id]);
    return c.json({ ok: true });
  });
}
