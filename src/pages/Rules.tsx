/**
 * Settings → Rules and payee names: categorisation rules (with "apply to past") and payee renames.
 */
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
import { formatList } from '../lib/format';
import { ruleMatches } from '../lib/rules';
import { t } from '../i18n';

const MATCHES: RuleMatch[] = ['contains', 'startsWith', 'exact'];

/** Settings → Rules and payee names. */
export function Rules({ data }: { data?: FinanceData }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | 'new'>();
  const [renaming, setRenaming] = useState(false);
  if (!data) return <Loading />;
  const categories = new Map(data.categories.map((c) => [c.id, c]));

  async function apply(rule: Rule) {
    const n = await applyRuleToHistory(rule, (payee) => ruleMatches(rule, payee));
    toast({ message: n ? t('rules.appliedPast', { count: n }) : t('rules.appliedNone') });
  }

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('rules.title')} subtitle={t('rules.subtitle')} />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{t('rules.categorisation')}</h2>
          <button type="button" className="link-btn" onClick={() => setEditing('new')}>
            {t('rules.add')}
          </button>
        </div>
        <p className="small muted">{t('rules.help')}</p>
        <div className="list">
          {data.rules.length === 0 && <p className="empty">{t('rules.none')}</p>}
          {data.rules.map((r) => {
            const cat = categories.get(r.categoryId);
            return (
              <div key={r.id} className="list-row">
                <button type="button" className="grow stack plain-btn" style={{ gap: 2 }} onClick={() => setEditing(r)}>
                  <span className="item-title">{t(`rules.summary.${r.match}`, { pattern: r.pattern })}</span>
                  <span className="item-meta" style={catVar(cat?.color)}>
                    <span className="dot" /> {cat?.name ?? t('rules.missingCategory')}
                  </span>
                </button>
                <button type="button" className="btn btn--sm" onClick={() => apply(r)}>
                  {t('rules.applyPast')}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--ghost"
                  aria-label={t('rules.delete', { pattern: r.pattern })}
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
          <h2 className="section-title">{t('rules.payeeNames')}</h2>
          <button type="button" className="link-btn" onClick={() => setRenaming(true)}>
            {t('rules.rename')}
          </button>
        </div>
        <p className="small muted">{t('rules.renameHelp')}</p>
        <div className="list">
          {data.aliases.length === 0 && <p className="empty">{t('rules.noRenames')}</p>}
          {data.aliases.map((a) => (
            <div key={a.id} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}>
                <span className="item-title">{a.to}</span>
                <span className="item-meta">{t('rules.from', { name: a.from })}</span>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label={t('rules.forget', { name: a.to })}
                onClick={() => deleteAlias(a.id)}
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? t('rules.new') : t('rules.edit')}>
        {editing && (
          <RuleEditor
            key={editing === 'new' ? 'new' : editing.id}
            rule={editing === 'new' ? undefined : editing}
            data={data}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Sheet>
      <Sheet open={renaming} onClose={() => setRenaming(false)} title={t('rules.renameTitle')}>
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
      toast({ message: rule ? t('rules.updated') : t('rules.added') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('rules.saveFailed') });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('columns.payee')}>
          {(id) => (
            <select id={id} value={match} onChange={(e) => setMatch(e.target.value as RuleMatch)}>
              {MATCHES.map((v) => (
                <option key={v} value={v}>
                  {t(`rules.match.${v}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('rules.text')}>
          {(id) => (
            <input
              id={id}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t('rules.textPlaceholder')}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t('fields.category')}>
          {(id) => (
            <select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.kind === 'income' ? 'rules.kindIncome' : 'rules.kindSpending', { name: c.name })}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {pattern.trim() && (
        <p className="small muted">
          {t('rules.matches', { count: preview.size })}
          {preview.size > 0 && t('rules.matchesList', { list: formatList([...preview].slice(0, 4)) + (preview.size > 4 ? '…' : '') })}
        </p>
      )}
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid">
          {t('rules.save')}
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
      toast({ message: t('rules.renamed', { count: n }) });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('rules.renameFailed') });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('columns.payee')}>
          {(id) => (
            <select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{t('rules.choose')}</option>
              {payees.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('rules.newName')}>
          {(id) => <input id={id} value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />}
        </Field>
      </div>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid" disabled={!from || !to.trim()}>
          {t('rules.renameButton')}
        </button>
      </div>
    </form>
  );
}
