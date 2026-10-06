/**
 * Budgets: progress per category for the period (with rollover), editing limits, and a tab per household for
 * shared budgets.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { catVar } from '../components/rows';
import { useToast } from '../components/ui/Toast';
import { db } from '../db/db';
import { setBudget } from '../db/repo';
import type { Budget, Category, FinanceData } from '../db/types';
import { daysBetween, today } from '../lib/dates';
import { currencySymbol, formatMoney, formatPercent, formatWhole, parseMoney } from '../lib/money';
import { periodFor, shiftPeriod, type Period } from '../lib/periods';
import { budgetProgress, budgetScope } from '../lib/selectors';
import { t } from '../i18n';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
/** At or above this share of a budget, the category is flagged. */
const TIGHT = 0.95;

/** The Budgets screen; ?household=<id> opens a household's tab. */
export function Budgets({ data }: { data?: FinanceData }) {
  const ref = today();
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const households = useLiveQuery(() => db.spaceKeys.toArray(), [], []);
  if (!data) return <Loading />;

  // Your own budgets, or a household's (shared with its members, counting only shared spending).
  const spaceId = households.find((h) => h.id === params.get('household'))?.id;
  const scope = budgetScope(data, spaceId);

  const { budgetPeriod, payday, budgetRollover } = data.settings;
  let period: Period = periodFor(ref, budgetPeriod, payday);
  for (let i = 0; i < -offset; i++) period = shiftPeriod(period, -1, budgetPeriod, payday);
  const previous = shiftPeriod(period, -1, budgetPeriod, payday);

  const rows = budgetProgress(scope.budgets, data.categories, scope.transactions, period, budgetRollover ? previous : undefined);
  const limit = rows.reduce((s, r) => s + r.limit, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  const left = limit - spent;
  const ratio = limit ? Math.min(1, spent / limit) : 0;
  const isCurrent = offset === 0;
  const daysLeft = isCurrent ? daysBetween(ref, period.to) + 1 : 0;

  const switcher = (
    <div className="month-switcher">
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label={t('budgets.previousPeriod')}
        onClick={() => setOffset(offset - 1)}
      >
        <Icon name="back" size={20} />
      </button>
      <span className="month-label">{period.label}</span>
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label={t('budgets.nextPeriod')}
        disabled={isCurrent}
        onClick={() => setOffset(offset + 1)}
      >
        <Icon name="forward" size={20} />
      </button>
    </div>
  );

  return (
    <main className="screen">
      <PageHeader
        title={t('budgets.title')}
        actions={
          <>
            {!editing && switcher}
            <button type="button" className={'btn' + (editing ? ' btn--solid' : '')} onClick={() => setEditing(!editing)}>
              {editing ? t('common.done') : t('common.edit')}
            </button>
          </>
        }
      />

      {households.length > 0 && (
        <div className="segmented" role="tablist" aria-label={t('budgets.whose')} style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
          {[{ id: undefined, name: t('budgets.mine') }, ...households].map((h) => (
            <button
              key={h.id ?? 'mine'}
              type="button"
              role="tab"
              aria-selected={spaceId === h.id}
              onClick={() => setParams(h.id ? { household: h.id } : {}, { replace: true })}
            >
              {h.name}
            </button>
          ))}
        </div>
      )}
      {spaceId && (
        <p className="label" style={{ marginBottom: 12 }}>
          {t('budgets.householdNote')}
        </p>
      )}

      {editing ? (
        <BudgetEditor data={data} budgets={scope.budgets} spaceId={spaceId} />
      ) : (
        <div className="budgets-layout">
          <section className="card overview" aria-label={t('budgets.overview')}>
            <div className="ring">
              <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--track)" strokeWidth="12" />
                {ratio > 0 && (
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    fill="none"
                    stroke={spent > limit ? 'var(--warn)' : 'var(--accent)'}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${ratio * RING_C} ${RING_C}`}
                  />
                )}
              </svg>
              <div className="ring-label">
                <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{formatPercent(limit ? spent / limit : 0)}</span>
                <span className="small muted">{t('budgets.used')}</span>
              </div>
            </div>
            <div className="stack">
              <span className="label">{left >= 0 ? t('budgets.leftToSpend') : t('budgets.overBudget')}</span>
              <span className={'num ' + (left < 0 ? 'text-warn' : '')} style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {formatMoney(Math.abs(left))}
              </span>
              <span className="label">
                {t('budgets.spentOf', { spent: formatMoney(spent), limit: formatWhole(limit) })}
                {isCurrent && t('budgets.daysLeft', { count: daysLeft })}
              </span>
              {isCurrent && left > 0 && daysLeft > 0 && (
                <span className="pill pill--accent" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                  {t('budgets.perDay', { amount: formatMoney(Math.floor(left / daysLeft)) })}
                </span>
              )}
              {budgetRollover && <span className="small muted">{t('budgets.rolloverNote')}</span>}
            </div>
          </section>

          <section className="budget-grid" aria-label={t('budgets.categories')}>
            {rows.length === 0 && (
              <div className="card empty">
                {t('budgets.none')}{' '}
                <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                  {t('budgets.setFirst')}
                </button>
              </div>
            )}
            {rows.map((r) => {
              const tight = r.ratio >= TIGHT;
              return (
                <div key={r.budget.id} className="card stack" style={{ padding: 14, gap: 10, ...catVar(r.category.color) }}>
                  <div className="row">
                    <div className="tile" style={{ width: 36, height: 36, borderRadius: 10, fontSize: 14 }} aria-hidden="true">
                      {r.category.name.charAt(0)}
                    </div>
                    <div className="grow stack" style={{ gap: 1 }}>
                      <span className="item-title">{r.category.name}</span>
                      <span className="small muted num">
                        {t('budgets.ofLimit', { spent: formatMoney(r.spent), limit: formatMoney(r.limit) })}
                        {r.rolledOver !== 0 && t('budgets.carried', { amount: formatMoney(r.rolledOver, { sign: true }) })}
                      </span>
                    </div>
                    <span className={'num nowrap ' + (tight ? 'text-warn' : '')} style={{ fontSize: 14, fontWeight: 600 }}>
                      {r.remaining >= 0
                        ? t('budgets.left', { amount: formatMoney(r.remaining) })
                        : t('budgets.over', { amount: formatMoney(-r.remaining) })}
                    </span>
                  </div>
                  <div
                    className="bar"
                    role="progressbar"
                    aria-label={t('budgets.usedLabel', { name: r.category.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(r.ratio * 100)}
                  >
                    <span style={{ width: `${Math.min(100, r.ratio * 100)}%`, background: tight ? 'var(--warn)' : undefined }} />
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </main>
  );
}

function BudgetEditor({ data, budgets, spaceId }: { data: FinanceData; budgets: Budget[]; spaceId?: string }) {
  const categories = data.categories.filter((c) => c.kind === 'expense' && !c.system && !c.archived);
  const total = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  return (
    <section className="stack" style={{ gap: 12, maxWidth: 640 }}>
      <p className="label">
        {t(data.settings.budgetPeriod === 'payday' ? 'budgets.editIntroPayday' : 'budgets.editIntroMonth', { amount: formatMoney(total) })}
      </p>
      <div className="list">
        {categories.map((c) => (
          <BudgetInput
            key={`${spaceId ?? 'mine'}:${c.id}`}
            category={c}
            limit={budgets.find((b) => b.categoryId === c.id)?.monthlyLimit}
            spaceId={spaceId}
          />
        ))}
      </div>
    </section>
  );
}

function BudgetInput({ category, limit, spaceId }: { category: Category; limit?: number; spaceId?: string }) {
  const toast = useToast();
  const [text, setText] = useState(limit ? (limit / 100).toFixed(0) : '');
  const id = `budget-${category.id}`;

  async function commit() {
    const value = text.trim() === '' ? null : parseMoney(text);
    if (text.trim() !== '' && value === null) {
      toast({ message: t('budgets.amountHint') });
      return;
    }
    if (value === (limit ?? null)) return;
    await setBudget(category.id, value, spaceId);
    toast({
      message: value
        ? t('budgets.setTo', { name: category.name, amount: formatMoney(value) })
        : t('budgets.removed', { name: category.name }),
    });
  }

  return (
    <div className="field">
      <label htmlFor={id} className="row" style={{ width: 'auto', flex: 1, gap: 10, ...catVar(category.color) }}>
        <span className="dot" />
        <span style={{ color: 'var(--text)', fontSize: 15 }}>{category.name}</span>
      </label>
      <span className="muted" aria-hidden="true">
        {currencySymbol()}
      </span>
      <input
        id={id}
        inputMode="decimal"
        placeholder={t('budgets.noBudget')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        style={{ flex: '0 0 120px', textAlign: 'end' }}
      />
    </div>
  );
}
