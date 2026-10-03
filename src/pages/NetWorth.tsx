import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BalanceLine } from '../components/charts';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet } from '../components/ui/Dialog';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { saveAccount, ValidationError } from '../db/repo';
import { VALUED_TYPES, type Account, type FinanceData } from '../db/types';
import { t } from '../i18n';
import { formatDate, formatMonthYear, shiftMonth, today, type ISODate } from '../lib/dates';
import { amortise, payoffPlan, type Strategy } from '../lib/debt';
import { formatMoney, formatRate, parseMoney } from '../lib/money';
import { debtsOf, netWorth, netWorthHistory } from '../lib/networth';

const monthsLater = (n: number): ISODate => shiftMonth(today(), n);
const STRATEGIES: Strategy[] = ['avalanche', 'snowball'];

export function NetWorth({ data }: { data?: FinanceData }) {
  const [valuing, setValuing] = useState<Account>();
  const ref = today();
  const worth = useMemo(() => (data ? netWorth(data) : undefined), [data]);
  const history = useMemo(() => (data ? netWorthHistory(data, ref) : []), [data, ref]);
  if (!data || !worth) return <Loading />;

  const assets = worth.rows.filter((r) => !r.liability);
  const liabilities = worth.rows.filter((r) => r.liability);

  return (
    <main className="screen">
      <PageHeader title={t('networth.title')} subtitle={t('networth.subtitle')} />
      <section className="card stack" style={{ gap: 12 }} aria-label={t('networth.title')}>
        <span className="label">{t('networth.total')}</span>
        <span className={'value-lg' + (worth.net < 0 ? ' text-warn' : '')}>{formatMoney(worth.net)}</span>
        <div className="grid-2">
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">{t('networth.assets')}</span>
            <span className="value-md">{formatMoney(worth.assets)}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">{t('networth.liabilities')}</span>
            <span className="value-md">{formatMoney(-worth.liabilities)}</span>
          </div>
        </div>
        <BalanceLine points={history} label={t('networth.chartLabel')} showLowest={false} formatTick={formatMonthYear} />
      </section>

      <Breakdown title={t('networth.assets')} rows={assets} onValue={setValuing} />
      <Breakdown title={t('networth.liabilities')} rows={liabilities} onValue={setValuing} />
      {worth.rows.length > 0 && (
        <Link to="/settings/accounts" className="link-btn" style={{ alignSelf: 'flex-start' }}>
          {t('networth.manageAccounts')}
        </Link>
      )}

      <DebtPlanner data={data} />

      <Sheet open={!!valuing} onClose={() => setValuing(undefined)} title={t('networth.updateValue')}>
        {valuing && <ValueForm account={valuing} onDone={() => setValuing(undefined)} />}
      </Sheet>
    </main>
  );
}

function Breakdown({
  title,
  rows,
  onValue,
}: {
  title: string;
  rows: { account: Account; balance: number; liability: boolean }[];
  onValue: (a: Account) => void;
}) {
  if (!rows.length) return null;
  return (
    <section className="section">
      <h2 className="section-label">{title}</h2>
      <div className="list">
        {rows.map(({ account, balance, liability }) => {
          const payoff =
            liability && account.apr !== undefined && account.monthlyPayment
              ? amortise(-balance, account.apr, account.monthlyPayment)
              : undefined;
          const latest = account.valuations?.at(-1);
          return (
            <div className="list-row" key={account.id}>
              <div className="grow stack" style={{ gap: 2 }}>
                <span className="item-title" translate="no">
                  {account.name}
                </span>
                <span className="item-meta">
                  {t(`accounts.type.${account.type}`)}
                  {account.apr !== undefined && ` · ${t('networth.apr', { rate: formatRate(account.apr) })}`}
                  {payoff &&
                    ` · ${Number.isFinite(payoff.months) ? t('networth.paidOffBy', { date: formatMonthYear(monthsLater(payoff.months)) }) : t('networth.neverPaidOff')}`}
                  {latest && ` · ${t('networth.valuedOn', { date: formatDate(latest.date) })}`}
                </span>
                {VALUED_TYPES.includes(account.type) && (
                  <button
                    type="button"
                    className="link-btn"
                    style={{ alignSelf: 'flex-start', padding: 0 }}
                    onClick={() => onValue(account)}
                  >
                    {t('networth.update')}
                  </button>
                )}
              </div>
              <span className={'amount' + (balance < 0 ? ' text-warn' : '')}>{formatMoney(balance)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ValueForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today());
  async function submit(e: FormEvent) {
    e.preventDefault();
    const pence = parseMoney(value);
    if (pence === null) return toast({ message: t('networth.valueHint') });
    const valuations = [...(account.valuations ?? []).filter((v) => v.date !== date), { date, value: pence }].sort((a, b) =>
      a.date < b.date ? -1 : 1,
    );
    try {
      await saveAccount({ ...account, valuations });
      toast({ message: t('networth.valueSaved') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('accounts.saveFailed') });
    }
  }
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="small muted">{t('networth.valueIntro', { name: account.name })}</p>
      <MoneyInput value={value} onChange={setValue} label={t('networth.value')} autoFocus />
      <div className="list">
        <Field label={t('fields.date')}>
          {(id) => <input id={id} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />}
        </Field>
      </div>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid">
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

function DebtPlanner({ data }: { data: FinanceData }) {
  const debts = useMemo(() => debtsOf(data), [data]);
  const minimums = debts.reduce((s, d) => s + d.payment, 0);
  const [budgetText, setBudgetText] = useState('');
  const [extraText, setExtraText] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('avalanche');
  const budget = parseMoney(budgetText) ?? Math.round(minimums * 1.1);
  const extra = parseMoney(extraText) ?? 0;
  const plan = useMemo(() => payoffPlan(debts, budget, strategy), [debts, budget, strategy]);
  const other = useMemo(() => payoffPlan(debts, budget, strategy === 'avalanche' ? 'snowball' : 'avalanche'), [debts, budget, strategy]);
  const faster = useMemo(() => (extra > 0 ? payoffPlan(debts, budget + extra, strategy) : undefined), [debts, budget, extra, strategy]);

  if (!debts.length) return null;
  return (
    <section className="section" aria-labelledby="planner-title">
      <h2 className="section-label" id="planner-title">
        {t('planner.title')}
      </h2>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {t('planner.intro', { minimums: formatMoney(minimums) })}
      </p>
      <div className="list">
        <Field label={t('planner.budget')}>
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              placeholder={(budget / 100).toFixed(2)}
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('planner.extra')}>
          {(id) => (
            <input id={id} inputMode="decimal" placeholder="0.00" value={extraText} onChange={(e) => setExtraText(e.target.value)} />
          )}
        </Field>
      </div>
      <div className="segmented" role="radiogroup" aria-label={t('planner.strategy')}>
        {STRATEGIES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={strategy === s} onClick={() => setStrategy(s)}>
            {t(`planner.${s}`)}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {t(`planner.${strategy}Hint`)}
      </p>
      {!plan.feasible ? (
        <p className="text-warn small" role="status">
          {t('planner.notEnough', { minimums: formatMoney(minimums) })}
        </p>
      ) : (
        <div className="card stack" style={{ gap: 10 }} role="status">
          <p>
            {t('planner.debtFreeBy', {
              date: formatMonthYear(monthsLater(plan.months)),
              count: plan.months,
              interest: formatMoney(plan.totalInterest),
            })}
          </p>
          {other.feasible && (
            <p className="small muted">
              {other.totalInterest === plan.totalInterest && other.months === plan.months
                ? t('planner.same')
                : t('planner.compare', {
                    other: t(`planner.${strategy === 'avalanche' ? 'snowball' : 'avalanche'}`),
                    interest: formatMoney(other.totalInterest),
                    count: other.months,
                  })}
            </p>
          )}
          {faster?.feasible && (
            <p className="small">
              {t('planner.extraSaves', {
                amount: formatMoney(extra),
                count: plan.months - faster.months,
                interest: formatMoney(plan.totalInterest - faster.totalInterest),
              })}
            </p>
          )}
          <ol className="stack small" style={{ gap: 4, paddingInlineStart: 20 }}>
            {plan.order.map((o) => (
              <li key={o.id}>
                <span translate="no">{o.name}</span> — {formatMonthYear(monthsLater(o.month))}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
