/**
 * Advanced search: filters, saved searches, and editing many transactions at once (category, tags, delete
 * with undo).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Loading, PageHeader } from '../components/Layout';
import { TransactionRow } from '../components/rows';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { bulkDelete, bulkRecategorise, bulkTag, restoreTransactions, updateSettings, ValidationError } from '../db/repo';
import { newId } from '../lib/id';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { formatMoney, parseMoney } from '../lib/money';
import { allTags, hasFilters, searchTransactions, type SearchFilters } from '../lib/search';

const SHOWN = 200;

/** The advanced search screen. */
export function Search({ data }: { data?: FinanceData }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [filters, setFilters] = useState<SearchFilters>({});
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [tagText, setTagText] = useState('');

  const results = useMemo(() => (data ? searchTransactions(data.transactions, filters) : []), [data, filters]);
  const tags = useMemo(() => (data ? allTags(data.transactions) : []), [data]);
  if (!data) return <Loading />;

  const set = (patch: Partial<SearchFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  const totalIn = results.reduce((s, x) => (x.amount > 0 && !x.transferId ? s + x.amount : s), 0);
  const totalOut = results.reduce((s, x) => (x.amount < 0 && !x.transferId ? s - x.amount : s), 0);
  const saved = data.settings.savedSearches ?? [];
  const ids = [...selected];

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(action: () => Promise<number>, message: (n: number) => string) {
    try {
      const n = await action();
      toast({ message: message(n) });
      setSelected(new Set());
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('search.failed') });
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: t('search.deleteTitle', { count: ids.length }),
      message: t('search.deleteBody'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    const deleted = await bulkDelete(ids);
    setSelected(new Set());
    toast({
      message: t('search.deleted', { count: deleted.length }),
      action: { label: t('common.undo'), onClick: () => restoreTransactions(deleted) },
    });
  }

  return (
    <main className="screen">
      <PageHeader title={t('search.title')} subtitle={t('search.subtitle')} />

      {saved.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label={t('search.saved')} role="group">
          {saved.map((s) => (
            <span key={s.id} className="saved-chip">
              <button type="button" className="plain-btn" onClick={() => setFilters(s.filters)} translate="no">
                {s.name}
              </button>
              <button
                type="button"
                className="plain-btn chip-remove"
                aria-label={t('search.removeSaved', { name: s.name })}
                onClick={() => updateSettings({ savedSearches: saved.filter((x) => x.id !== s.id) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <section className="list" aria-label={t('search.filters')}>
        <Field label={t('search.text')}>
          {(id) => (
            <input
              id={id}
              type="search"
              value={filters.text ?? ''}
              placeholder={t('search.textPlaceholder')}
              onChange={(e) => set({ text: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('search.from')}>
          {(id) => <input id={id} type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />}
        </Field>
        <Field label={t('search.to')}>
          {(id) => <input id={id} type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />}
        </Field>
        <Field label={t('search.min')}>
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              value={minText}
              onChange={(e) => {
                setMinText(e.target.value);
                set({ min: parseMoney(e.target.value) ?? undefined });
              }}
            />
          )}
        </Field>
        <Field label={t('search.max')}>
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              value={maxText}
              onChange={(e) => {
                setMaxText(e.target.value);
                set({ max: parseMoney(e.target.value) ?? undefined });
              }}
            />
          )}
        </Field>
        <Field label={t('fields.account')}>
          {(id) => (
            <select id={id} value={filters.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || undefined })}>
              <option value="">{t('search.any')}</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('fields.category')}>
          {(id) => (
            <select id={id} value={filters.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || undefined })}>
              <option value="">{t('search.any')}</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('fields.tags')}>
          {(id) => (
            <select id={id} value={filters.tag ?? ''} onChange={(e) => set({ tag: e.target.value || undefined })}>
              <option value="">{t('search.any')}</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('search.direction')}>
          {(id) => (
            <select
              id={id}
              value={filters.direction ?? ''}
              onChange={(e) => set({ direction: (e.target.value || undefined) as SearchFilters['direction'] })}
            >
              <option value="">{t('search.both')}</option>
              <option value="out">{t('search.out')}</option>
              <option value="in">{t('search.in')}</option>
            </select>
          )}
        </Field>
      </section>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn"
          disabled={!hasFilters(filters)}
          onClick={() => {
            setFilters({});
            setMinText('');
            setMaxText('');
          }}
        >
          {t('search.clear')}
        </button>
        <button type="button" className="btn" disabled={!hasFilters(filters)} onClick={() => setSaving(true)}>
          {t('search.save')}
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((s) => !s);
            setSelected(new Set());
          }}
        >
          {selecting ? t('search.doneSelecting') : t('search.select')}
        </button>
      </div>

      <p className="label" role="status">
        {t('search.summary', { count: results.length, in: formatMoney(totalIn), out: formatMoney(totalOut) })}
      </p>

      {selecting && selected.size > 0 && (
        <section className="card stack" style={{ gap: 10 }} aria-label={t('search.bulk')}>
          <span className="item-title">{t('search.selected', { count: selected.size })}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select aria-label={t('search.moveTo')} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">{t('search.moveTo')}</option>
              {data.categories
                .filter((c) => !c.system && !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn btn--sm"
              disabled={!moveTo}
              onClick={() =>
                void run(
                  () => bulkRecategorise(ids, moveTo),
                  (n) => t('search.moved', { count: n, name: categories.get(moveTo)?.name }),
                )
              }
            >
              {t('search.apply')}
            </button>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              aria-label={t('search.tagToAdd')}
              placeholder={t('search.tagToAdd')}
              list="search-tags"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
            />
            <datalist id="search-tags">
              {tags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn--sm"
              disabled={!tagText.trim()}
              onClick={() =>
                void run(
                  () => bulkTag(ids, tagText),
                  (n) => t('search.tagged', { count: n, tag: tagText.trim() }),
                )
              }
            >
              {t('search.addTag')}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              disabled={!tagText.trim()}
              onClick={() =>
                void run(
                  () => bulkTag(ids, tagText, false),
                  (n) => t('search.untagged', { count: n, tag: tagText.trim() }),
                )
              }
            >
              {t('search.removeTag')}
            </button>
          </div>
          <button type="button" className="btn btn--sm btn--danger" style={{ alignSelf: 'flex-start' }} onClick={() => void onDelete()}>
            {t('search.deleteSelected')}
          </button>
        </section>
      )}

      {results.length === 0 ? (
        <p className="small muted">{t('search.none')}</p>
      ) : (
        <div className="list">
          {selecting && (
            <label className="check-row" style={{ padding: '10px 16px' }}>
              <input
                type="checkbox"
                checked={selected.size > 0 && results.slice(0, SHOWN).every((x) => selected.has(x.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(results.slice(0, SHOWN).map((x) => x.id)) : new Set())}
              />
              <span>{t('search.selectAll')}</span>
            </label>
          )}
          {results.slice(0, SHOWN).map((tx) => (
            <div key={tx.id} className={selecting ? 'select-row' : undefined}>
              {selecting && (
                <input
                  type="checkbox"
                  aria-label={t('search.selectOne', { name: tx.payee, date: tx.date })}
                  checked={selected.has(tx.id)}
                  onChange={() => toggle(tx.id)}
                />
              )}
              <TransactionRow tx={tx} category={categories.get(tx.categoryId)} accountName={accounts.get(tx.accountId)} />
            </div>
          ))}
          {results.length > SHOWN && <p className="list-row small muted">{t('search.more', { count: results.length - SHOWN })}</p>}
        </div>
      )}

      <Link to="/activity" className="link-btn" style={{ alignSelf: 'flex-start' }}>
        {t('search.backToActivity')}
      </Link>

      <Sheet open={saving} onClose={() => setSaving(false)} title={t('search.save')}>
        {saving && (
          <SaveSearch
            onSave={async (name) => {
              await updateSettings({ savedSearches: [...saved, { id: newId(), name, filters }] });
              setSaving(false);
              toast({ message: t('search.savedDone') });
            }}
            onCancel={() => setSaving(false)}
          />
        )}
      </Sheet>
    </main>
  );
}

function SaveSearch({ onSave, onCancel }: { onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void onSave(name.trim());
  };
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('fields.name')}>
          {(id) => <input id={id} value={name} autoFocus onChange={(e) => setName(e.target.value)} required />}
        </Field>
      </div>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid" disabled={!name.trim()}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}
