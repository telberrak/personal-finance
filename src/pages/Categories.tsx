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

type Editing = { category?: Category; kind: 'expense' | 'income' };

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
            + Add
          </button>
        </div>
        <div className="list">
          {list.map((c, i) => (
            <div key={c.id} className="list-row">
              <span className="dot" style={catVar(c.color)} />
              <button type="button" className="grow stack plain-btn" style={{ gap: 2 }} onClick={() => setEditing({ category: c, kind })}>
                <span className="item-title">{c.name}</span>
                <span className="item-meta">{counts.get(c.id) ?? 0} transactions</span>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={`Move ${c.name} up`}
                disabled={i === 0}
                onClick={() => moveCategory(c.id, -1)}
              >
                <Icon name="up" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={`Move ${c.name} down`}
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
      <PageHeader title="Categories" />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        ‹ Settings
      </Link>
      {section('expense', 'Spending')}
      {section('income', 'Income')}
      {archived.length > 0 && (
        <section className="section">
          <h2 className="section-label">Archived</h2>
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
                    toast({ message: `${c.name} restored` });
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing?.category ? 'Edit category' : 'New category'}>
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
      <Sheet open={!!archiving} onClose={() => setArchiving(undefined)} title={`Archive ${archiving?.name ?? ''}`}>
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
      toast({ message: editing.category ? 'Category updated' : 'Category added' });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not save the category.' });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label="Name">
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />}
        </Field>
      </div>
      <div className="section">
        <span className="section-label" id="colour-label">
          Colour
        </span>
        <div className="row" role="radiogroup" aria-labelledby="colour-label" style={{ flexWrap: 'wrap', gap: 10 }}>
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
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
            Archive
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

function ArchiveForm({ category, categories, onDone }: { category: Category; categories: Category[]; onDone: () => void }) {
  const toast = useToast();
  const options = categories.filter((c) => c.kind === category.kind && !c.archived && c.id !== category.id);
  const [target, setTarget] = useState(options[0]?.id ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await archiveCategory(category.id, target);
      toast({ message: `${category.name} archived` });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not archive the category.' });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="label">Its transactions, bills and rules move to another category. Its budget is removed.</p>
      <div className="list">
        <Field label="Move to">
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
          Cancel
        </button>
        <button type="submit" className="btn btn--danger-solid" disabled={!target}>
          Archive
        </button>
      </div>
    </form>
  );
}
