import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { importTransactions, undoImport, ValidationError, type ImportRow } from '../db/repo';
import { OTHER_EXPENSE_ID, OTHER_INCOME_ID, type FinanceData } from '../db/types';
import { formatShort } from '../lib/dates';
import { parseCsv } from '../lib/csv';
import { detectPreset, guessMapping, mapRows, markDuplicates, type ColumnMapping, type DateFormat } from '../lib/importer';
import { findBillMatch, paidOccurrenceKeys } from '../lib/matching';
import { formatMoney } from '../lib/money';
import { applyAlias, normalisePayee } from '../lib/payees';
import { suggestCategory } from '../lib/rules';

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
    if (parsed.length === 0) return toast({ message: 'That file looks empty.' });
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
        message: `Imported ${batch.rowCount} transaction${batch.rowCount === 1 ? '' : 's'}`,
        action: {
          label: 'Undo',
          onClick: async () => {
            await undoImport(batch.id);
          },
        },
      });
      navigate('/activity');
    } catch (err) {
      setBusy(false);
      toast({ message: err instanceof ValidationError ? err.message : 'Import failed.' });
    }
  }

  const columnOptions = (rows?.[0] ?? []).map((h, i) => (
    <option key={i} value={i}>
      {mapping?.hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1} (${h.slice(0, 18)})`}
    </option>
  ));
  const setMap = (patch: Partial<ColumnMapping>) => mapping && setMapping({ ...mapping, ...patch });
  const categoriesFor = (amount: number) =>
    data.categories.filter((c) => !c.system && !c.archived && c.kind === (amount < 0 ? 'expense' : 'income'));

  return (
    <main className="screen">
      <PageHeader title="Import" subtitle="Add transactions from your bank’s CSV statement" />

      <section className="card stack" style={{ gap: 14, maxWidth: 720 }}>
        <div className="list">
          <Field label="Account">
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
          <span>{fileName ? `${fileName} · choose another file` : 'Choose a CSV file'}</span>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <p className="small muted">
          Most UK banks let you download statements as CSV from online banking. Monzo, Starling, Barclays, Lloyds, Halifax, Nationwide and
          NatWest are recognised automatically; for others, pick the columns below. Nothing leaves this device.
        </p>
      </section>

      {rows && mapping && (
        <section className="section">
          <h2 className="section-title">{preset ? `Recognised: ${preset.name}` : 'Columns'}</h2>
          <div className="list" style={{ maxWidth: 720 }}>
            <Field label="Date">
              {(id) => (
                <select id={id} value={mapping.date} onChange={(e) => setMap({ date: Number(e.target.value) })}>
                  {columnOptions}
                </select>
              )}
            </Field>
            <Field label="Format">
              {(id) => (
                <select id={id} value={mapping.dateFormat} onChange={(e) => setMap({ dateFormat: e.target.value as DateFormat })}>
                  <option value="dmy">Day / month / year</option>
                  <option value="mdy">Month / day / year</option>
                  <option value="ymd">Year-month-day</option>
                </select>
              )}
            </Field>
            <Field label="Payee">
              {(id) => (
                <select id={id} value={mapping.description} onChange={(e) => setMap({ description: Number(e.target.value) })}>
                  {columnOptions}
                </select>
              )}
            </Field>
            <Field label="Amounts">
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
                  <option value="one">One column (money out is negative)</option>
                  <option value="two">Separate money in and out</option>
                </select>
              )}
            </Field>
            {mapping.amount !== undefined ? (
              <Field label="Amount">
                {(id) => (
                  <select id={id} value={mapping.amount} onChange={(e) => setMap({ amount: Number(e.target.value) })}>
                    {columnOptions}
                  </select>
                )}
              </Field>
            ) : (
              <>
                <Field label="Money out">
                  {(id) => (
                    <select id={id} value={mapping.moneyOut} onChange={(e) => setMap({ moneyOut: Number(e.target.value) })}>
                      {columnOptions}
                    </select>
                  )}
                </Field>
                <Field label="Money in">
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
              <span>First row is a header</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={mapping.invertAmount} onChange={(e) => setMap({ invertAmount: e.target.checked })} />
              <span>Flip signs (money out shows as positive)</span>
            </label>
          </div>
        </section>
      )}

      {preview.length > 0 && (
        <section className="section">
          <div className="section-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <h2 className="section-title">Preview</h2>
            <span className="label">
              {toImport.length} to import · {counts.duplicates} already in Ledger · {counts.errors} unreadable · {counts.bills} matched to
              bills
            </span>
          </div>
          <div className="table-card table-scroll">
            <table className="table">
              <caption className="visually-hidden">Rows to import</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Include</span>
                  </th>
                  <th scope="col">Date</th>
                  <th scope="col">Payee</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="num-col">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line} className={!r.include ? 'is-muted' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Import line ${r.line}`}
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
                              ? 'Already imported'
                              : r.billName
                                ? `Pays bill: ${r.billName}`
                                : r.rawPayee !== r.payee
                                  ? r.rawPayee
                                  : '')}
                        </span>
                      </div>
                    </td>
                    <td>
                      {!r.error && (
                        <select
                          aria-label={`Category for line ${r.line}`}
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
            Import {toImport.length} transaction{toImport.length === 1 ? '' : 's'}
          </button>
        </section>
      )}

      {data.importBatches.length > 0 && (
        <section className="section" style={{ maxWidth: 720 }}>
          <h2 className="section-title">Recent imports</h2>
          <div className="list">
            {data.importBatches.slice(0, 5).map((b) => (
              <div key={b.id} className="list-row">
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="item-title">{b.fileName}</span>
                  <span className="item-meta">
                    {b.rowCount} transactions · {new Date(b.importedAt).toLocaleDateString('en-GB')} ·{' '}
                    {data.accounts.find((a) => a.id === b.accountId)?.name}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={async () => {
                    const n = await undoImport(b.id);
                    toast({ message: `Removed ${n} imported transactions` });
                  }}
                >
                  Undo import
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="small muted">
        Tip: set up <Link to="/settings/rules">rules</Link> so imports land in the right categories.
      </p>
    </main>
  );
}
