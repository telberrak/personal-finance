import { useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { catVar } from '../components/rows';
import { db } from '../db/db';
import type { FinanceData } from '../db/types';
import { today } from '../lib/dates';
import { newId } from '../lib/id';
import { parseMoney } from '../lib/money';

type Kind = 'expense' | 'income';

export function AddTransaction({ data }: { data?: FinanceData }) {
  const navigate = useNavigate();
  const location = useLocation();
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
    await db.transactions.add({
      id: newId(),
      accountId: account,
      date,
      time: date === today() ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : undefined,
      amount: kind === 'expense' ? -amount : amount,
      payee: payee.trim(),
      categoryId: selectedCategory.id,
      note: note.trim() || undefined,
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

      <label className="amount-input">
        <span aria-hidden="true">£</span>
        <span className="visually-hidden">Amount in pounds</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))}
          aria-invalid={amountText !== '' && amount === null}
          autoFocus
        />
      </label>

      <div className="list">
        <div className="field">
          <label htmlFor="payee">{kind === 'expense' ? 'Payee' : 'From'}</label>
          <input
            id="payee"
            list="payees"
            autoComplete="off"
            autoCapitalize="words"
            placeholder="e.g. Tesco"
            value={payee}
            onChange={(e) => onPayeeChange(e.target.value)}
          />
          <datalist id="payees">
            {payees.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
        </div>
        <div className="field">
          <label htmlFor="account">Account</label>
          <select id="account" value={account} onChange={(e) => setAccountId(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="note">Note</label>
          <input id="note" autoComplete="off" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
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
