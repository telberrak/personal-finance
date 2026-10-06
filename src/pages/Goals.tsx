/**
 * Goals: savings goals with a target and optional date, progress, money added or taken out, and how much to
 * set aside each month.
 */
import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { addToGoal, deleteGoal, saveGoal, updateSettings, ValidationError } from '../db/repo';
import type { FinanceData, Goal } from '../db/types';
import { formatDate, fromISO, today } from '../lib/dates';
import { currencySymbol, formatMoney, parseMoney } from '../lib/money';
import { t } from '../i18n';

/** Whole months from today until the deadline (at least 1). */
function monthsUntil(deadline: string): number {
  const now = fromISO(today());
  const d = fromISO(deadline);
  return Math.max(1, (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth()));
}

/**
 * How much to set aside each month to reach a goal by its date (0 when there is no date or it is reached).
 */
export function monthlyNeeded(goal: Goal): number | undefined {
  if (!goal.deadline || goal.saved >= goal.target) return undefined;
  return Math.ceil((goal.target - goal.saved) / monthsUntil(goal.deadline));
}

/** The Goals screen. */
export function Goals({ data }: { data?: FinanceData }) {
  const [editing, setEditing] = useState<Goal | 'new'>();
  const [adding, setAdding] = useState<Goal>();
  const toast = useToast();
  if (!data) return <Loading />;

  const goals = [...data.goals].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  const needed = goals.reduce((s, g) => s + (monthlyNeeded(g) ?? 0), 0);
  const savings = data.settings.monthlySavings;

  return (
    <main className="screen">
      <PageHeader
        title={t('goals.title')}
        subtitle={t('goals.subtitle')}
        actions={
          <button type="button" className="btn btn--solid" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            {t('goals.new')}
          </button>
        }
      />

      {needed > 0 && (
        <section className={'callout' + (needed > savings ? '' : ' callout--ok')}>
          <span className="callout-icon">
            <Icon name="target" size={20} />
          </span>
          <div className="stack grow" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{t('goals.need', { amount: formatMoney(needed) })}</span>
            <span className="label">
              {t(needed > savings ? 'goals.setAsideShort' : 'goals.setAsideOk', { amount: formatMoney(savings) })}
            </span>
          </div>
          {needed > savings && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={async () => {
                await updateSettings({ monthlySavings: needed });
                toast({ message: t('goals.savingsSet', { amount: formatMoney(needed) }) });
              }}
            >
              {t('goals.use', { amount: formatMoney(needed) })}
            </button>
          )}
        </section>
      )}

      <div className="goal-grid">
        {goals.length === 0 && (
          <div className="card empty">
            {t('goals.empty')}{' '}
            <button type="button" className="link-btn" onClick={() => setEditing('new')}>
              {t('goals.createOne')}
            </button>
          </div>
        )}
        {goals.map((g) => {
          const ratio = Math.min(1, g.saved / g.target);
          const perMonth = monthlyNeeded(g);
          const done = g.saved >= g.target;
          return (
            <article key={g.id} className="card stack" style={{ gap: 12 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow stack" style={{ gap: 2 }}>
                  <h2 className="section-title" translate="no">
                    {g.name}
                  </h2>
                  <span className="label">{g.deadline ? t('goals.by', { date: formatDate(g.deadline) }) : t('goals.noDeadline')}</span>
                </div>
                {done && <span className="pill pill--pos">{t('goals.reached')}</span>}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="value-lg num">{formatMoney(g.saved)}</span>
                <span className="label num">{t('goals.ofTarget', { amount: formatMoney(g.target) })}</span>
              </div>
              <div
                className="bar bar--thick"
                role="progressbar"
                aria-label={t('goals.progress', { name: g.name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio * 100)}
              >
                <span style={{ width: `${ratio * 100}%`, background: done ? 'var(--pos)' : undefined }} />
              </div>
              <span className="small muted">
                {done
                  ? t('goals.wellDone')
                  : perMonth
                    ? t('goals.perMonth', { amount: formatMoney(perMonth) })
                    : t('goals.toGo', { amount: formatMoney(g.target - g.saved) })}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--solid grow" onClick={() => setAdding(g)}>
                  {t('goals.addMoney')}
                </button>
                <button type="button" className="btn" onClick={() => setEditing(g)}>
                  {t('common.edit')}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? t('goals.new') : t('goals.editGoal')}>
        {editing && (
          <GoalEditor
            key={editing === 'new' ? 'new' : editing.id}
            goal={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Sheet>
      <Sheet open={!!adding} onClose={() => setAdding(undefined)} title={t('goals.addTo', { name: adding?.name ?? '' })}>
        {adding && <AddMoney key={adding.id} goal={adding} onDone={() => setAdding(undefined)} />}
      </Sheet>
    </main>
  );
}

function GoalEditor({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(goal?.name ?? '');
  const [targetText, setTargetText] = useState(goal ? (goal.target / 100).toFixed(2) : '');
  const [savedText, setSavedText] = useState(goal ? (goal.saved / 100).toFixed(2) : '0');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const target = parseMoney(targetText);
    const saved = parseMoney(savedText || '0');
    if (target === null || saved === null) return toast({ message: t('goals.amountsHint') });
    try {
      await saveGoal({ id: goal?.id, name, target, saved, deadline: deadline || undefined });
      toast({ message: goal ? t('goals.updated') : t('goals.created') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('goals.saveFailed') });
    }
  }

  async function remove() {
    if (!goal || !(await confirm({ title: t('goals.deleteTitle', { name: goal.name }), confirmLabel: t('common.delete'), danger: true })))
      return;
    await deleteGoal(goal.id);
    toast({ message: t('goals.deleted') });
    onDone();
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('fields.name')}>
          {(id) => (
            <input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('goals.namePlaceholder')}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t('goals.target')}>
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder={currencySymbol()}
            />
          )}
        </Field>
        <Field label={t('goals.saved')}>
          {(id) => <input id={id} inputMode="decimal" value={savedText} onChange={(e) => setSavedText(e.target.value)} />}
        </Field>
        <Field label={t('goals.byLabel')}>
          {(id) => <input id={id} type="date" value={deadline} min={today()} onChange={(e) => setDeadline(e.target.value)} />}
        </Field>
      </div>
      <div className="grid-2">
        {goal ? (
          <button type="button" className="btn btn--danger" onClick={remove}>
            {t('common.delete')}
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

function AddMoney({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [withdraw, setWithdraw] = useState(false);
  const amount = parseMoney(text);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    await addToGoal(goal.id, withdraw ? -amount : amount);
    toast({ message: t(withdraw ? 'goals.took' : 'goals.added', { amount: formatMoney(amount), name: goal.name }) });
    onDone();
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label={t('goals.direction')}>
        <button type="button" role="radio" aria-checked={!withdraw} onClick={() => setWithdraw(false)}>
          {t('goals.add')}
        </button>
        <button type="button" role="radio" aria-checked={withdraw} onClick={() => setWithdraw(true)}>
          {t('goals.takeOut')}
        </button>
      </div>
      <MoneyInput value={text} onChange={setText} autoFocus />
      <p className="small muted">{t('goals.onlyGoal')}</p>
      <button type="submit" className="btn btn--primary" disabled={!amount}>
        {withdraw ? t('goals.takeOut') : t('goals.add')} {amount ? formatMoney(amount) : ''}
      </button>
    </form>
  );
}
