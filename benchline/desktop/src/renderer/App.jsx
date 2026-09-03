import { useEffect, useState } from 'react';
import { ThemeProvider, useTheme } from './ThemeContext.jsx';
import LoginScreen from './LoginScreen.jsx';
import PosScreen from './PosScreen.jsx';
import ProductsScreen from './ProductsScreen.jsx';
import CustomersScreen from './CustomersScreen.jsx';
import SalesHistoryScreen from './SalesHistoryScreen.jsx';
import { Icons } from './Icons.jsx';

function Shell() {
  const [loggedIn, setLoggedIn] = useState(null); // null = still checking
  const [profile, setProfile] = useState(null); // { is_owner, role, full_name, username }
  const [view, setView] = useState('sell');
  const [saleTick, setSaleTick] = useState(0);
  const [pendingSync, setPendingSync] = useState(0);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    window.pos.isLoggedIn().then(setLoggedIn);
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    window.pos.getProfile().then(setProfile);
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    const check = () => window.pos.pendingSyncCount().then(setPendingSync);
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [loggedIn]);

  if (loggedIn === null) return null; // avoid a login-screen flash while checking
  if (!loggedIn) {
    return (
      <LoginScreen
        onLoggedIn={() => {
          setLoggedIn(true);
          setView('sell'); // always land on Sell — the one screen every role has
        }}
      />
    );
  }

  // Owner (first/superuser account, or a Worker with role='owner') gets
  // every screen. A seller only gets to sell — matching the same split
  // already proven out on the web app (Reports/Liabilities/Workers are
  // owner-only there; here it's simpler since only Sell/Products/History
  // exist so far, so a seller just gets Sell).
  const isOwner = Boolean(profile?.is_owner);

  function handleLogout() {
    window.pos.logout().then(() => {
      setLoggedIn(false);
      setProfile(null);
    });
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 200, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18, padding: '0 6px' }}>Everyday Wine Store</div>
        <NavButton active={view === 'sell'} onClick={() => setView('sell')}>{Icons.cart} Sell</NavButton>
        {isOwner && (
          <>
            <NavButton active={view === 'products'} onClick={() => setView('products')}>Products</NavButton>
            <NavButton active={view === 'customers'} onClick={() => setView('customers')}>Customers</NavButton>
            <NavButton active={view === 'history'} onClick={() => setView('history')}>Sales history</NavButton>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '0 6px', marginBottom: 8 }}>
          {pendingSync > 0 ? `${pendingSync} change${pendingSync > 1 ? 's' : ''} waiting to sync` : 'All changes synced'}
        </div>
        <div className="nav-footer mono" style={{ padding: '0 6px', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{profile?.full_name || profile?.username}</div>
          <div style={{ opacity: 0.6, fontSize: 10.5, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            {isOwner ? 'Owner' : 'Seller'}
          </div>
          <button
            className="btn ghost small"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            onClick={handleLogout}
          >
            {Icons.logout} Log out
          </button>
        </div>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? Icons.sun : Icons.moon}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {view === 'sell' && <PosScreen onSaleComplete={() => setSaleTick((t) => t + 1)} />}
        {view === 'products' && isOwner && <ProductsScreen />}
        {view === 'customers' && isOwner && <CustomersScreen />}
        {view === 'history' && isOwner && <SalesHistoryScreen refreshKey={saleTick} />}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '9px 10px', marginBottom: 2,
        borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
        background: active ? 'var(--accent-dim)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-dim)',
      }}
    >
      {children}
    </button>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
