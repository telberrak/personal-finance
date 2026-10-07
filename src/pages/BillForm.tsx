/**
 * Adding and editing a bill (/bills/new, /bills/:id), optionally prefilled from a suggested regular payment,
 * with its recent payments listed.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { useConfirm } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { deleteRecurring, saveRecurring, ValidationError } from '../db/repo';
import type { FinanceData, PaymentMethod, Recurring } from '../db/types';
import { formatDate, formatShort, today } from '../lib/dates';
import { formatMoney, parseMoney } from '../lib/money';
import { nextOccurrence, type Frequency } from '../lib/recurring';
import { t } from '../i18n';

/** What a schedule can be: a bill, or a transfer between your own accounts. */
const KINDS = ['bill', 'transfer'] as const;

/** /bills/new (optionally prefilled from a suggestion) and /bills/:id */
export function BillForm({ data }: { data?: FinanceData }) {
  const { id } = useParams();
  if (!data) return <Loading />;
  const existing = id ? data.recurring.find((r) => r.id === id) : undefined;
  if (id && !existing) {
    return (
      <main className="screen screen--modal">
        <h1 className="screen-title">{t('billForm.notFound')}</h1>
        <Link to="/bills" className="btn" style={{ alignSelf: 'flex-start' }}>
          {t('billForm.backToBills')}
        </Link>
      </main>
    );
  }
  return <Editor key={id ?? 'new'} data={data} existing={existing} />;
}

function Editor({ data, existing }: { data: FinanceData; existing?: Recurring }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();

  const accounts = data.accounts.filter((a) => !a.archived || a.id === existing?.accountId);
  const categories = data.categories.filter((c) => c.kind === 'expense' && !c.system && (!c.archived || c.id === existing?.categoryId));
  const [name, setName] = useState(existing?.name ?? params.get('name') ?? '');
  const [amountText, setAmountText] = useState(
    existing ? (existing.amount / 100).toFixed(2) : params.get('amount') ? (Number(params.get('amount')) / 100).toFixed(2) : '',
  );
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? (params.get('frequency') as Frequency) ?? 'monthly');
  const [startDate, setStartDate] = useState(existing?.startDate ?? params.get('date') ?? today());
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [trialEndsOn, setTrialEndsOn] = useState(existing?.trialEndsOn ?? '');
  const [method, setMethod] = useState<PaymentMethod>(existing?.method ?? 'direct-debit');
  const [accountId, setAccountId] = useState(existing?.accountId ?? params.get('account') ?? accounts[0]?.id);
  const [categoryId, setCategoryId] = useState(
    existing?.categoryId ?? params.get('category') ?? categories.find((c) => c.id === 'bills')?.id ?? categories[0]?.id,
  );
  const [active, setActive] = useState(existing?.active ?? true);
  // A bill, or a transfer between your own accounts on a schedule (e.g. into a Junior ISA).
  const [kind, setKind] = useState<'bill' | 'transfer'>(
    existing ? (existing.toAccountId ? 'transfer' : 'bill') : params.get('kind') === 'transfer' ? 'transfer' : 'bill',
  );
  const isTransfer = kind === 'transfer';
  const [toAccountId, setToAccountId] = useState(existing?.toAccountId ?? accounts.find((a) => a.id !== accountId)?.id);
  const [autoLog, setAutoLog] = useState(existing?.autoLog ?? true);

  const amount = parseMoney(amountText);
  // A transfer's payments come in pairs: list the money going out once.
  const payments = existing
    ? data.transactions.filter((t) => t.recurringId === existing.id && (!isTransfer || t.amount < 0)).slice(0, 6)
    : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (amount === null) return toast({ message: t('billForm.amountHint') });
    try {
      await saveRecurring({
        id: existing?.id,
        name,
        amount,
        frequency,
        startDate,
        endDate: endDate || undefined,
        trialEndsOn: trialEndsOn || undefined,
        method: isTransfer ? 'standing-order' : method,
        accountId: accountId!,
        categoryId: categoryId!,
        active,
        ...(isTransfer ? { toAccountId, autoLog, loggedThrough: existing?.loggedThrough } : {}),
      });
      const next = nextOccurrence({ startDate, frequency }, today());
      toast({
        message: existing
          ? t('billForm.updated')
          : next
            ? t(isTransfer ? 'billForm.transferAdded' : 'billForm.addedNext', { name: name.trim(), date: formatShort(next) })
            : t('billForm.added'),
      });
      navigate('/bills');
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('billForm.saveFailed') });
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm({
      title: t('billForm.deleteTitle', { name: existing.name }),
      message: t('billForm.deleteBody'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    await deleteRecurring(existing.id);
    toast({ message: t('billForm.deleted') });
    navigate('/bills');
  }

  return (
    <main className="screen screen--modal">
      <form className="form-contents" onSubmit={submit}>
        <header className="screen-header">
          <Link to="/bills" className="icon-btn" aria-label={t('billForm.back')}>
            <Icon name="close" size={20} strokeWidth={2} />
          </Link>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>
            {isTransfer
              ? existing
                ? t('billForm.editTransfer')
                : t('billForm.newTransfer')
              : existing
                ? t('billForm.edit')
                : t('billForm.new')}
          </h1>
          {existing ? (
            <button type="button" className="icon-btn" aria-label={t('billForm.delete')} onClick={remove}>
              <Icon name="trash" size={20} />
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
        </header>

        {!existing && (
          <div className="segmented" role="radiogroup" aria-label={t('billForm.kindLabel')}>
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                {t(`billForm.kind.${k}`)}
              </button>
            ))}
          </div>
        )}
        {isTransfer && <p className="small muted">{t('billForm.transferHint')}</p>}

        <MoneyInput value={amountText} onChange={setAmountText} autoFocus={!existing} />

        <div className="list">
          <Field label={t('fields.name')}>
            {(id) => (
              <input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('billForm.namePlaceholder')}
                autoComplete="off"
              />
            )}
          </Field>
          {!isTransfer && (
            <Field label={t('fields.type')}>
              {(id) => (
                <select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="direct-debit">{t('bills.method.direct-debit')}</option>
                  <option value="standing-order">{t('bills.method.standing-order')}</option>
                  <option value="card">{t('bills.method.card')}</option>
                </select>
              )}
            </Field>
          )}
          <Field label={t('billForm.repeats')}>
            {(id) => (
              <select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                <option value="weekly">{t('billForm.every.weekly')}</option>
                <option value="monthly">{t('billForm.every.monthly')}</option>
                <option value="yearly">{t('billForm.every.yearly')}</option>
              </select>
            )}
          </Field>
          <Field label={existing ? t('billForm.starts') : t('billForm.nextDue')}>
            {(id) => <input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />}
          </Field>
          <Field label={t('billForm.ends')}>
            {(id) => <input id={id} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />}
          </Field>
          {!isTransfer && (
            <Field label={t('billForm.trialEnds')}>
              {(id) => <input id={id} type="date" value={trialEndsOn} onChange={(e) => setTrialEndsOn(e.target.value)} />}
            </Field>
          )}
          <Field label={isTransfer ? t('billForm.from') : t('fields.account')}>
            {(id) => (
              <select
                id={id}
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  if (toAccountId === e.target.value) setToAccountId(accounts.find((a) => a.id !== e.target.value)?.id);
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {isTransfer ? (
            <Field label={t('billForm.to')}>
              {(id) => (
                <select id={id} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          ) : (
            <Field label={t('fields.category')}>
              {(id) => (
                <select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>

        {isTransfer && (
          <label className="check-row">
            <input type="checkbox" checked={autoLog} onChange={(e) => setAutoLog(e.target.checked)} />
            <span>
              {t('billForm.autoLog')}
              <span className="small muted" style={{ display: 'block' }}>
                {t('billForm.autoLogHint')}
              </span>
            </span>
          </label>
        )}

        {existing && (
          <label className="check-row">
            <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
            <span>
              {t('billForm.paused')}
              <span className="small muted" style={{ display: 'block' }}>
                {t('billForm.pausedHint')}
              </span>
            </span>
          </label>
        )}
        {existing?.previousAmount !== undefined && existing.previousAmount !== existing.amount && (
          <p className="small muted">
            {t('billForm.wasUntil', {
              amount: formatMoney(existing.previousAmount),
              date: existing.amountChangedOn ? formatShort(existing.amountChangedOn) : t('billForm.recently'),
            })}
          </p>
        )}

        <button type="submit" className="btn btn--primary">
          {existing ? t('common.saveChanges') : isTransfer ? t('billForm.addTransfer') : t('bills.add')}
        </button>

        {payments.length > 0 && (
          <section className="section">
            <h2 className="section-label">{t('billForm.recentPayments')}</h2>
            <div className="list">
              {payments.map((tx) => (
                <Link key={tx.id} to={`/transactions/${tx.id}`} className="list-row list-row--link">
                  <span className="grow num">{formatDate(tx.date)}</span>
                  <span className="amount">{formatMoney(tx.amount)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </form>
    </main>
  );
}
