import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { useTheme } from '../context/ThemeContext';
import { subscription } from '../api/endpoints';
import { Icons } from './Icons';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', mobileLabel: 'Home', icon: Icons.dashboard, end: true },
  { to: '/inventory', label: 'Inventory', mobileLabel: 'Stock', icon: Icons.inventory },
  { to: '/repairs', label: 'Repairs', mobileLabel: 'Repairs', icon: Icons.repairs },
  { to: '/sales', label: 'Sales', mobileLabel: 'Sales', icon: Icons.sales },
];

const OWNER_NAV_ITEMS = [
  { to: '/reports', label: 'Reports', mobileLabel: 'Reports', icon: Icons.reports },
  { to: '/liabilities', label: 'Liabilities', mobileLabel: 'Owe', icon: Icons.liabilities },
  { to: '/workers', label: 'Workers', mobileLabel: 'Workers', icon: Icons.workers },
  { to: '/billing', label: 'Billing', mobileLabel: 'Billing', icon: Icons.billing },
];

export default function Layout() {
  const { user, logout, isOwner } = useAuth();
  const { status: liveStatus, versions } = useLive();
  const { theme, toggleTheme } = useTheme();
  const items = isOwner ? [...NAV_ITEMS, ...OWNER_NAV_ITEMS] : NAV_ITEMS;

  const [sub, setSub] = useState(null);
  useEffect(() => {
    subscription.status().then(({ data }) => setSub(data)).catch(() => {});
  }, [versions.subscription]);

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand"><span className="dot" />EVERYDAY WINE STORE</div>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}
          >
            {item.icon}<span>{item.label}</span>
          </NavLink>
        ))}
        <div className="nav-footer mono">
          {user?.full_name || user?.username}
          <div style={{ opacity: 0.6, fontSize: 10.5, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            {isOwner ? 'Owner' : 'Seller'}
          </div>
          <div className={`live-indicator ${liveStatus === 'open' ? 'live' : ''}`} title={
            liveStatus === 'open' ? 'Live — sales and stock changes appear instantly' : 'Reconnecting…'
          }>
            <span className="dot" />
            {liveStatus === 'open' ? 'Live' : 'Reconnecting…'}
          </div>
          <button
            className="btn ghost small"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            onClick={logout}
          >
            {Icons.logout} Log out
          </button>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? Icons.sun : Icons.moon}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </div>

      <main className="content">
        {sub && !sub.cloud_services_enabled && (
          <div className="banner warn" style={{ marginBottom: 18 }}>
            {sub.effective_status === 'expired'
              ? 'Subscription expired — cloud sync and the CEO app are paused. Selling on this desktop still works normally.'
              : "Subscription in its grace period — renew soon to keep cloud sync running."}
            {isOwner && <Link to="/billing" style={{ marginLeft: 'auto', fontWeight: 700 }}>Subscribe →</Link>}
          </div>
        )}
        <Outlet />
      </main>

      <button className="theme-toggle-fab" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'dark' ? Icons.sun : Icons.moon}
      </button>

      <div className="bottomnav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {item.icon}<span>{item.mobileLabel}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
