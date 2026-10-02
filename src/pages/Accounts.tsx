import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { saveAccount, setAccountArchived, ValidationError } from '../db/repo';
import type { Account, AccountType, FinanceData } from '../db/types';
import { formatMoney, parseMoney } from '../lib/money';
import { accountBalance, totalBalance } from '../lib/selectors';

const TYPE_LABEL: Record<AccountType, string> = { current: 'Current account', savings: 'Savings', credit: 'Credit card', cash: 'Cash' };

/** Signed money input: "-250.00" for a credit card balance owed. */
function parseSigned(text: string) {
  const t = text.trim();
  const neg = t.startsWith('-') || t.startsWith('−');
  const v = parseMoney(t.replace(/^[-−]/, ''));
  return v === null ? null : neg ? -v : v;
}

export function Accounts({ data }: { data?: FinanceData }) {
  const [editing, setEditing] = useState<Account | 'new'>();
  if (!data) return <Loading />;
  const open = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);

  return (
    <main className="screen screen--modal">
      <PageHeader
        title="Accounts"
        subtitle={`Net worth ${formatMoney(totalBalance(data, 'all'))}`}
        actions={
          <button type="button" className="btn btn--solid" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            Add account
          </button>
        }
      />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        ‹ Settings
      </Link>

      <div className="list">
        {open.map((a) => (
          <AccountRow key={a.id} account={a} balance={accountBalance(a, data.transactions)} onEdit={() => setEditing(a)} />
        ))}
      </div>
      <p className="small muted">
        “Safe to spend” uses accounts marked as everyday. Move money between accounts with a transfer from{' '}
        <Link to="/add?kind=transfer">Add transaction</Link>.
      </p>

      {archived.length > 0 && (
        <section className="section">
          <h2 className="section-label">Archived</h2>
          <div className="list">
            {archived.map((a) => (
              <AccountRow key={a.id} account={a} balance={accountBalance(a, data.transactions)} onEdit={() => setEditing(a)} />
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? 'New account' : 'Edit account'}>
        {editing && (
          <AccountEditor
            key={editing === 'new' ? 'new' : editing.id}
            account={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Sheet>
    </main>
  );
}

function AccountRow({ account, balance, onEdit }: { account: Account; balance: number; onEdit: () => void }) {
  return (
    <button type="button" className="list-row list-row--button" onClick={onEdit}>
      <div className="tile" aria-hidden="true">
        <Icon name="wallet" size={20} />
      </div>
      <div className="grow stack" style={{ gap: 2, textAlign: 'left' }}>
        <span className="item-title">{account.name}</span>
        <span className="item-meta">
          {TYPE_LABEL[account.type]}
          {account.includeInSafeToSpend && <span className="tag">Everyday</span>}
        </span>
      </div>
      <span className={'amount' + (balance < 0 ? ' text-warn' : '')}>{formatMoney(balance)}</span>
    </button>
  );
}

function AccountEditor({ account, onDone }: { account?: Account; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'current');
  const [openingText, setOpeningText] = useState(account ? (account.openingBalance / 100).toFixed(2) : '0.00');
  const [everyday, setEveryday] = useState(account?.includeInSafeToSpend ?? true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const opening = parseSigned(openingText);
    if (opening === null) return toast({ message: 'Enter the opening balance as an amount, e.g. 250 or -120.50' });
    try {
      await saveAccount({
        id: account?.id,
        name,
        type,
        openingBalance: opening,
        includeInSafeToSpend: everyday,
        archived: account?.archived,
      });
      toast({ message: account ? 'Account updated' : 'Account added' });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not save the account.' });
    }
  }

  async function toggleArchive() {
    if (!account) return;
    try {
      await setAccountArchived(account.id, !account.archived);
      toast({ message: account.archived ? 'Account restored' : 'Account archived' });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not archive the account.' });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label="Name">
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />}
        </Field>
        <Field label="Type">
          {(id) => (
            <select
              id={id}
              value={type}
              onChange={(e) => {
                const t = e.target.value as AccountType;
                setType(t);
                if (!account) setEveryday(t === 'current' || t === 'cash');
              }}
            >
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Opening">
          {(id) => <input id={id} inputMode="decimal" value={openingText} onChange={(e) => setOpeningText(e.target.value)} />}
        </Field>
      </div>
      <p className="small muted">
        Opening balance is what the account held before the first transaction you record here. Use a minus sign for money owed on a card.
      </p>
      <label className="check-row">
        <input type="checkbox" checked={everyday} onChange={(e) => setEveryday(e.target.checked)} />
        <span>
          Everyday account
          <span className="small muted" style={{ display: 'block' }}>
            Counted in “safe to spend”
          </span>
        </span>
      </label>
      <div className="grid-2">
        {account ? (
          <button type="button" className="btn" onClick={toggleArchive}>
            {account.archived ? 'Restore' : 'Archive'}
          </button>
        ) : (
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn--solid">
          Save
        </button>
      </div>
    </form>
  );
}
