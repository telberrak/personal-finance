import { useMemo, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { addIou, deleteIou, savePerson, settleUp, ValidationError } from '../db/repo';
import type { FinanceData, Person } from '../db/types';
import { t } from '../i18n';
import { formatDate, today } from '../lib/dates';
import { balances, requestLink } from '../lib/friends';
import { formatMoney, parseMoney } from '../lib/money';

export function Friends({ data }: { data?: FinanceData }) {
  const [editing, setEditing] = useState<Person | 'new'>();
  const [open, setOpen] = useState<string>();
  const owed = useMemo(() => (data ? balances(data.people, data.ious) : new Map<string, number>()), [data]);
  if (!data) return <Loading />;
  const people = data.people.filter((p) => !p.archived);
  const toYou = [...owed.values()].reduce((s, v) => (v > 0 ? s + v : s), 0);
  const fromYou = [...owed.values()].reduce((s, v) => (v < 0 ? s - v : s), 0);
  const person = people.find((p) => p.id === open);

  return (
    <main className="screen">
      <PageHeader
        title={t('friends.title')}
        subtitle={t('friends.subtitle')}
        actions={
          <button type="button" className="btn btn--solid" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            {t('friends.add')}
          </button>
        }
      />
      <div className="stat-grid">
        <div className="card stack">
          <span className="label">{t('friends.owedToYou')}</span>
          <span className="value-md num text-pos">{formatMoney(toYou)}</span>
        </div>
        <div className="card stack">
          <span className="label">{t('friends.youOwe')}</span>
          <span className="value-md num">{formatMoney(fromYou)}</span>
        </div>
      </div>

      {people.length === 0 ? (
        <p className="label">{t('friends.empty')}</p>
      ) : (
        <div className="list">
          {people.map((p) => {
            const balance = owed.get(p.id) ?? 0;
            return (
              <button key={p.id} type="button" className="list-row list-row--button" onClick={() => setOpen(p.id)}>
                <div className="tile" aria-hidden="true">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="grow stack" style={{ gap: 2, textAlign: 'start' }}>
                  <span className="item-title" translate="no">
                    {p.name}
                  </span>
                  <span className="item-meta">
                    {balance > 0
                      ? t('friends.owesYou', { amount: formatMoney(balance) })
                      : balance < 0
                        ? t('friends.youOweThem', { amount: formatMoney(-balance) })
                        : t('friends.settled')}
                  </span>
                </div>
                <Icon name="forward" size={18} />
              </button>
            );
          })}
        </div>
      )}
      <p className="small muted">{t('friends.howTo')}</p>

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? t('friends.add') : t('friends.edit')}>
        {editing && <PersonForm person={editing === 'new' ? undefined : editing} onDone={() => setEditing(undefined)} />}
      </Sheet>
      <Sheet open={!!person} onClose={() => setOpen(undefined)} title={person?.name ?? ''}>
        {person && (
          <PersonDetails
            data={data}
            person={person}
            balance={owed.get(person.id) ?? 0}
            onEdit={() => {
              setOpen(undefined);
              setEditing(person);
            }}
          />
        )}
      </Sheet>
    </main>
  );
}

function PersonForm({ person, onDone }: { person?: Person; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(person?.name ?? '');
  const [payLink, setPayLink] = useState(person?.payLink ?? '');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await savePerson({ id: person?.id, name, payLink, archived: person?.archived });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('friends.saveFailed') });
    }
  }
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('fields.name')}>
          {(id) => <input id={id} value={name} autoFocus required onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('friends.payLink')}>
          {(id) => (
            <input
              id={id}
              type="url"
              inputMode="url"
              placeholder={t('friends.payLinkPlaceholder')}
              value={payLink}
              onChange={(e) => setPayLink(e.target.value)}
            />
          )}
        </Field>
      </div>
      <p className="small muted">{t('friends.payLinkHint')}</p>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid" disabled={!name.trim()}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

function PersonDetails({ data, person, balance, onEdit }: { data: FinanceData; person: Person; balance: number; onEdit: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'they' | 'you'>('they');
  const history = data.ious.filter((i) => i.personId === person.id);

  async function add(e: FormEvent) {
    e.preventDefault();
    const pence = parseMoney(amountText);
    if (!pence) return toast({ message: t('friends.amountHint') });
    await addIou({ personId: person.id, date: today(), amount: direction === 'they' ? pence : -pence, note });
    setAmountText('');
    setNote('');
  }

  async function settle() {
    const ok = await confirm({
      title: t('friends.settleTitle', { name: person.name }),
      message:
        balance > 0
          ? t('friends.settleTheyPaid', { amount: formatMoney(balance) })
          : t('friends.settleYouPaid', { amount: formatMoney(-balance) }),
      confirmLabel: t('friends.settle'),
    });
    if (ok) {
      await settleUp(person.id, balance, today());
      toast({ message: t('friends.settledDone') });
    }
  }

  function copyReminder() {
    const text = t('friends.reminderText', { name: person.name, amount: formatMoney(balance) });
    void navigator.clipboard?.writeText(text).then(() => toast({ message: t('friends.copied') }));
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className={balance < 0 ? 'text-warn' : ''}>
        {balance > 0
          ? t('friends.owesYou', { amount: formatMoney(balance) })
          : balance < 0
            ? t('friends.youOweThem', { amount: formatMoney(-balance) })
            : t('friends.settled')}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {balance !== 0 && (
          <button type="button" className="btn btn--solid btn--sm" onClick={() => void settle()}>
            {t('friends.settle')}
          </button>
        )}
        {balance > 0 && person.payLink && (
          <a className="btn btn--sm" href={requestLink(person.payLink, balance)} target="_blank" rel="noopener noreferrer">
            {t('friends.request', { amount: formatMoney(balance) })}
          </a>
        )}
        {balance > 0 && (
          <button type="button" className="btn btn--sm" onClick={copyReminder}>
            {t('friends.copyReminder')}
          </button>
        )}
        <button type="button" className="btn btn--sm" onClick={onEdit}>
          {t('common.edit')}
        </button>
      </div>

      <form className="stack" style={{ gap: 10 }} onSubmit={add}>
        <div className="segmented" role="radiogroup" aria-label={t('friends.direction')}>
          <button type="button" role="radio" aria-checked={direction === 'they'} onClick={() => setDirection('they')}>
            {t('friends.theyOwe', { name: person.name })}
          </button>
          <button type="button" role="radio" aria-checked={direction === 'you'} onClick={() => setDirection('you')}>
            {t('friends.iOwe', { name: person.name })}
          </button>
        </div>
        <MoneyInput value={amountText} onChange={setAmountText} label={t('common.amount')} />
        <div className="list">
          <Field label={t('fields.note')}>
            {(id) => <input id={id} value={note} placeholder={t('fields.optional')} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
        <button type="submit" className="btn" disabled={!parseMoney(amountText)}>
          {t('friends.addEntry')}
        </button>
      </form>

      {history.length > 0 && (
        <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
          {history.map((i) => (
            <li key={i.id} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}>
                <span className="item-title" translate="no">
                  {i.settlement ? t('friends.settlement') : (i.note ?? t('friends.entry'))}
                </span>
                <span className="item-meta">{formatDate(i.date)}</span>
              </div>
              <span className={'amount' + (i.amount > 0 ? ' amount--in' : '')}>{formatMoney(i.amount, { sign: true })}</span>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={t('friends.deleteEntry')}
                onClick={() => void deleteIou(i.id)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
