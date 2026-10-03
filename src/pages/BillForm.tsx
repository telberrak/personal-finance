import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { useConfirm } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { deleteRecurring, saveRecurring, ValidationError } from '../db/repo';
import type { FinanceData, PaymentMethod, Recurring } from '../db/types';
import { today } from '../lib/dates';
import { formatMoney, parseMoney } from '../lib/money';
import type { Frequency } from '../lib/recurring';

/** /bills/new (optionally prefilled from a suggestion) and /bills/:id */
export function BillForm({ data }: { data?: FinanceData }) {
  const { id } = useParams();
  if (!data) return <Loading />;
  const existing = id ? data.recurring.find((r) => r.id === id) : undefined;
  if (id && !existing) {
    return (
      <main className="screen screen--modal">
        <h1 className="screen-title">Bill not found</h1>
        <Link to="/bills" className="btn" style={{ alignSelf: 'flex-start' }}>
          Back to Bills
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
  const [method, setMethod] = useState<PaymentMethod>(existing?.method ?? 'direct-debit');
  const [accountId, setAccountId] = useState(existing?.accountId ?? params.get('account') ?? accounts[0]?.id);
  const [categoryId, setCategoryId] = useState(
    existing?.categoryId ?? params.get('category') ?? categories.find((c) => c.id === 'bills')?.id ?? categories[0]?.id,
  );
  const [active, setActive] = useState(existing?.active ?? true);

  const amount = parseMoney(amountText);
  const payments = existing ? data.transactions.filter((t) => t.recurringId === existing.id).slice(0, 6) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (amount === null) return toast({ message: 'Enter the amount, e.g. 9.99' });
    try {
      await saveRecurring({
        id: existing?.id,
        name,
        amount,
        frequency,
        startDate,
        endDate: endDate || undefined,
        method,
        accountId: accountId!,
        categoryId: categoryId!,
        active,
      });
      toast({ message: existing ? 'Bill updated' : 'Bill added' });
      navigate('/bills');
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not save the bill.' });
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete ${existing.name}?`,
      message: 'Its past payments stay in Activity as ordinary transactions.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteRecurring(existing.id);
    toast({ message: 'Bill deleted' });
    navigate('/bills');
  }

  return (
    <main className="screen screen--modal">
      <form className="form-contents" onSubmit={submit}>
        <header className="screen-header">
          <Link to="/bills" className="icon-btn" aria-label="Back to bills">
            <Icon name="close" size={20} strokeWidth={2} />
          </Link>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>{existing ? 'Edit bill' : 'New bill'}</h1>
          {existing ? (
            <button type="button" className="icon-btn" aria-label="Delete bill" onClick={remove}>
              <Icon name="trash" size={20} />
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
        </header>

        <MoneyInput value={amountText} onChange={setAmountText} autoFocus={!existing} />

        <div className="list">
          <Field label="Name">
            {(id) => (
              <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Council Tax" autoComplete="off" />
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="direct-debit">Direct debit</option>
                <option value="standing-order">Standing order</option>
                <option value="card">Card subscription</option>
              </select>
            )}
          </Field>
          <Field label="Repeats">
            {(id) => (
              <select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            )}
          </Field>
          <Field label={existing ? 'Starts' : 'Next due'}>
            {(id) => <input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />}
          </Field>
          <Field label="Ends">
            {(id) => <input id={id} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />}
          </Field>
          <Field label="Account">
            {(id) => (
              <select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Category">
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
        </div>

        {existing && (
          <label className="check-row">
            <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
            <span>
              Paused
              <span className="small muted" style={{ display: 'block' }}>
                Hidden from upcoming bills and “safe to spend”
              </span>
            </span>
          </label>
        )}
        {existing?.previousAmount !== undefined && existing.previousAmount !== existing.amount && (
          <p className="small muted">
            Was {formatMoney(existing.previousAmount)} until {existing.amountChangedOn ?? 'recently'}.
          </p>
        )}

        <button type="submit" className="btn btn--primary">
          {existing ? 'Save changes' : 'Add bill'}
        </button>

        {payments.length > 0 && (
          <section className="section">
            <h2 className="section-label">Recent payments</h2>
            <div className="list">
              {payments.map((t) => (
                <Link key={t.id} to={`/transactions/${t.id}`} className="list-row list-row--link">
                  <span className="grow num">{t.date}</span>
                  <span className="amount">{formatMoney(t.amount)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </form>
    </main>
  );
}
