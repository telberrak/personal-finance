/**
 * Settings → Accounts: list, add, edit, archive and restore accounts, with the extra fields for cards, loans
 * and mortgages, and each account's currency.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { saveAccount, setAccountArchived, ValidationError } from '../db/repo';
import { LIABILITY_TYPES, type Account, type AccountType, type FinanceData } from '../db/types';
import { currencyName, formatMoney, parseMoney } from '../lib/money';
import { nativeBalance } from '../lib/fx';
import { CURRENCIES } from '../i18n';
import { totalBalance } from '../lib/selectors';
import { t } from '../i18n';

const TYPES: AccountType[] = ['current', 'savings', 'cash', 'credit', 'loan', 'mortgage', 'investment', 'pension', 'property'];
const typeLabel = (type: AccountType) => t(`accounts.type.${type}`);

/** Signed money input: "-250.00" for a credit card balance owed. */
function parseSigned(text: string) {
  const t = text.trim();
  const neg = t.startsWith('-') || t.startsWith('−');
  const v = parseMoney(t.replace(/^[-−]/, ''));
  return v === null ? null : neg ? -v : v;
}

/** Settings → Accounts. */
export function Accounts({ data }: { data?: FinanceData }) {
  const [editing, setEditing] = useState<Account | 'new'>();
  if (!data) return <Loading />;
  const open = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);

  return (
    <main className="screen screen--modal">
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.netWorth', { amount: formatMoney(totalBalance(data, 'all')) })}
        actions={
          <button type="button" className="btn btn--solid" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            {t('accounts.add')}
          </button>
        }
      />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>

      <div className="list">
        {open.map((a) => (
          <AccountRow key={a.id} account={a} balance={nativeBalance(a, data.transactions)} onEdit={() => setEditing(a)} />
        ))}
      </div>
      <p className="small muted">
        {t('accounts.everydayNote')}
        <Link to="/add?kind=transfer">{t('nav.addTransaction')}</Link>.
      </p>

      {archived.length > 0 && (
        <section className="section">
          <h2 className="section-label">{t('accounts.archived')}</h2>
          <div className="list">
            {archived.map((a) => (
              <AccountRow key={a.id} account={a} balance={nativeBalance(a, data.transactions)} onEdit={() => setEditing(a)} />
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? t('accounts.new') : t('accounts.edit')}>
        {editing && (
          <AccountEditor
            key={editing === 'new' ? 'new' : editing.id}
            account={editing === 'new' ? undefined : editing}
            homeCurrency={data.settings.currency}
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
      <div className="grow stack" style={{ gap: 2, textAlign: 'start' }}>
        <span className="item-title">{account.name}</span>
        <span className="item-meta">
          {typeLabel(account.type)}
          {account.includeInSafeToSpend && <span className="tag">{t('accounts.everyday')}</span>}
          {account.excludeFromNetWorth && <span className="tag">{t('accounts.notInNetWorth')}</span>}
        </span>
      </div>
      <span className={'amount' + (balance < 0 ? ' text-warn' : '')}>{formatMoney(balance, { currency: account.native?.currency })}</span>
    </button>
  );
}

function AccountEditor({ account, onDone, homeCurrency }: { account?: Account; onDone: () => void; homeCurrency: string }) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'current');
  const native = account?.native;
  const [openingText, setOpeningText] = useState(account ? ((native?.openingBalance ?? account.openingBalance) / 100).toFixed(2) : '0.00');
  const [currency, setCurrency] = useState(account?.currency ?? '');
  const [everyday, setEveryday] = useState(account?.includeInSafeToSpend ?? true);
  const [inNetWorth, setInNetWorth] = useState(!account?.excludeFromNetWorth);
  const pounds = (p?: number) => (p === undefined ? '' : (p / 100).toFixed(2));
  const [aprText, setAprText] = useState(account?.apr?.toString() ?? '');
  const credit = native ? native.credit : account?.credit;
  const [limitText, setLimitText] = useState(pounds(credit?.limit));
  const [dueDay, setDueDay] = useState(credit?.dueDay ?? 0);
  const [statementDay, setStatementDay] = useState(credit?.statementDay ?? 0);
  const [minText, setMinText] = useState(pounds(credit?.minPayment));
  const [paymentText, setPaymentText] = useState(pounds(native ? native.monthlyPayment : account?.monthlyPayment));
  const liability = LIABILITY_TYPES.includes(type);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const opening = parseSigned(openingText);
    if (opening === null) return toast({ message: t('accounts.openingHint') });
    const apr = aprText.trim() ? Number(aprText.replace(',', '.')) : undefined;
    if (apr !== undefined && !(apr >= 0 && apr < 1000)) return toast({ message: t('accounts.aprHint') });
    const money = (s: string) => (s.trim() ? (parseMoney(s) ?? undefined) : undefined);
    try {
      await saveAccount({
        id: account?.id,
        name,
        type,
        openingBalance: opening,
        includeInSafeToSpend: everyday,
        excludeFromNetWorth: inNetWorth ? undefined : true,
        archived: account?.archived,
        valuations: native ? native.valuations : account?.valuations,
        currency: currency || undefined,
        apr: liability ? apr : undefined,
        credit:
          type === 'credit'
            ? { limit: money(limitText), dueDay: dueDay || undefined, statementDay: statementDay || undefined, minPayment: money(minText) }
            : undefined,
        monthlyPayment: type === 'loan' || type === 'mortgage' ? money(paymentText) : undefined,
      });
      toast({ message: account ? t('accounts.updated') : t('accounts.added') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('accounts.saveFailed') });
    }
  }

  async function toggleArchive() {
    if (!account) return;
    try {
      await setAccountArchived(account.id, !account.archived);
      toast({ message: account.archived ? t('accounts.restored') : t('accounts.archivedDone') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('accounts.archiveFailed') });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('fields.name')}>
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />}
        </Field>
        <Field label={t('fields.type')}>
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
              {TYPES.map((v) => (
                <option key={v} value={v}>
                  {typeLabel(v)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('accounts.currency')}>
          {(id) => (
            <select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">{t('accounts.homeCurrency', { currency: currencyName(homeCurrency) })}</option>
              {CURRENCIES.filter((c) => c !== homeCurrency).map((c) => (
                <option key={c} value={c}>
                  {currencyName(c)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('accounts.opening')}>
          {(id) => <input id={id} inputMode="decimal" value={openingText} onChange={(e) => setOpeningText(e.target.value)} />}
        </Field>
        {liability && (
          <Field label={t('accounts.apr')}>
            {(id) => <input id={id} inputMode="decimal" placeholder="22.9" value={aprText} onChange={(e) => setAprText(e.target.value)} />}
          </Field>
        )}
        {type === 'credit' && (
          <>
            <Field label={t('accounts.limit')}>
              {(id) => <input id={id} inputMode="decimal" value={limitText} onChange={(e) => setLimitText(e.target.value)} />}
            </Field>
            <Field label={t('accounts.statementDay')}>
              {(id) => (
                <select id={id} value={statementDay} onChange={(e) => setStatementDay(Number(e.target.value))}>
                  <option value={0}>{t('accounts.notSet')}</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {t('settings.paydayOption', { day: d })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('accounts.dueDay')}>
              {(id) => (
                <select id={id} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))}>
                  <option value={0}>{t('accounts.notSet')}</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {t('settings.paydayOption', { day: d })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('accounts.minPayment')}>
              {(id) => <input id={id} inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} />}
            </Field>
          </>
        )}
        {(type === 'loan' || type === 'mortgage') && (
          <Field label={t('accounts.monthlyPayment')}>
            {(id) => <input id={id} inputMode="decimal" value={paymentText} onChange={(e) => setPaymentText(e.target.value)} />}
          </Field>
        )}
      </div>
      <p className="small muted">{t('accounts.openingNote')}</p>
      <label className="check-row">
        <input type="checkbox" checked={everyday} onChange={(e) => setEveryday(e.target.checked)} />
        <span>
          {t('accounts.everydayAccount')}
          <span className="small muted" style={{ display: 'block' }}>
            {t('accounts.everydayHint')}
          </span>
        </span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={inNetWorth} onChange={(e) => setInNetWorth(e.target.checked)} />
        <span>
          {t('accounts.includeInNetWorth')}
          <span className="small muted" style={{ display: 'block' }}>
            {t('accounts.includeInNetWorthHint')}
          </span>
        </span>
      </label>
      <div className="grid-2">
        {account ? (
          <button type="button" className="btn" onClick={toggleArchive}>
            {account.archived ? t('common.restore') : t('common.archive')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={onDone}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn--solid">
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}
