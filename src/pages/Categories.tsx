/**
 * Settings → Categories: add, rename, recolour, reorder, archive (moving everything to another category) and
 * restore categories.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { catVar } from '../components/rows';
import { Sheet } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { archiveCategory, moveCategory, restoreCategory, saveCategory, ValidationError } from '../db/repo';
import { CATEGORY_COLORS, type Category, type FinanceData } from '../db/types';
import { t } from '../i18n';

const KINDS = ['expense', 'income'] as const;

type Editing = { category?: Category; kind: 'expense' | 'income' };

/** Settings → Categories. */
export function Categories({ data }: { data?: FinanceData }) {
  const [editing, setEditing] = useState<Editing>();
  const [archiving, setArchiving] = useState<Category>();
  const toast = useToast();
  if (!data) return <Loading />;

  const visible = data.categories.filter((c) => !c.system);
  const counts = new Map<string, number>();
  for (const t of data.transactions) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);

  const section = (kind: 'expense' | 'income', title: string) => {
    const list = visible.filter((c) => c.kind === kind && !c.archived);
    return (
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{title}</h2>
          <button type="button" className="link-btn" onClick={() => setEditing({ kind })}>
            {t('common.add')}
          </button>
        </div>
        <div className="list">
          {list.map((c, i) => (
            <div key={c.id} className="list-row">
              <span className="dot" style={catVar(c.color)} />
              <button type="button" className="grow stack plain-btn" style={{ gap: 2 }} onClick={() => setEditing({ category: c, kind })}>
                <span className="item-title">{c.name}</span>
                <span className="item-meta">{t('categories.txCount', { count: counts.get(c.id) ?? 0 })}</span>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={t('categories.moveUp', { name: c.name })}
                disabled={i === 0}
                onClick={() => moveCategory(c.id, -1)}
              >
                <Icon name="up" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={t('categories.moveDown', { name: c.name })}
                disabled={i === list.length - 1}
                onClick={() => moveCategory(c.id, 1)}
              >
                <Icon name="down" size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const archived = visible.filter((c) => c.archived);

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('categories.title')} />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>
      {KINDS.map((kind) => section(kind, t(`categories.${kind === 'expense' ? 'spending' : 'income'}`)))}
      {archived.length > 0 && (
        <section className="section">
          <h2 className="section-label">{t('accounts.archived')}</h2>
          <div className="list">
            {archived.map((c) => (
              <div key={c.id} className="list-row">
                <span className="dot" style={catVar(c.color)} />
                <span className="grow item-title muted">{c.name}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await restoreCategory(c.id);
                    toast({ message: t('categories.restored', { name: c.name }) });
                  }}
                >
                  {t('common.restore')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing?.category ? t('categories.edit') : t('categories.new')}>
        {editing && (
          <CategoryEditor
            key={editing.category?.id ?? 'new-' + editing.kind}
            editing={editing}
            onDone={() => setEditing(undefined)}
            onArchive={(c) => {
              setEditing(undefined);
              setArchiving(c);
            }}
          />
        )}
      </Sheet>
      <Sheet
        open={!!archiving}
        onClose={() => setArchiving(undefined)}
        title={t('categories.archiveTitle', { name: archiving?.name ?? '' })}
      >
        {archiving && <ArchiveForm key={archiving.id} category={archiving} categories={visible} onDone={() => setArchiving(undefined)} />}
      </Sheet>
    </main>
  );
}

function CategoryEditor({ editing, onDone, onArchive }: { editing: Editing; onDone: () => void; onArchive: (c: Category) => void }) {
  const toast = useToast();
  const [name, setName] = useState(editing.category?.name ?? '');
  const [color, setColor] = useState(editing.category?.color ?? CATEGORY_COLORS[0]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await saveCategory({ id: editing.category?.id, name, color, kind: editing.kind });
      toast({ message: editing.category ? t('categories.updated') : t('categories.added') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('categories.saveFailed') });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('fields.name')}>
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />}
        </Field>
      </div>
      <div className="section">
        <span className="section-label" id="colour-label">
          {t('categories.colour')}
        </span>
        <div className="row" role="radiogroup" aria-labelledby="colour-label" style={{ flexWrap: 'wrap', gap: 10 }}>
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={t(`colors.${c}`)}
              className="swatch"
              style={catVar(c)}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="grid-2">
        {editing.category ? (
          <button type="button" className="btn" onClick={() => onArchive(editing.category!)}>
            {t('common.archive')}
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

function ArchiveForm({ category, categories, onDone }: { category: Category; categories: Category[]; onDone: () => void }) {
  const toast = useToast();
  const options = categories.filter((c) => c.kind === category.kind && !c.archived && c.id !== category.id);
  const [target, setTarget] = useState(options[0]?.id ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await archiveCategory(category.id, target);
      toast({ message: t('categories.archived', { name: category.name }) });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('categories.archiveFailed') });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="label">{t('categories.archiveNote')}</p>
      <div className="list">
        <Field label={t('categories.moveTo')}>
          {(id) => (
            <select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--danger-solid" disabled={!target}>
          {t('common.archive')}
        </button>
      </div>
    </form>
  );
}
