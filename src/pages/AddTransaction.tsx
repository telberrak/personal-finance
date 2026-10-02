import { useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { catVar } from '../components/rows';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { addTransaction, deleteTransaction } from '../db/repo';
import type { FinanceData } from '../db/types';
import { today } from '../lib/dates';
import { parseMoney } from '../lib/money';

type Kind = 'expense' | 'income';

export function AddTransaction({ data }: { data?: FinanceData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('expense');
  const [amountText, setAmountText] = useState('');
  const [payee, setPayee] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string>();
  const [categoryId, setCategoryId] = useState<string>();
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Most recent category used for each payee, newest transaction first.
  const lastCategoryByPayee = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of data?.transactions ?? []) {
      const key = t.payee.toLowerCase();
      if (!map.has(key)) map.set(key, t.categoryId);
    }
    return map;
  }, [data?.transactions]);

  if (!data) return <Loading />;

  const categories = data.categories.filter((c) => c.kind === kind && c.id !== 'bills');
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? categories[0];
  const account = accountId ?? data.accounts[0]?.id;
  const amount = parseMoney(amountText);
  const canSave = !saving && amount !== null && amount > 0 && payee.trim() !== '' && !!selectedCategory && !!account;
  const payees = Array.from(new Set(data.transactions.map((t) => t.payee))).slice(0, 50);

  const close = () => (location.key === 'default' ? navigate('/', { replace: true }) : navigate(-1));

  function onPayeeChange(value: string) {
    setPayee(value);
    // Auto-categorise from history unless the user already picked a category.
    const remembered = lastCategoryByPayee.get(value.trim().toLowerCase());
    if (!categoryTouched && remembered && categories.some((c) => c.id === remembered)) setCategoryId(remembered);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave || amount === null || !selectedCategory || !account) return;
    setSaving(true);
    const now = new Date();
    const id = await addTransaction({
      accountId: account,
      date,
      time: date === today() ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : undefined,
      amount: kind === 'expense' ? -amount : amount,
      payee,
      categoryId: selectedCategory.id,
      note,
    });
    toast({
      message: `${kind === 'expense' ? 'Expense' : 'Income'} saved`,
      action: {
        label: 'Undo',
        onClick: async () => {
          await deleteTransaction(id);
        },
      },
    });
    close();
  }

  return (
    <form className="screen screen--modal" onSubmit={save}>
      <header className="screen-header">
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          <Icon name="close" size={20} strokeWidth={2} />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 600 }}>New {kind}</h1>
        <span style={{ width: 44 }} />
      </header>

      <div className="segmented" role="radiogroup" aria-label="Type">
        {(['expense', 'income'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setCategoryId(undefined);
              setCategoryTouched(false);
            }}
          >
            {k === 'expense' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>

      <MoneyInput value={amountText} onChange={setAmountText} autoFocus />

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
          {(id) => <input id={id} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />}
        </Field>
        <Field label="Account">
          {(id) => (
            <select id={id} value={account} onChange={(e) => setAccountId(e.target.value)}>
              {data.accounts.map((a) => (
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

      <button type="submit" className="btn btn--primary" disabled={!canSave} style={{ marginTop: 8 }}>
        Save {kind}
      </button>
    </form>
  );
}
