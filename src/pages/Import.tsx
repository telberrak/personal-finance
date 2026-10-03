import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { importTransactions, undoImport, ValidationError, type ImportRow } from '../db/repo';
import { OTHER_EXPENSE_ID, OTHER_INCOME_ID, type FinanceData } from '../db/types';
import { formatDate, formatShort, toISO } from '../lib/dates';
import { parseCsv } from '../lib/csv';
import { detectPreset, guessMapping, mapRows, markDuplicates, type ColumnMapping, type DateFormat } from '../lib/importer';
import { findBillMatch, paidOccurrenceKeys } from '../lib/matching';
import { formatMoney } from '../lib/money';
import { applyAlias, normalisePayee } from '../lib/payees';
import { suggestCategory } from '../lib/rules';
import { t } from '../i18n';

interface PreviewRow extends ImportRow {
  line: number;
  duplicate: boolean;
  error?: string;
  billName?: string;
  include: boolean;
}

export function Import({ data }: { data?: FinanceData }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>();
  const [mapping, setMapping] = useState<ColumnMapping>();
  const [accountId, setAccountId] = useState<string>();
  const [overrides, setOverrides] = useState<Record<number, { categoryId?: string; include?: boolean }>>({});
  const [busy, setBusy] = useState(false);

  const account = accountId ?? data?.accounts.find((a) => !a.archived)?.id;
  const header = rows && mapping?.hasHeader ? rows[0] : undefined;
  const preset = header ? detectPreset(header) : undefined;

  const preview = useMemo<PreviewRow[]>(() => {
    if (!data || !rows || !mapping || !account) return [];
    const parsed = mapRows(rows, mapping);
    const valid = parsed.filter((r) => !r.error) as ((typeof parsed)[number] & { date: string; amount: number })[];
    const withDupes = markDuplicates(valid, data.transactions, account);
    const dupeByLine = new Map(withDupes.map((r) => [r.line, r.duplicate]));
    const expense = new Set(data.categories.filter((c) => c.kind === 'expense' && !c.system && !c.archived).map((c) => c.id));
    const income = new Set(data.categories.filter((c) => c.kind === 'income' && !c.archived).map((c) => c.id));
    const taken = paidOccurrenceKeys(data.recurring, data.transactions);

    return parsed.map((r) => {
      const base = { line: r.line, rawPayee: r.rawPayee, date: r.date ?? '', amount: r.amount ?? 0 };
      if (r.error) return { ...base, payee: r.rawPayee, categoryId: '', duplicate: false, error: r.error, include: false };
      // A rename saved for the exact bank description wins; otherwise tidy it up, then apply any rename of the tidy name.
      const aliasedRaw = applyAlias(r.rawPayee, data.aliases);
      const payee = aliasedRaw !== r.rawPayee ? aliasedRaw : applyAlias(normalisePayee(r.rawPayee), data.aliases);
      const duplicate = dupeByLine.get(r.line) ?? false;
      const allowed = base.amount < 0 ? expense : income;
      let categoryId =
        suggestCategory(payee, data.rules, data.transactions, allowed) ?? (base.amount < 0 ? OTHER_EXPENSE_ID : OTHER_INCOME_ID);
      let recurringId: string | undefined;
      let billName: string | undefined;
      if (!duplicate) {
        const match = findBillMatch({ date: base.date, amount: base.amount, payee }, data.recurring, taken);
        if (match) {
          taken.add(`${match.rule.id}|${match.occurrence}`);
          recurringId = match.rule.id;
          billName = match.rule.name;
          categoryId = match.rule.categoryId;
        }
      }
      const o = overrides[r.line] ?? {};
      return {
        ...base,
        payee,
        categoryId: o.categoryId ?? categoryId,
        recurringId,
        billName,
        duplicate,
        include: o.include ?? !duplicate,
      };
    });
  }, [data, rows, mapping, account, overrides]);

  if (!data) return <Loading />;

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) return toast({ message: t('import.empty') });
    setFileName(file.name);
    setRows(parsed);
    setMapping(guessMapping(parsed));
    setOverrides({});
  }

  const toImport = preview.filter((r) => r.include && !r.error);
  const counts = {
    total: preview.length,
    duplicates: preview.filter((r) => r.duplicate).length,
    errors: preview.filter((r) => r.error).length,
    bills: toImport.filter((r) => r.recurringId).length,
  };

  async function runImport() {
    if (!account) return;
    setBusy(true);
    try {
      const batch = await importTransactions(account, fileName, toImport);
      toast({
        message: t('import.imported', { count: batch.rowCount }),
        action: {
          label: t('common.undo'),
          onClick: async () => {
            await undoImport(batch.id);
          },
        },
      });
      navigate('/activity');
    } catch (err) {
      setBusy(false);
      toast({ message: err instanceof ValidationError ? err.message : t('import.failed') });
    }
  }

  const columnOptions = (rows?.[0] ?? []).map((h, i) => (
    <option key={i} value={i}>
      {mapping?.hasHeader ? h || t('import.column', { n: i + 1 }) : t('import.columnSample', { n: i + 1, sample: h.slice(0, 18) })}
    </option>
  ));
  const setMap = (patch: Partial<ColumnMapping>) => mapping && setMapping({ ...mapping, ...patch });
  const categoriesFor = (amount: number) =>
    data.categories.filter((c) => !c.system && !c.archived && c.kind === (amount < 0 ? 'expense' : 'income'));

  return (
    <main className="screen">
      <PageHeader title={t('import.title')} subtitle={t('import.subtitle')} />

      <section className="card stack" style={{ gap: 14, maxWidth: 720 }}>
        <div className="list">
          <Field label={t('fields.account')}>
            {(id) => (
              <select id={id} value={account} onChange={(e) => setAccountId(e.target.value)}>
                {data.accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </div>
        <label className="file-drop">
          <Icon name="upload" size={22} />
          <span>{fileName ? t('import.chooseAnother', { file: fileName }) : t('import.choose')}</span>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <p className="small muted">{t('import.help')}</p>
      </section>

      {rows && mapping && (
        <section className="section">
          <h2 className="section-title">{preset ? t('import.recognised', { bank: preset.name }) : t('import.columns')}</h2>
          <div className="list" style={{ maxWidth: 720 }}>
            <Field label={t('fields.date')}>
              {(id) => (
                <select id={id} value={mapping.date} onChange={(e) => setMap({ date: Number(e.target.value) })}>
                  {columnOptions}
                </select>
              )}
            </Field>
            <Field label={t('import.format')}>
              {(id) => (
                <select id={id} value={mapping.dateFormat} onChange={(e) => setMap({ dateFormat: e.target.value as DateFormat })}>
                  <option value="dmy">{t('import.dmy')}</option>
                  <option value="mdy">{t('import.mdy')}</option>
                  <option value="ymd">{t('import.ymd')}</option>
                </select>
              )}
            </Field>
            <Field label={t('columns.payee')}>
              {(id) => (
                <select id={id} value={mapping.description} onChange={(e) => setMap({ description: Number(e.target.value) })}>
                  {columnOptions}
                </select>
              )}
            </Field>
            <Field label={t('import.amounts')}>
              {(id) => (
                <select
                  id={id}
                  value={mapping.amount !== undefined ? 'one' : 'two'}
                  onChange={(e) =>
                    setMap(
                      e.target.value === 'one'
                        ? { amount: mapping.amount ?? 2, moneyIn: undefined, moneyOut: undefined }
                        : { amount: undefined, moneyOut: mapping.moneyOut ?? 2, moneyIn: mapping.moneyIn ?? 3 },
                    )
                  }
                >
                  <option value="one">{t('import.oneColumn')}</option>
                  <option value="two">{t('import.twoColumns')}</option>
                </select>
              )}
            </Field>
            {mapping.amount !== undefined ? (
              <Field label={t('columns.amount')}>
                {(id) => (
                  <select id={id} value={mapping.amount} onChange={(e) => setMap({ amount: Number(e.target.value) })}>
                    {columnOptions}
                  </select>
                )}
              </Field>
            ) : (
              <>
                <Field label={t('activity.moneyOut')}>
                  {(id) => (
                    <select id={id} value={mapping.moneyOut} onChange={(e) => setMap({ moneyOut: Number(e.target.value) })}>
                      {columnOptions}
                    </select>
                  )}
                </Field>
                <Field label={t('activity.moneyIn')}>
                  {(id) => (
                    <select id={id} value={mapping.moneyIn} onChange={(e) => setMap({ moneyIn: Number(e.target.value) })}>
                      {columnOptions}
                    </select>
                  )}
                </Field>
              </>
            )}
          </div>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <label className="check-row">
              <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMap({ hasHeader: e.target.checked })} />
              <span>{t('import.header')}</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={mapping.invertAmount} onChange={(e) => setMap({ invertAmount: e.target.checked })} />
              <span>{t('import.flip')}</span>
            </label>
          </div>
        </section>
      )}

      {preview.length > 0 && (
        <section className="section">
          <div className="section-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h2 className="section-title">{t('import.preview')}</h2>
            <span className="label">
              {t('import.summary', {
                toImport: toImport.length,
                duplicates: counts.duplicates,
                errors: counts.errors,
                bills: counts.bills,
              })}
            </span>
          </div>
          <div className="table-card table-scroll">
            <table className="table">
              <caption className="visually-hidden">{t('import.rows')}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">{t('import.include')}</span>
                  </th>
                  <th scope="col">{t('fields.date')}</th>
                  <th scope="col">{t('columns.payee')}</th>
                  <th scope="col">{t('columns.category')}</th>
                  <th scope="col" className="num-col">
                    {t('columns.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line} className={!r.include ? 'is-muted' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('import.includeLine', { line: r.line })}
                        checked={r.include}
                        disabled={!!r.error}
                        onChange={(e) => setOverrides({ ...overrides, [r.line]: { ...overrides[r.line], include: e.target.checked } })}
                      />
                    </td>
                    <td className="num nowrap">{r.date ? formatShort(r.date) : '—'}</td>
                    <td>
                      <div className="stack" style={{ gap: 0 }}>
                        <span className="item-title">{r.payee || '—'}</span>
                        <span className="small muted">
                          {r.error ??
                            (r.duplicate
                              ? t('import.alreadyImported')
                              : r.billName
                                ? t('import.paysBill', { name: r.billName })
                                : r.rawPayee !== r.payee
                                  ? r.rawPayee
                                  : '')}
                        </span>
                      </div>
                    </td>
                    <td>
                      {!r.error && (
                        <select
                          aria-label={t('import.categoryForLine', { line: r.line })}
                          className="cell-select"
                          value={r.categoryId}
                          onChange={(e) => setOverrides({ ...overrides, [r.line]: { ...overrides[r.line], categoryId: e.target.value } })}
                        >
                          {categoriesFor(r.amount).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={'num-col amount' + (r.amount > 0 ? ' amount--in' : '')}>
                      {r.error ? '' : formatMoney(r.amount, { sign: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            style={{ maxWidth: 360 }}
            disabled={busy || toImport.length === 0}
            onClick={runImport}
          >
            {t('import.run', { count: toImport.length })}
          </button>
        </section>
      )}

      {data.importBatches.length > 0 && (
        <section className="section" style={{ maxWidth: 720 }}>
          <h2 className="section-title">{t('import.recent')}</h2>
          <div className="list">
            {data.importBatches.slice(0, 5).map((b) => (
              <div key={b.id} className="list-row">
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="item-title">{b.fileName}</span>
                  <span className="item-meta">
                    {t('import.batchMeta', {
                      count: b.rowCount,
                      date: formatDate(toISO(new Date(b.importedAt))),
                      account: data.accounts.find((a) => a.id === b.accountId)?.name ?? '',
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={async () => {
                    const n = await undoImport(b.id);
                    toast({ message: t('import.removed', { count: n }) });
                  }}
                >
                  {t('import.undo')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="small muted">
        {t('import.tipPrefix')}
        <Link to="/settings/rules">{t('import.tipLink')}</Link>
        {t('import.tipSuffix')}
      </p>
    </main>
  );
}
