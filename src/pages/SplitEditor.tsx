import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui/Toast';
import { mergeSplit, splitTransaction, ValidationError } from '../db/repo';
import type { FinanceData, Transaction } from '../db/types';
import { formatMoney, parseMoney, zeroPlaceholder } from '../lib/money';
import { t } from '../i18n';

interface Row {
  key: number;
  categoryId: string;
  text: string;
  note: string;
}

const toText = (pence: number) => (pence / 100).toFixed(2);

/** Sheet content for dividing one payment across categories. `group` is the payment's current pieces. */
export function SplitEditor({ data, group, onDone }: { data: FinanceData; group: Transaction[]; onDone: (changed: boolean) => void }) {
  const toast = useToast();
  const total = Math.abs(group.reduce((s, t) => s + t.amount, 0));
  const kind = group[0].amount < 0 ? 'expense' : 'income';
  const categories = data.categories.filter((c) => c.kind === kind && !c.system && !c.archived);
  const isSplit = !!group[0].splitId;

  const [rows, setRows] = useState<Row[]>(() =>
    isSplit
      ? group.map((t, i) => ({ key: i, categoryId: t.categoryId, text: toText(Math.abs(t.amount)), note: t.note ?? '' }))
      : [
          { key: 0, categoryId: group[0].categoryId, text: toText(total), note: group[0].note ?? '' },
          { key: 1, categoryId: categories.find((c) => c.id !== group[0].categoryId)?.id ?? group[0].categoryId, text: '', note: '' },
        ],
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const [busy, setBusy] = useState(false);

  const amounts = rows.map((r) => parseMoney(r.text));
  const assigned = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const remaining = total - assigned;
  const valid = rows.length >= 2 && amounts.every((a) => a !== null && a > 0) && remaining === 0;

  const update = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow() {
    setRows([...rows, { key: nextKey, categoryId: categories[0]?.id ?? '', text: remaining > 0 ? toText(remaining) : '', note: '' }]);
    setNextKey(nextKey + 1);
  }

  /** Puts whatever is unassigned into the first row, which usually holds "the rest". */
  function balanceFirst() {
    const others = amounts.slice(1).reduce<number>((s, a) => s + (a ?? 0), 0);
    update(rows[0].key, { text: toText(Math.max(0, total - others)) });
  }

  /** Equal shares, any odd pennies on the first row. */
  function splitEvenly() {
    const share = Math.floor(total / rows.length);
    const extra = total - share * rows.length;
    setRows(rows.map((r, i) => ({ ...r, text: toText(share + (i === 0 ? extra : 0)) })));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // never let this submit a surrounding form
    if (!valid) return;
    setBusy(true);
    try {
      const undo = await splitTransaction(
        group[0].id,
        rows.map((r, i) => ({ categoryId: r.categoryId, amount: amounts[i]!, note: r.note })),
      );
      toast({ message: t('split.done', { count: rows.length }), action: { label: t('common.undo'), onClick: undo } });
      onDone(true);
    } catch (err) {
      setBusy(false);
      toast({ message: err instanceof ValidationError ? err.message : t('split.failed') });
    }
  }

  async function unsplit() {
    const undo = await mergeSplit(group[0].id);
    toast({ message: t('split.removed'), action: { label: t('common.undo'), onClick: undo } });
    onDone(true);
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="label">{t('split.intro', { payee: group[0].payee, amount: formatMoney(total) })}</p>
      <div className="stack" style={{ gap: 10 }}>
        {rows.map((r, i) => (
          <div key={r.key} className="split-row">
            <label className="visually-hidden" htmlFor={`split-cat-${r.key}`}>
              {t('split.categoryFor', { n: i + 1 })}
            </label>
            <select id={`split-cat-${r.key}`} value={r.categoryId} onChange={(e) => update(r.key, { categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="visually-hidden" htmlFor={`split-amt-${r.key}`}>
              {t('split.amountFor', { n: i + 1 })}
            </label>
            <input
              id={`split-amt-${r.key}`}
              inputMode="decimal"
              placeholder={zeroPlaceholder()}
              value={r.text}
              aria-invalid={r.text !== '' && amounts[i] === null}
              onChange={(e) => update(r.key, { text: e.target.value.replace(/[^\d.,]/g, '') })}
            />
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              aria-label={t('split.remove', { n: i + 1 })}
              disabled={rows.length <= 2}
              onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
            >
              <Icon name="close" size={18} />
            </button>
            <label className="visually-hidden" htmlFor={`split-note-${r.key}`}>
              {t('split.noteFor', { n: i + 1 })}
            </label>
            <input
              id={`split-note-${r.key}`}
              className="split-note"
              placeholder={t('split.notePlaceholder')}
              value={r.note}
              onChange={(e) => update(r.key, { note: e.target.value })}
            />
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span className={'num ' + (remaining === 0 ? 'text-pos' : 'text-warn')} role="status">
          {remaining === 0
            ? t('split.allAssigned')
            : remaining > 0
              ? t('split.left', { amount: formatMoney(remaining) })
              : t('split.tooMuch', { amount: formatMoney(-remaining) })}
        </span>
        <div className="row" style={{ gap: 8 }}>
          {remaining !== 0 && (
            <button type="button" className="btn btn--sm" onClick={balanceFirst}>
              {t('split.balanceFirst')}
            </button>
          )}
          <button type="button" className="btn btn--sm" onClick={splitEvenly}>
            {t('split.evenly')}
          </button>
          <button type="button" className="btn btn--sm" onClick={addRow}>
            {t('split.addPart')}
          </button>
        </div>
      </div>

      <div className="grid-2">
        {isSplit ? (
          <button type="button" className="btn" onClick={unsplit}>
            {t('split.removeSplit')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => onDone(false)}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn--solid" disabled={!valid || busy}>
          {t('split.save')}
        </button>
      </div>
    </form>
  );
}
