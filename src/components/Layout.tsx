import type { ReactNode } from 'react';
import { useSyncStatus } from '../sync/engine';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { shiftMonth, startOfMonth, formatMonthYear, type ISODate } from '../lib/dates';
import { Icon, type IconName } from './Icon';
import { useIsDesktop } from './useMediaQuery';
import { t } from '../i18n';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'nav.home', icon: 'home' },
  { to: '/activity', label: 'nav.activity', icon: 'activity' },
  { to: '/bills', label: 'nav.bills', icon: 'calendar' },
  { to: '/budgets', label: 'nav.budgets', icon: 'pie' },
];

/**
 * Phone screens that bring their own Close or Back button (forms and settings) hide the tab bar.
 * Every other screen shows it: an installed app on iOS has no browser Back button to leave by.
 */
const hidesTabBar = (path: string) => /^\/(add|transactions\/|bills\/|settings)/.test(path);

/** Extra sections in the desktop sidebar (on the phone they are linked from Home). */
const MORE: { to: string; label: string; icon: IconName }[] = [
  { to: '/reports', label: 'nav.reports', icon: 'chart' },
  { to: '/goals', label: 'nav.goals', icon: 'target' },
  { to: '/networth', label: 'nav.networth', icon: 'wallet' },
  { to: '/calendar', label: 'nav.calendar', icon: 'calendar' },
];

function Tab({ to, label, icon }: (typeof TABS)[number]) {
  return (
    <NavLink to={to} end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
      <Icon name={icon} />
      {t(label)}
    </NavLink>
  );
}

/** Phone: bottom tab bar with the add button in the middle. */
function BottomNav() {
  return (
    <nav className="nav" aria-label={t('nav.main')}>
      <div className="nav-inner">
        <Tab {...TABS[0]} />
        <Tab {...TABS[1]} />
        <NavLink to="/add" className="nav-add" aria-label={t('nav.addTransaction')}>
          <Icon name="plus" size={26} strokeWidth={2.2} />
        </NavLink>
        <Tab {...TABS[2]} />
        <Tab {...TABS[3]} />
      </div>
    </nav>
  );
}

/** Desktop: fixed sidebar with the brand, sections, add button and settings. */
function Sidebar() {
  return (
    <aside className="sidebar">
      <Link to="/" className="brand">
        <img src="/icon.svg" alt="" width={32} height={32} />
        {t('app.name')}
      </Link>
      <Link to="/add" className="btn btn--solid side-add">
        <Icon name="plus" size={18} strokeWidth={2.2} />
        {t('nav.addTransaction')}
      </Link>
      <nav className="side-nav" aria-label={t('nav.main')}>
        {[...TABS, ...MORE].map((tab) => (
          <NavLink key={tab.to} to={tab.to} end className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
            <Icon name={tab.icon} size={20} />
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/import" className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
          <Icon name="upload" size={20} />
          {t('nav.import')}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
          <Icon name="settings" size={20} />
          {t('nav.settings')}
        </NavLink>
        <p className="small muted" style={{ padding: '8px 12px 0' }}>
          <DataLocation />
        </p>
      </div>
    </aside>
  );
}

/** One shell for every route: sidebar on desktop, bottom tabs on the phone's main screens. */
export function AppShell() {
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  return (
    <div className="shell">
      {isDesktop && <Sidebar />}
      <div className="shell-main">
        <Outlet />
      </div>
      {!isDesktop && !hidesTabBar(pathname) && <BottomNav />}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="screen-header page-header">
      <div className="stack" style={{ gap: 2 }}>
        {subtitle && <span className="label">{subtitle}</span>}
        <h1 className="screen-title">{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** ‹ October 2026 › — the next button is disabled on the current month. */
export function MonthSwitcher({ month, onChange, current }: { month: ISODate; onChange: (m: ISODate) => void; current: ISODate }) {
  const atCurrent = month === startOfMonth(current);
  return (
    <div className="month-switcher">
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label={t('common.previousMonth')}
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <Icon name="back" size={20} />
      </button>
      <span className="month-label">{formatMonthYear(month)}</span>
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label={t('common.nextMonth')}
        disabled={atCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <Icon name="forward" size={20} />
      </button>
    </div>
  );
}

export function Loading() {
  return (
    <main className="screen" aria-busy="true">
      <p className="empty">{t('common.loading')}</p>
    </main>
  );
}

/** Where the data lives: only here, or synced (end-to-end encrypted). */
function DataLocation() {
  const { phase } = useSyncStatus();
  const synced = phase === 'idle' || phase === 'syncing' || phase === 'offline' || phase === 'error';
  return <>{synced ? t('nav.dataSynced') : t('nav.dataLocal')}</>;
}
