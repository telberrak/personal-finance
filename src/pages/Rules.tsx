import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { catVar } from '../components/rows';
import { Sheet } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { applyRuleToHistory, deleteAlias, deleteRule, renamePayee, saveRule, ValidationError } from '../db/repo';
import type { FinanceData, Rule, RuleMatch } from '../db/types';
import { ruleMatches } from '../lib/rules';

const MATCH_LABEL: Record<RuleMatch, string> = { contains: 'contains', startsWith: 'starts with', exact: 'is exactly' };

export function Rules({ data }: { data?: FinanceData }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | 'new'>();
  const [renaming, setRenaming] = useState(false);
  if (!data) return <Loading />;
  const categories = new Map(data.categories.map((c) => [c.id, c]));

  async function apply(rule: Rule) {
    const n = await applyRuleToHistory(rule, (payee) => ruleMatches(rule, payee));
    toast({ message: n ? `${n} past transactions updated` : 'No past transactions needed changing' });
  }

  return (
    <main className="screen screen--modal">
      <PageHeader title="Rules" subtitle="Automatic categories and payee names" />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        ‹ Settings
      </Link>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Categorisation rules</h2>
          <button type="button" className="link-btn" onClick={() => setEditing('new')}>
            + Add rule
          </button>
        </div>
        <p className="small muted">
          Used for new and imported transactions. The first matching rule wins; without one, the category you last used for that payee is
          picked.
        </p>
        <div className="list">
          {data.rules.length === 0 && (
            <p className="empty">No rules yet. When you change a transaction’s category you can save it as a rule.</p>
          )}
          {data.rules.map((r) => {
            const cat = categories.get(r.categoryId);
            return (
              <div key={r.id} className="list-row">
                <button type="button" className="grow stack plain-btn" style={{ gap: 2 }} onClick={() => setEditing(r)}>
                  <span className="item-title">
                    Payee {MATCH_LABEL[r.match]} “{r.pattern}”
                  </span>
                  <span className="item-meta" style={catVar(cat?.color)}>
                    <span className="dot" /> {cat?.name ?? 'Missing category'}
                  </span>
                </button>
                <button type="button" className="btn btn--sm" onClick={() => apply(r)}>
                  Apply to past
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--ghost"
                  aria-label={`Delete rule ${r.pattern}`}
                  onClick={() => deleteRule(r.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Payee names</h2>
          <button type="button" className="link-btn" onClick={() => setRenaming(true)}>
            + Rename a payee
          </button>
        </div>
        <p className="small muted">Bank descriptions are tidied up automatically. Renames here apply to past and future transactions.</p>
        <div className="list">
          {data.aliases.length === 0 && <p className="empty">No renamed payees.</p>}
          {data.aliases.map((a) => (
            <div key={a.id} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}>
                <span className="item-title">{a.to}</span>
                <span className="item-meta">from “{a.from}”</span>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={`Forget rename to ${a.to}`}
                onClick={() => deleteAlias(a.id)}
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? 'New rule' : 'Edit rule'}>
        {editing && (
          <RuleEditor
            key={editing === 'new' ? 'new' : editing.id}
            rule={editing === 'new' ? undefined : editing}
            data={data}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Sheet>
      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Rename a payee">
        {renaming && <RenameForm data={data} onDone={() => setRenaming(false)} />}
      </Sheet>
    </main>
  );
}

function RuleEditor({ rule, data, onDone }: { rule?: Rule; data: FinanceData; onDone: () => void }) {
  const toast = useToast();
  const [match, setMatch] = useState<RuleMatch>(rule?.match ?? 'contains');
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const categories = data.categories.filter((c) => !c.system && !c.archived);
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? categories[0]?.id ?? '');
  const preview = pattern.trim()
    ? new Set(
        data.transactions
          .filter((t) => !t.transferId && ruleMatches({ id: '', match, pattern, categoryId, priority: 0 }, t.payee))
          .map((t) => t.payee),
      )
    : new Set<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await saveRule({ id: rule?.id, match, pattern, categoryId, priority: rule?.priority });
      toast({ message: rule ? 'Rule updated' : 'Rule added' });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not save the rule.' });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label="Payee">
          {(id) => (
            <select id={id} value={match} onChange={(e) => setMatch(e.target.value as RuleMatch)}>
              {Object.entries(MATCH_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Text">
          {(id) => (
            <input id={id} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. Tesco" autoComplete="off" />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind === 'income' ? 'income' : 'spending'})
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {pattern.trim() && (
        <p className="small muted">
          Matches {preview.size} payee{preview.size === 1 ? '' : 's'} so far
          {preview.size > 0 && `: ${[...preview].slice(0, 4).join(', ')}${preview.size > 4 ? '…' : ''}`}
        </p>
      )}
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn--solid">
          Save rule
        </button>
      </div>
    </form>
  );
}

function RenameForm({ data, onDone }: { data: FinanceData; onDone: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const payees = Array.from(new Set(data.transactions.filter((t) => !t.transferId).map((t) => t.payee))).sort();

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const n = await renamePayee(from, to);
      toast({ message: `Renamed ${n} transaction${n === 1 ? '' : 's'}` });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not rename.' });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label="Payee">
          {(id) => (
            <select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose…</option>
              {payees.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="New name">{(id) => <input id={id} value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />}</Field>
      </div>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn--solid" disabled={!from || !to.trim()}>
          Rename
        </button>
      </div>
    </form>
  );
}
