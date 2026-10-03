import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell, Loading } from './components/Layout';
import { LockScreen, useAutoLock } from './components/LockScreen';
import { ConfirmProvider } from './components/ui/Dialog';
import { ToastProvider } from './components/ui/Toast';
import { useTheme } from './components/useTheme';
import { useFinanceData } from './db/db';
import { useSecurityMode } from './db/security';
import { startSync } from './sync/engine';
import { useNotifier } from './notify/notifier';
import { useBankAutoSync } from './banks/banks';
import { Notifications } from './pages/Notifications';
import { applyLocale } from './i18n';
import type { FinanceData } from './db/types';
import { Activity } from './pages/Activity';
import { BillForm } from './pages/BillForm';
import { Bills } from './pages/Bills';
import { Budgets } from './pages/Budgets';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { TransactionForm } from './pages/TransactionForm';
import { Welcome } from './pages/Welcome';

// Less-used screens load on first visit, keeping the start-up bundle small on phones.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType<{ data?: FinanceData }>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Accounts = page(() => import('./pages/Accounts'), 'Accounts');
const Categories = page(() => import('./pages/Categories'), 'Categories');
const Goals = page(() => import('./pages/Goals'), 'Goals');
const Import = page(() => import('./pages/Import'), 'Import');
const Reports = page(() => import('./pages/Reports'), 'Reports');
const Rules = page(() => import('./pages/Rules'), 'Rules');
const Sync = page(() => import('./pages/Sync'), 'Sync');
const Banks = page(() => import('./pages/Banks'), 'Banks');
const NetWorth = page(() => import('./pages/NetWorth'), 'NetWorth');
const Search = page(() => import('./pages/Search'), 'Search');

export function App() {
  // While locked nothing can be decrypted, so the screens (and their data queries) are not mounted.
  const locked = useSecurityMode() === 'locked';
  return (
    <ToastProvider>
      <ConfirmProvider>{locked ? <LockScreen /> : <Unlocked />}</ConfirmProvider>
    </ToastProvider>
  );
}

function Unlocked() {
  const data = useFinanceData();
  // Language, text direction and number/date formats must be in place before anything renders.
  if (data) applyLocale(data.settings.language, data.settings.currency, data.settings.hideAmounts);
  useTheme(data?.settings.theme);
  useAutoLock(data?.settings.lockAfterMinutes);
  useNotifier(data);
  useBankAutoSync(data);
  // Sync runs while unlocked (it needs to read and write the data).
  useEffect(() => startSync(), []);

  let content;
  if (!data) content = <Loading />;
  else if (!data.settings.onboarded) content = <Welcome />;
  else
    content = (
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Home data={data} />} />
              <Route path="activity" element={<Activity data={data} />} />
              <Route path="bills" element={<Bills data={data} />} />
              <Route path="bills/new" element={<BillForm data={data} />} />
              <Route path="bills/:id" element={<BillForm data={data} />} />
              <Route path="budgets" element={<Budgets data={data} />} />
              <Route path="reports" element={<Reports data={data} />} />
              <Route path="goals" element={<Goals data={data} />} />
              <Route path="networth" element={<NetWorth data={data} />} />
              <Route path="search" element={<Search data={data} />} />
              <Route path="import" element={<Import data={data} />} />
              <Route path="add" element={<TransactionForm data={data} />} />
              <Route path="transactions/:id" element={<TransactionForm data={data} />} />
              <Route path="notifications" element={<Notifications data={data} />} />
              <Route path="settings" element={<Settings data={data} />} />
              <Route path="settings/accounts" element={<Accounts data={data} />} />
              <Route path="settings/categories" element={<Categories data={data} />} />
              <Route path="settings/rules" element={<Rules data={data} />} />
              <Route path="settings/sync" element={<Sync data={data} />} />
              <Route path="settings/banks" element={<Banks data={data} />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );

  return content;
}
