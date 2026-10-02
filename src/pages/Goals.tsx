import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { addToGoal, deleteGoal, saveGoal, updateSettings, ValidationError } from '../db/repo';
import type { FinanceData, Goal } from '../db/types';
import { formatDate, fromISO, today } from '../lib/dates';
import { formatMoney, parseMoney } from '../lib/money';

/** Whole months from today until the deadline (at least 1). */
function monthsUntil(deadline: string): number {
  const now = fromISO(today());
  const d = fromISO(deadline);
  return Math.max(1, (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth()));
}

export function monthlyNeeded(goal: Goal): number | undefined {
  if (!goal.deadline || goal.saved >= goal.target) return undefined;
  return Math.ceil((goal.target - goal.saved) / monthsUntil(goal.deadline));
}

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
        title="Goals"
        subtitle="Saving for something"
        actions={
          <button type="button" className="btn btn--solid" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} strokeWidth={2.2} />
            New goal
          </button>
        }
      />

      {needed > 0 && (
        <section className={'callout' + (needed > savings ? '' : ' callout--ok')}>
          <span className="callout-icon">
            <Icon name="target" size={20} />
          </span>
          <div className="stack grow" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>Your goals need {formatMoney(needed)} a month</span>
            <span className="label">
              You set aside {formatMoney(savings)} each pay cycle{needed > savings ? ', which is not enough to hit every deadline.' : '.'}
            </span>
          </div>
          {needed > savings && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={async () => {
                await updateSettings({ monthlySavings: needed });
                toast({ message: `Savings set to ${formatMoney(needed)} a month` });
              }}
            >
              Use {formatMoney(needed)}
            </button>
          )}
        </section>
      )}

      <div className="goal-grid">
        {goals.length === 0 && (
          <div className="card empty">
            No goals yet. A holiday, a new laptop, an emergency fund…{' '}
            <button type="button" className="link-btn" onClick={() => setEditing('new')}>
              Create one
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
                  <h2 className="section-title">{g.name}</h2>
                  <span className="label">{g.deadline ? `By ${formatDate(g.deadline)}` : 'No deadline'}</span>
                </div>
                {done && <span className="pill pill--pos">Reached</span>}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="value-lg num">{formatMoney(g.saved)}</span>
                <span className="label num">of {formatMoney(g.target)}</span>
              </div>
              <div
                className="bar bar--thick"
                role="progressbar"
                aria-label={`${g.name} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio * 100)}
              >
                <span style={{ width: `${ratio * 100}%`, background: done ? 'var(--pos)' : undefined }} />
              </div>
              <span className="small muted">
                {done
                  ? 'Well done!'
                  : perMonth
                    ? `${formatMoney(perMonth)} a month to get there on time`
                    : `${formatMoney(g.target - g.saved)} to go`}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--solid grow" onClick={() => setAdding(g)}>
                  Add money
                </button>
                <button type="button" className="btn" onClick={() => setEditing(g)}>
                  Edit
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing === 'new' ? 'New goal' : 'Edit goal'}>
        {editing && (
          <GoalEditor
            key={editing === 'new' ? 'new' : editing.id}
            goal={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Sheet>
      <Sheet open={!!adding} onClose={() => setAdding(undefined)} title={`Add to ${adding?.name ?? ''}`}>
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
    if (target === null || saved === null) return toast({ message: 'Enter amounts like 1500 or 250.50' });
    try {
      await saveGoal({ id: goal?.id, name, target, saved, deadline: deadline || undefined });
      toast({ message: goal ? 'Goal updated' : 'Goal created' });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not save the goal.' });
    }
  }

  async function remove() {
    if (!goal || !(await confirm({ title: `Delete ${goal.name}?`, confirmLabel: 'Delete', danger: true }))) return;
    await deleteGoal(goal.id);
    toast({ message: 'Goal deleted' });
    onDone();
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label="Name">
          {(id) => (
            <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer holiday" autoComplete="off" />
          )}
        </Field>
        <Field label="Target">
          {(id) => <input id={id} inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="£" />}
        </Field>
        <Field label="Saved">
          {(id) => <input id={id} inputMode="decimal" value={savedText} onChange={(e) => setSavedText(e.target.value)} />}
        </Field>
        <Field label="By">
          {(id) => <input id={id} type="date" value={deadline} min={today()} onChange={(e) => setDeadline(e.target.value)} />}
        </Field>
      </div>
      <div className="grid-2">
        {goal ? (
          <button type="button" className="btn btn--danger" onClick={remove}>
            Delete
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

function AddMoney({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [withdraw, setWithdraw] = useState(false);
  const amount = parseMoney(text);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    await addToGoal(goal.id, withdraw ? -amount : amount);
    toast({ message: withdraw ? `Took ${formatMoney(amount)} from ${goal.name}` : `Added ${formatMoney(amount)} to ${goal.name}` });
    onDone();
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label="Direction">
        <button type="button" role="radio" aria-checked={!withdraw} onClick={() => setWithdraw(false)}>
          Add
        </button>
        <button type="button" role="radio" aria-checked={withdraw} onClick={() => setWithdraw(true)}>
          Take out
        </button>
      </div>
      <MoneyInput value={text} onChange={setText} autoFocus />
      <p className="small muted">This updates the goal only. To move real money, add a transfer between your accounts too.</p>
      <button type="submit" className="btn btn--primary" disabled={!amount}>
        {withdraw ? 'Take out' : 'Add'} {amount ? formatMoney(amount) : ''}
      </button>
    </form>
  );
}
