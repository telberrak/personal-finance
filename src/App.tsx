/**
 * The app's root: providers (toasts, confirmations), the lock screen when locked, and every route. Rarely
 * used screens are loaded on first visit so the start-up bundle stays small.
 */
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { AppShell, Loading } from './components/Layout';
import { LockScreen, useAutoLock } from './components/LockScreen';
import { ConfirmProvider } from './components/ui/Dialog';
import { ToastProvider } from './components/ui/Toast';
import { useTheme } from './components/useTheme';
import { useFinanceData } from './db/db';
import { useSecurityMode } from './db/security';
import { startSync } from './sync/engine';
import { cleanOrphanAttachments } from './db/repo';
import { useNotifier } from './notify/notifier';
import { useBankAutoSync } from './banks/banks';
import { useDailyRates } from './components/ExchangeRates';
import { setUsageSharing, track } from './lib/usage';
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
const Calendar = page(() => import('./pages/Calendar'), 'Calendar');
const YearReview = page(() => import('./pages/YearReview'), 'YearReview');
const Tax = page(() => import('./pages/Tax'), 'Tax');
const Friends = page(() => import('./pages/Friends'), 'Friends');
const Household = page(() => import('./pages/Household'), 'Household');
const JoinHousehold = lazy(() => import('./pages/Household').then((m) => ({ default: m.JoinHousehold })));
const About = page(() => import('./pages/Info'), 'About');
const Help = page(() => import('./pages/Help'), 'Help');
const ContentPage = lazy(() => import('./pages/Info').then((m) => ({ default: m.ContentPage })));

/** The root component. */
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
  if (data) applyLocale(data.settings.language, data.settings.currency, data.settings.hideAmounts, data.settings.digits);
  useTheme(data?.settings.theme);
  useAutoLock(data?.settings.lockAfterMinutes);
  useNotifier(data);
  useBankAutoSync(data);
  useDailyRates(data);
  const shareUsage = !!data?.settings.shareUsage;
  useEffect(() => {
    setUsageSharing(shareUsage);
    if (shareUsage) track('app_open');
  }, [shareUsage]);
  // Sync runs while unlocked (it needs to read and write the data).
  useEffect(() => startSync(), []);
  // Receipts of transactions deleted in an earlier session (after the chance to undo).
  useEffect(() => void cleanOrphanAttachments().catch(() => undefined), []);

  let content;
  if (!data) content = <Loading />;
  else if (!data.settings.onboarded) content = <Welcome />;
  else
    content = (
      <BrowserRouter>
        <NativeIntegration />
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
              <Route path="calendar" element={<Calendar data={data} />} />
              <Route path="reports/year/:year" element={<YearReview data={data} />} />
              <Route path="tax" element={<Tax data={data} />} />
              <Route path="friends" element={<Friends data={data} />} />
              <Route path="settings/household" element={<Household data={data} />} />
              <Route path="join" element={<JoinHousehold />} />
              <Route path="help" element={<Help data={data} />} />
              <Route path="privacy" element={<ContentPage data={data} kind="privacy" />} />
              <Route path="terms" element={<ContentPage data={data} kind="terms" />} />
              <Route path="settings/about" element={<About data={data} />} />
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

/** In the iOS/Android app: notification taps open their screen; Android's back button goes back. */
function NativeIntegration() {
  const navigate = useNavigate();
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void (async () => {
      const native = await import('./native/native');
      if (!native.isNative() || cancelled) return;
      const offTap = await native.onNativeNotificationTap((url) => navigate(url));
      const { App: CapApp } = await import('@capacitor/app');
      const back = await CapApp.addListener('backButton', ({ canGoBack }) => (canGoBack ? window.history.back() : void CapApp.exitApp()));
      stop = () => {
        offTap();
        void back.remove();
      };
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [navigate]);
  return null;
}
