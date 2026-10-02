import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { catVar } from '../components/rows';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { addTransaction, addTransfer, deleteTransaction, saveRule, updateTransaction, updateTransfer, ValidationError } from '../db/repo';
import type { FinanceData, Transaction } from '../db/types';
import { today } from '../lib/dates';
import { parseMoney } from '../lib/money';
import { suggestCategory } from '../lib/rules';

type Kind = 'expense' | 'income' | 'transfer';
const KIND_LABEL: Record<Kind, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };

const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** /add and /transactions/:id */
export function TransactionForm({ data }: { data?: FinanceData }) {
  const { id } = useParams();
  if (!data) return <Loading />;
  const existing = id ? data.transactions.find((t) => t.id === id) : undefined;
  if (id && !existing) {
    return (
      <main className="screen screen--modal">
        <h1 className="screen-title">Transaction not found</h1>
        <p className="label">It may have been deleted.</p>
        <Link to="/activity" className="btn" style={{ alignSelf: 'flex-start' }}>
          Back to Activity
        </Link>
      </main>
    );
  }
  return <Editor key={id ?? 'new'} data={data} existing={existing} />;
}

function Editor({ data, existing }: { data: FinanceData; existing?: Transaction }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const toast = useToast();

  const pair = existing?.transferId ? data.transactions.filter((t) => t.transferId === existing.transferId) : [];
  const initialKind: Kind = existing
    ? existing.transferId
      ? 'transfer'
      : existing.amount > 0
        ? 'income'
        : 'expense'
    : ((params.get('kind') as Kind) ?? 'expense');

  const openAccounts = data.accounts.filter((a) => !a.archived || a.id === existing?.accountId);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [amountText, setAmountText] = useState(existing ? (Math.abs(existing.amount) / 100).toFixed(2) : '');
  const [payee, setPayee] = useState(existing && !existing.transferId ? existing.payee : '');
  const [date, setDate] = useState(existing?.date ?? today());
  const [accountId, setAccountId] = useState(existing?.accountId ?? params.get('account') ?? openAccounts[0]?.id);
  const [fromAccountId, setFromAccountId] = useState(pair.find((t) => t.amount < 0)?.accountId ?? openAccounts[0]?.id);
  const [toAccountId, setToAccountId] = useState(pair.find((t) => t.amount > 0)?.accountId ?? openAccounts[1]?.id);
  const [categoryId, setCategoryId] = useState<string | undefined>(existing?.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(!!existing);
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () => data.categories.filter((c) => c.kind === kind && !c.system && (!c.archived || c.id === existing?.categoryId)),
    [data.categories, kind, existing?.categoryId],
  );
  const allowed = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? categories[0];
  const amount = parseMoney(amountText);
  const linkedBill = existing?.recurringId ? data.recurring.find((r) => r.id === existing.recurringId) : undefined;
  const payees = useMemo(
    () => Array.from(new Set(data.transactions.filter((t) => !t.transferId).map((t) => t.payee))).slice(0, 80),
    [data.transactions],
  );

  const canSave =
    !saving &&
    amount !== null &&
    amount > 0 &&
    (kind === 'transfer'
      ? !!fromAccountId && !!toAccountId && fromAccountId !== toAccountId
      : payee.trim() !== '' && !!selectedCategory && !!accountId);

  const close = () => (location.key === 'default' ? navigate('/', { replace: true }) : navigate(-1));

  function onPayeeChange(value: string) {
    setPayee(value);
    if (categoryTouched) return;
    const suggested = suggestCategory(value, data.rules, data.transactions, allowed);
    if (suggested) setCategoryId(suggested);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave || amount === null) return;
    setSaving(true);
    try {
      if (kind === 'transfer') {
        const input = { fromAccountId: fromAccountId!, toAccountId: toAccountId!, amount, date, note };
        if (existing?.transferId) await updateTransfer(existing.transferId, input);
        else await addTransfer(input);
        toast({ message: existing ? 'Transfer updated' : 'Transfer saved' });
        close();
        return;
      }
      const fields = {
        accountId: accountId!,
        date,
        amount: kind === 'expense' ? -amount : amount,
        payee,
        categoryId: selectedCategory!.id,
        note,
      };
      if (existing) {
        await updateTransaction(existing.id, fields);
        const recategorised = existing.categoryId !== fields.categoryId;
        toast({
          message: 'Changes saved',
          action: recategorised
            ? {
                label: `Always ${selectedCategory!.name}`,
                onClick: async () => {
                  await saveRule({ match: 'exact', pattern: payee.trim(), categoryId: fields.categoryId });
                  toast({ message: `Future “${payee.trim()}” payments will be ${selectedCategory!.name}` });
                },
              }
            : undefined,
        });
      } else {
        const id = await addTransaction({ ...fields, time: date === today() ? nowTime() : undefined });
        toast({
          message: `${KIND_LABEL[kind]} saved`,
          action: {
            label: 'Undo',
            onClick: async () => {
              await deleteTransaction(id);
            },
          },
        });
      }
      close();
    } catch (err) {
      setSaving(false);
      toast({ message: err instanceof ValidationError ? err.message : 'Could not save. Please try again.' });
    }
  }

  async function remove() {
    if (!existing) return;
    const undo = await deleteTransaction(existing.id);
    toast({ message: existing.transferId ? 'Transfer deleted' : 'Transaction deleted', action: { label: 'Undo', onClick: undo } });
    close();
  }

  const kinds: Kind[] = existing ? (existing.transferId ? ['transfer'] : ['expense', 'income']) : ['expense', 'income', 'transfer'];

  return (
    <form className="screen screen--modal" onSubmit={save}>
      <header className="screen-header">
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          <Icon name="close" size={20} strokeWidth={2} />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 600 }}>{existing ? `Edit ${kind}` : `New ${kind}`}</h1>
        {existing ? (
          <button type="button" className="icon-btn" aria-label="Delete" onClick={remove}>
            <Icon name="trash" size={20} />
          </button>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </header>

      {kinds.length > 1 && (
        <div className="segmented" role="radiogroup" aria-label="Type">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                if (!existing) {
                  setCategoryId(undefined);
                  setCategoryTouched(false);
                }
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      <MoneyInput value={amountText} onChange={setAmountText} autoFocus={!existing} />

      {kind === 'transfer' ? (
        <div className="list">
          <Field label="From">
            {(id) => (
              <select id={id} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                {openAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <select id={id} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {openAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Date">
            {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />}
          </Field>
          <Field label="Note">
            {(id) => <input id={id} autoComplete="off" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      ) : (
        <div className="list">
          <Field label={kind === 'expense' ? 'Payee' : 'From'}>
            {(id) => (
              <input
                id={id}
                list="payees"
                autoComplete="off"
                autoCapitalize="words"
                placeholder="e.g. Tesco"
                value={payee}
                onChange={(e) => onPayeeChange(e.target.value)}
              />
            )}
          </Field>
          <datalist id="payees">
            {payees.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <Field label="Date">
            {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />}
          </Field>
          <Field label="Account">
            {(id) => (
              <select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {openAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Note">
            {(id) => <input id={id} autoComplete="off" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      )}

      {kind === 'transfer' && openAccounts.length < 2 && (
        <p className="callout small">
          You need two accounts to move money between them. <Link to="/settings/accounts">Add an account</Link>
        </p>
      )}

      {kind !== 'transfer' && (
        <div className="section">
          <span className="section-label" id="cat-label">
            Category
          </span>
          <div className="chips" role="radiogroup" aria-labelledby="cat-label">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selectedCategory?.id === c.id}
                className="chip chip--cat"
                style={catVar(c.color)}
                onClick={() => {
                  setCategoryId(c.id);
                  setCategoryTouched(true);
                }}
              >
                <span className="dot" />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {linkedBill && (
        <p className="label">
          Payment for the bill <Link to={`/bills/${linkedBill.id}`}>{linkedBill.name}</Link>.
        </p>
      )}
      {existing?.rawPayee && existing.rawPayee !== existing.payee && <p className="small muted">Bank description: {existing.rawPayee}</p>}

      <button type="submit" className="btn btn--primary" disabled={!canSave} style={{ marginTop: 8 }}>
        {existing ? 'Save changes' : `Save ${kind}`}
      </button>
    </form>
  );
}
