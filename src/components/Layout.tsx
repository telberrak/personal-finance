import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { shiftMonth, startOfMonth, formatMonthYear, type ISODate } from '../lib/dates';
import { Icon, type IconName } from './Icon';
import { useIsDesktop } from './useMediaQuery';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/activity', label: 'Activity', icon: 'activity' },
  { to: '/bills', label: 'Bills', icon: 'calendar' },
  { to: '/budgets', label: 'Budgets', icon: 'pie' },
];

const TAB_PATHS = new Set(TABS.map((t) => t.to));

/** Extra sections in the desktop sidebar (on the phone they are linked from Home). */
const MORE: { to: string; label: string; icon: IconName }[] = [
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/goals', label: 'Goals', icon: 'target' },
];

function Tab({ to, label, icon }: (typeof TABS)[number]) {
  return (
    <NavLink to={to} end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
      <Icon name={icon} />
      {label}
    </NavLink>
  );
}

/** Phone: bottom tab bar with the add button in the middle. */
function BottomNav() {
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        <Tab {...TABS[0]} />
        <Tab {...TABS[1]} />
        <NavLink to="/add" className="nav-add" aria-label="Add transaction">
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
        Ledger
      </Link>
      <Link to="/add" className="btn btn--solid side-add">
        <Icon name="plus" size={18} strokeWidth={2.2} />
        Add transaction
      </Link>
      <nav className="side-nav" aria-label="Main">
        {[...TABS, ...MORE].map((t) => (
          <NavLink key={t.to} to={t.to} end className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
            <Icon name={t.icon} size={20} />
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/import" className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
          <Icon name="upload" size={20} />
          Import
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => 'side-link' + (isActive ? ' active' : '')}>
          <Icon name="settings" size={20} />
          Settings
        </NavLink>
        <p className="small muted" style={{ padding: '8px 12px 0' }}>
          Your data stays on this device.
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
      {!isDesktop && TAB_PATHS.has(pathname) && <BottomNav />}
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
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <Icon name="back" size={20} />
      </button>
      <span className="month-label">{formatMonthYear(month)}</span>
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label="Next month"
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
      <p className="empty">Loading…</p>
    </main>
  );
}
