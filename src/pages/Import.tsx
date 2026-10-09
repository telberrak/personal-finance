/**
 * Import: read a bank's CSV file, map its columns (or recognise the bank), preview with suggested categories,
 * duplicates and bill matches, import, and undo recent imports. A file can also name each row's category;
 * rows named "Transfers" become transfers with another of your accounts (such as card payments). A file
 * with an Account column (such as Mizan's own export) goes into several accounts at once, and its Source
 * and Destination columns say where each transfer came from and went to.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { importTransactions, undoImport, ValidationError, type ImportRow } from '../db/repo';
import type { FinanceData } from '../db/types';
import { formatDate, formatShort, startOfMonth, toISO } from '../lib/dates';
import { parseCsv } from '../lib/csv';
import { detectPreset, guessMapping, mapRows, type ColumnMapping, type DateFormat } from '../lib/importer';
import { matchAccount, nameKey, otherAccountName, pairTransfers, prepareRows } from '../lib/importPrep';
import { track } from '../lib/usage';
import { formatMoney } from '../lib/money';
import { t } from '../i18n';

interface PreviewRow extends ImportRow {
  accountId: string;
  /** For a transfer: the other account named in the file, when it is one of yours. */
  otherAccountId?: string;
  line: number;
  duplicate: boolean;
  error?: string;
  billName?: string;
  include: boolean;
  /** Named Transfers in the file: a transfer with the "Transfers with" account. */
  transfer?: boolean;
  unknownCategory?: string;
}

/** Optional columns for files covering several accounts, with their labels. */
const EXTRA_COLUMNS = [
  ['account', 'fields.account'],
  ['source', 'import.sourceColumn'],
  ['destination', 'import.destinationColumn'],
] as const;

/** The Import screen. */
export function Import({ data }: { data?: FinanceData }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>();
  const [mapping, setMapping] = useState<ColumnMapping>();
  const [accountId, setAccountId] = useState<string>();
  const [overrides, setOverrides] = useState<Record<number, { categoryId?: string; include?: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [transferWith, setTransferWith] = useState<string>();
  // Names of accounts in the file → your account ('' to leave its rows out), where you changed the guess.
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});

  const account = accountId ?? data?.accounts.find((a) => !a.archived)?.id;
  const header = rows && mapping?.hasHeader ? rows[0] : undefined;
  const preset = header ? detectPreset(header) : undefined;

  const parsed = useMemo(() => (rows && mapping ? mapRows(rows, mapping) : []), [rows, mapping]);
  // Every account named in the file (its Account, Source and Destination columns), first spelling kept.
  const fileAccounts = useMemo(() => {
    const names = new Map<string, string>();
    for (const r of parsed)
      for (const n of [r.accountName, r.sourceName, r.destinationName]) if (n && !names.has(nameKey(n))) names.set(nameKey(n), n);
    return [...names.values()];
  }, [parsed]);
  const multi = mapping?.account !== undefined;

  const preview = useMemo<PreviewRow[]>(() => {
    if (!data || !account) return [];
    const accountOf = (name: string) => {
      const chosen = accountMap[nameKey(name)];
      return chosen !== undefined ? chosen || undefined : matchAccount(name, data.accounts);
    };
    // Each row's account: the one the file names (in a file covering several), else the one chosen above.
    const placed = parsed.map((r) => {
      if (r.error || !multi || !r.accountName) return { r, accountId: account, error: r.error };
      const accountId = accountOf(r.accountName);
      return { r, accountId, error: accountId ? undefined : t('import.errors.account', { name: r.accountName }) };
    });
    const prepared = new Map<number, ReturnType<typeof prepareRows>[number]>();
    for (const id of new Set(placed.flatMap((p) => (p.accountId && !p.error ? [p.accountId] : [])))) {
      const valid = placed.filter((p) => p.accountId === id && !p.error).map((p) => p.r as typeof p.r & { date: string; amount: number });
      for (const row of prepareRows(data, id, valid)) prepared.set(row.line, row);
    }

    return placed.map(({ r, accountId = account, error }) => {
      const base = { line: r.line, accountId, rawPayee: r.rawPayee, date: r.date ?? '', amount: r.amount ?? 0, time: r.time, note: r.note };
      const p = prepared.get(r.line);
      if (error || !p) return { ...base, payee: r.payeeName ?? r.rawPayee, categoryId: '', duplicate: false, error, include: false };
      const { payee, categoryId, recurringId, billName, duplicate, transfer, unknownCategory } = p;
      const o = overrides[r.line] ?? {};
      const otherName = transfer ? otherAccountName(r, accountOf) : undefined;
      const otherAccountId = otherName ? accountOf(otherName) : undefined;
      return {
        ...base,
        payee,
        categoryId: o.categoryId ?? categoryId,
        recurringId,
        billName,
        duplicate,
        include: o.include ?? !duplicate,
        transfer,
        otherAccountId: otherAccountId !== accountId ? otherAccountId : undefined,
        unknownCategory,
      };
    });
  }, [data, parsed, multi, account, accountMap, overrides]);

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
    setAccountMap({});
  }

  // Transfers whose other account the file does not name go to (or come from) this account: by default an
  // everyday account other than the one imported into.
  const open = data.accounts.filter((a) => !a.archived);
  const others = open.filter((a) => a.id !== account);
  const transferAccount =
    transferWith && others.some((a) => a.id === transferWith)
      ? transferWith
      : (others.find((a) => a.includeInSafeToSpend) ?? others[0])?.id;
  const otherOf = (r: PreviewRow) => r.otherAccountId ?? (transferAccount !== r.accountId ? transferAccount : undefined);
  const toImport = preview.filter((r) => r.include && !r.error).map((r) => (r.transfer ? { ...r, transferAccountId: otherOf(r) } : r));
  const transferCount = toImport.filter((r) => r.transfer && !r.otherAccountId).length;
  // Transfers without their other side in the file: it is found in the other account, or made.
  const pairs = pairTransfers(toImport);
  const unpaired = toImport.filter((r, i) => r.transferAccountId && !pairs.has(i)).length;
  const accountName = (id?: string) => open.find((a) => a.id === id)?.name ?? '';
  const unknownNames = [...new Set(preview.flatMap((r) => (r.unknownCategory ? [r.unknownCategory] : [])))];
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
      track('import_done');
      toast({
        message: t('import.imported', { count: batch.rowCount }),
        action: {
          label: t('common.undo'),
          onClick: async () => {
            await undoImport(batch.id);
          },
        },
      });
      // Open Activity on the month of the newest imported row: an older statement would otherwise look missing.
      const newest = toImport.reduce((d, r) => (r.date > d ? r.date : d), '');
      const month = newest && startOfMonth(newest);
      navigate(month && month !== startOfMonth(toISO(new Date())) ? `/activity?month=${month}` : '/activity');
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
  // The usual kind first (spending for money out), then the other: a refund stays in its spending category.
  const categoriesFor = (amount: number) => {
    const usable = data.categories.filter((c) => !c.system && !c.archived && c.kind !== 'transfer');
    const kind = amount < 0 ? 'expense' : 'income';
    return [...usable.filter((c) => c.kind === kind), ...usable.filter((c) => c.kind !== kind)];
  };

  return (
    <main className="screen">
      <PageHeader title={t('import.title')} subtitle={t('import.subtitle')} />

      <section className="card stack" style={{ gap: 14, maxWidth: 720 }}>
        <div className="list">
          <Field label={multi ? t('import.accountFallback') : t('fields.account')}>
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
          <div className="list" style={{ maxWidth: 720 }}>
            {EXTRA_COLUMNS.map(([key, label]) => (
              <Field key={key} label={t(label)}>
                {(id) => (
                  <select
                    id={id}
                    value={mapping[key] ?? ''}
                    onChange={(e) => setMap({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                  >
                    <option value="">{t('import.noColumn')}</option>
                    {columnOptions}
                  </select>
                )}
              </Field>
            ))}
            <Field label={t('columns.category')}>
              {(id) => (
                <select
                  id={id}
                  value={mapping.category ?? ''}
                  onChange={(e) => setMap({ category: e.target.value === '' ? undefined : Number(e.target.value) })}
                >
                  <option value="">{t('import.noCategoryColumn')}</option>
                  {columnOptions}
                </select>
              )}
            </Field>
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

      {fileAccounts.length > 0 && (
        <section className="section" style={{ maxWidth: 720 }}>
          <h2 className="section-title">{t('import.fileAccounts')}</h2>
          <p className="small muted">{t('import.fileAccountsHelp')}</p>
          <div className="list">
            {fileAccounts.map((name) => (
              <Field key={name} label={name}>
                {(id) => (
                  <select
                    id={id}
                    value={accountMap[nameKey(name)] ?? matchAccount(name, data.accounts) ?? ''}
                    onChange={(e) => setAccountMap({ ...accountMap, [nameKey(name)]: e.target.value })}
                  >
                    <option value="">{t('import.notInMizan')}</option>
                    {open.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ))}
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
          {transferCount > 0 && (
            <div className="list" style={{ maxWidth: 720 }}>
              <Field label={t('import.transfersWith', { count: transferCount })}>
                {(id) => (
                  <select id={id} value={transferAccount} onChange={(e) => setTransferWith(e.target.value)}>
                    {others.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}
          {unpaired > 0 && (
            <p className="small muted" role="status">
              {t('import.unpairedTransfers', { count: unpaired })}
            </p>
          )}
          {unknownNames.length > 0 && (
            <p className="small text-warn" role="status">
              {t('import.unknownCategories', { names: unknownNames.join(', ') })}
            </p>
          )}
          <div className="table-card table-scroll">
            <table className="table">
              <caption className="visually-hidden">{t('import.rows')}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">{t('import.include')}</span>
                  </th>
                  <th scope="col">{t('fields.date')}</th>
                  {multi && <th scope="col">{t('fields.account')}</th>}
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
                    {multi && <td className="nowrap">{accountName(r.accountId) || '—'}</td>}
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
                      {!r.error && r.transfer ? (
                        <span className="small muted">
                          {t(r.amount > 0 ? 'transactions.transferFrom' : 'transactions.transferTo', {
                            name: accountName(otherOf(r)),
                          })}
                        </span>
                      ) : (
                        !r.error && (
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
                        )
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
                      account: (b.accountIds ?? [b.accountId]).map((id) => data.accounts.find((a) => a.id === id)?.name ?? '').join(', '),
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
