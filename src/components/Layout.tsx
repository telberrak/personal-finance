import { NavLink, Outlet } from 'react-router';
import { Icon, type IconName } from './Icon';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/activity', label: 'Activity', icon: 'activity' },
  { to: '/bills', label: 'Bills', icon: 'calendar' },
  { to: '/budgets', label: 'Budgets', icon: 'pie' },
];

function Tab({ to, label, icon }: (typeof TABS)[number]) {
  return (
    <NavLink to={to} end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
      <Icon name={icon} />
      {label}
    </NavLink>
  );
}

/** Screens with the bottom tab bar. */
export function TabLayout() {
  return (
    <>
      <Outlet />
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
    </>
  );
}

export function Loading() {
  return (
    <main className="screen" aria-busy="true">
      <p className="empty">Loading…</p>
    </main>
  );
}
