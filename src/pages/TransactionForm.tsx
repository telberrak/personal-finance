/**
 * Adding and editing an expense, income or transfer (/add, /transactions/:id): suggested categories, splits,
 * foreign currency, tags, receipts, tax heading, and splitting with friends.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { catVar } from '../components/rows';
import { Sheet } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import {
  addAttachment,
  addTransaction,
  splitWithPeople,
  addTransfer,
  deleteTransaction,
  saveRule,
  updateTransaction,
  updateTransfer,
  ValidationError,
} from '../db/repo';
import { Receipts } from '../components/Receipts';
import { SplitWithFriends } from '../components/SplitWithFriends';
import { equalShare } from '../lib/friends';
import { takeSharedFiles, type PreparedFile } from '../lib/files';
import type { FinanceData, Transaction } from '../db/types';
import { today } from '../lib/dates';
import { currencyName, parseMoney } from '../lib/money';
import { CURRENCIES } from '../i18n';
import { track } from '../lib/usage';
import { allTags } from '../lib/search';
import { taxSystem } from '../lib/tax';
import { formatMoney } from '../lib/money';
import { suggestCategory } from '../lib/rules';
import { SplitEditor } from './SplitEditor';
import { t } from '../i18n';

type Kind = 'expense' | 'income' | 'transfer';
const kindLabel = (k: Kind) => t(`txForm.kind.${k}`);

const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** /add and /transactions/:id */
export function TransactionForm({ data }: { data?: FinanceData }) {
  const { id } = useParams();
  if (!data) return <Loading />;
  const existing = id ? data.transactions.find((x) => x.id === id) : undefined;
  if (id && !existing) {
    return (
      <main className="screen screen--modal">
        <h1 className="screen-title">{t('txForm.notFound')}</h1>
        <p className="label">{t('txForm.maybeDeleted')}</p>
        <Link to="/activity" className="btn" style={{ alignSelf: 'flex-start' }}>
          {t('txForm.backToActivity')}
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

  const pair = existing?.transferId ? data.transactions.filter((x) => x.transferId === existing.transferId) : [];
  const initialKind: Kind = existing
    ? existing.transferId
      ? 'transfer'
      : existing.amount > 0
        ? 'income'
        : 'expense'
    : ((params.get('kind') as Kind) ?? 'expense');

  const openAccounts = data.accounts.filter((a) => !a.archived || a.id === existing?.accountId);
  const [kind, setKind] = useState<Kind>(initialKind);
  // Foreign-currency accounts are edited in their own currency.
  const [amountText, setAmountText] = useState(existing ? (Math.abs(existing.native?.amount ?? existing.amount) / 100).toFixed(2) : '');
  const [payee, setPayee] = useState(existing && !existing.transferId ? existing.payee : '');
  const [date, setDate] = useState(existing?.date ?? today());
  const [accountId, setAccountId] = useState(existing?.accountId ?? params.get('account') ?? openAccounts[0]?.id);
  const [fromAccountId, setFromAccountId] = useState(pair.find((x) => x.amount < 0)?.accountId ?? openAccounts[0]?.id);
  const [toAccountId, setToAccountId] = useState(pair.find((x) => x.amount > 0)?.accountId ?? openAccounts[1]?.id);
  const received = pair.find((x) => x.amount > 0);
  const [toAmountText, setToAmountText] = useState(received ? ((received.native?.amount ?? received.amount) / 100).toFixed(2) : '');
  const currencyOf = (accountId?: string) => data.accounts.find((a) => a.id === accountId)?.currency ?? data.settings.currency;
  const crossCurrency = kind === 'transfer' && currencyOf(fromAccountId) !== currencyOf(toAccountId);
  // Paid abroad (expenses): the amount in the other currency; the main amount is what was charged.
  const [foreignCurrency, setForeignCurrency] = useState(existing?.foreign?.currency ?? '');
  const [foreignText, setForeignText] = useState(existing?.foreign ? (existing.foreign.amount / 100).toFixed(2) : '');
  const [categoryId, setCategoryId] = useState<string | undefined>(existing?.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(!!existing);
  const [note, setNote] = useState(existing?.note ?? '');
  const [tagsText, setTagsText] = useState(existing?.tags?.join(', ') ?? '');
  const [tax, setTax] = useState(existing?.tax ?? '');
  const [returnBy, setReturnBy] = useState(existing?.returnBy ?? '');
  const [warrantyUntil, setWarrantyUntil] = useState(existing?.warrantyUntil ?? '');
  const [pending, setPending] = useState<PreparedFile[]>([]);
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const linkedIous = existing ? data.ious.filter((i) => i.transactionId === existing.id) : [];
  // Receipts shared from another app (Web Share Target): staged as attachments of this new expense.
  useEffect(() => {
    if (!params.get('shared') || existing) return;
    void takeSharedFiles().then((files) => files.length && setPending((p) => [...p, ...files]));
  }, [params, existing]);
  const transactions = data?.transactions;
  const knownTags = useMemo(() => allTags(transactions ?? []), [transactions]);
  const [saving, setSaving] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const splitGroup = existing?.splitId
    ? data.transactions.filter((x) => x.splitId === existing.splitId).sort((a, b) => (a.splitIndex ?? 0) - (b.splitIndex ?? 0))
    : existing
      ? [existing]
      : [];
  const splitTotal = splitGroup.reduce((s, t) => s + t.amount, 0);

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
        const toAmount = crossCurrency ? (parseMoney(toAmountText) ?? undefined) : undefined;
        const input = { fromAccountId: fromAccountId!, toAccountId: toAccountId!, amount, toAmount, date, note };
        if (existing?.transferId) await updateTransfer(existing.transferId, input);
        else await addTransfer(input);
        toast({ message: existing ? t('txForm.transferUpdated') : t('txForm.transferSaved') });
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
        tags: tagsText.split(','),
        tax: tax || undefined,
        returnBy: kind === 'expense' ? returnBy || undefined : undefined,
        foreign:
          kind === 'expense' && foreignCurrency && parseMoney(foreignText)
            ? { currency: foreignCurrency, amount: parseMoney(foreignText)! }
            : undefined,
        warrantyUntil: kind === 'expense' ? warrantyUntil || undefined : undefined,
      };
      if (existing) {
        await updateTransaction(existing.id, fields);
        if (kind === 'expense' && splitWith.length)
          await splitWithPeople(
            existing.id,
            splitWith.map((personId) => ({ personId, amount: equalShare(amount, splitWith.length) })),
          );
        const recategorised = existing.categoryId !== fields.categoryId;
        toast({
          message: t('txForm.changesSaved'),
          action: recategorised
            ? {
                label: t('txForm.always', { name: selectedCategory!.name }),
                onClick: async () => {
                  await saveRule({ match: 'exact', pattern: payee.trim(), categoryId: fields.categoryId });
                  toast({ message: t('txForm.ruleCreated', { payee: payee.trim(), category: selectedCategory!.name }) });
                },
              }
            : undefined,
        });
      } else {
        const id = await addTransaction({ ...fields, time: date === today() ? nowTime() : undefined });
        track('transaction_added');
        for (const file of pending) await addAttachment({ ...file, transactionId: id });
        if (kind === 'expense' && splitWith.length)
          await splitWithPeople(
            id,
            splitWith.map((personId) => ({ personId, amount: equalShare(amount, splitWith.length) })),
          );
        toast({
          message: t(`txForm.saved.${kind}`),
          action: {
            label: t('common.undo'),
            onClick: async () => {
              await deleteTransaction(id);
            },
          },
        });
      }
      close();
    } catch (err) {
      setSaving(false);
      toast({ message: err instanceof ValidationError ? err.message : t('txForm.saveFailed') });
    }
  }

  async function remove() {
    if (!existing) return;
    const undo = await deleteTransaction(existing.id);
    const what = existing.transferId ? 'transfer' : existing.splitId ? 'split' : 'transaction';
    toast({ message: t(`txForm.deleted.${what}`), action: { label: t('common.undo'), onClick: undo } });
    close();
  }

  const kinds: Kind[] = existing
    ? existing.transferId || existing.splitId
      ? [initialKind]
      : ['expense', 'income']
    : ['expense', 'income', 'transfer'];

  return (
    <>
      <main className="screen screen--modal">
        <form className="form-contents" onSubmit={save}>
          <header className="screen-header">
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
              <Icon name="close" size={20} strokeWidth={2} />
            </button>
            <h1 style={{ fontSize: 17, fontWeight: 600 }}>{existing ? t(`txForm.edit.${kind}`) : t(`txForm.new.${kind}`)}</h1>
            {existing ? (
              <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={remove}>
                <Icon name="trash" size={20} />
              </button>
            ) : (
              <span style={{ width: 44 }} />
            )}
          </header>

          {kinds.length > 1 && (
            <div className="segmented" role="radiogroup" aria-label={t('fields.type')}>
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
                  {kindLabel(k)}
                </button>
              ))}
            </div>
          )}

          <MoneyInput value={amountText} onChange={setAmountText} autoFocus={!existing} disabled={!!existing?.splitId} />
          {existing?.splitId && (
            <p className="label" style={{ textAlign: 'center', marginTop: -8 }}>
              {t('txForm.splitInfo', { amount: formatMoney(Math.abs(splitTotal)), count: splitGroup.length })}
            </p>
          )}

          {kind === 'transfer' ? (
            <div className="list">
              <Field label={t('txForm.from')}>
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
              <Field label={t('txForm.to')}>
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
              {crossCurrency && (
                <Field label={t('txForm.amountReceived', { currency: currencyOf(toAccountId) })}>
                  {(id) => <input id={id} inputMode="decimal" value={toAmountText} onChange={(e) => setToAmountText(e.target.value)} />}
                </Field>
              )}
              <Field label={t('fields.date')}>
                {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />}
              </Field>
              <Field label={t('fields.note')}>
                {(id) => (
                  <input
                    id={id}
                    autoComplete="off"
                    placeholder={t('fields.optional')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : (
            <div className="list">
              <Field label={kind === 'expense' ? t('txForm.payee') : t('txForm.from')}>
                {(id) => (
                  <input
                    id={id}
                    list="payees"
                    autoComplete="off"
                    autoCapitalize="words"
                    placeholder={t('txForm.payeePlaceholder')}
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
              <Field label={t('fields.date')}>
                {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />}
              </Field>
              <Field label={t('fields.account')}>
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
              <Field label={t('fields.note')}>
                {(id) => (
                  <input
                    id={id}
                    autoComplete="off"
                    placeholder={t('fields.optional')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('fields.tags')}>
                {(id) => (
                  <input
                    id={id}
                    autoComplete="off"
                    list="known-tags"
                    placeholder={t('fields.tagsPlaceholder')}
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('fields.tax')}>
                {(id) => (
                  <select id={id} value={tax} onChange={(e) => setTax(e.target.value)}>
                    <option value="">{t('fields.taxNone')}</option>
                    {taxSystem(data.settings.taxCountry)
                      .headings.filter((h) => (kind === 'income' ? h.kind === 'income' : h.kind === 'expense'))
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {t(h.label)}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              <datalist id="known-tags">
                {knownTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            </div>
          )}

          {kind === 'transfer' && openAccounts.length < 2 && (
            <p className="callout small">
              {t('txForm.needTwoAccounts')} <Link to="/accounts">{t('txForm.addAccount')}</Link>
            </p>
          )}

          {kind !== 'transfer' && (
            <div className="section">
              <span className="section-label" id="cat-label">
                {t('fields.category')}
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

          {kind !== 'transfer' && (
            <Receipts
              transactionId={existing?.id}
              pending={pending}
              setPending={setPending}
              onRead={(guess) => {
                if (guess.amount !== undefined) setAmountText((guess.amount / 100).toFixed(2));
                if (guess.date) setDate(guess.date);
                if (guess.merchant && !payee.trim()) onPayeeChange(guess.merchant);
                toast({ message: t('receipts.filled') });
              }}
            />
          )}

          {kind === 'expense' && (
            <SplitWithFriends
              people={data.people}
              selected={splitWith}
              onChange={setSplitWith}
              amount={amount ?? 0}
              existing={linkedIous}
            />
          )}

          {kind === 'expense' && (
            <div className="list">
              <Field label={t('txForm.paidIn')}>
                {(id) => (
                  <select id={id} value={foreignCurrency} onChange={(e) => setForeignCurrency(e.target.value)}>
                    <option value="">{t('txForm.paidInHome')}</option>
                    {CURRENCIES.filter((c) => c !== currencyOf(accountId)).map((c) => (
                      <option key={c} value={c}>
                        {currencyName(c)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {foreignCurrency && (
                <Field label={t('txForm.foreignAmount', { currency: foreignCurrency })}>
                  {(id) => <input id={id} inputMode="decimal" value={foreignText} onChange={(e) => setForeignText(e.target.value)} />}
                </Field>
              )}
              <Field label={t('fields.returnBy')}>
                {(id) => <input id={id} type="date" value={returnBy} min={date} onChange={(e) => setReturnBy(e.target.value)} />}
              </Field>
              <Field label={t('fields.warrantyUntil')}>
                {(id) => <input id={id} type="date" value={warrantyUntil} min={date} onChange={(e) => setWarrantyUntil(e.target.value)} />}
              </Field>
            </div>
          )}

          {existing && !existing.transferId && (
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSplitOpen(true)}>
              {existing.splitId ? t('txForm.editSplit') : t('txForm.split')}
            </button>
          )}

          {linkedBill && (
            <p className="label">
              {t('txForm.billPrefix')}
              <Link to={`/bills/${linkedBill.id}`}>{linkedBill.name}</Link>
              {t('txForm.billSuffix')}
            </p>
          )}
          {existing?.rawPayee && existing.rawPayee !== existing.payee && (
            <p className="small muted">{t('txForm.bankDescription', { text: existing.rawPayee })}</p>
          )}

          <button type="submit" className="btn btn--primary" disabled={!canSave} style={{ marginTop: 8 }}>
            {existing ? t('common.saveChanges') : t(`txForm.save.${kind}`)}
          </button>
        </form>
      </main>
      {/* Outside the form: a nested form's submit would also submit this one. */}
      <Sheet
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        title={existing?.splitId ? t('txForm.editSplit') : t('txForm.splitTitle')}
      >
        {splitOpen && existing && (
          <SplitEditor
            data={data}
            group={splitGroup}
            onDone={(changed) => {
              setSplitOpen(false);
              if (changed) close();
            }}
          />
        )}
      </Sheet>
    </>
  );
}
