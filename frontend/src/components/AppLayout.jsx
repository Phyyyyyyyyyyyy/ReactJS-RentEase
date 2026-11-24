import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useFlash } from '../context/FlashContext';
import { api } from '../lib/api';
import { asset, ROLE_MENUS } from '../lib/constants';
import Icon from './Icon';
import { Avatar, BusyButton, Messages, PingDot, ThemeToggle } from './ui';

const PageTitleContext = createContext(() => {});

/** Sets the top bar heading and the browser tab title for the current page. */
export function usePageTitle(heading, tabTitle = heading) {
  const setHeading = useContext(PageTitleContext);
  useEffect(() => {
    setHeading(heading);
    document.title = `${tabTitle} · RentEase`;
  }, [heading, tabTitle, setHeading]);
}

function SignOutButton({ className, compact }) {
  const { setUser } = useAuth();
  const { flash, notify } = useFlash();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      const data = await api('/auth/logout/', { method: 'POST' });
      flash('info', data.message);
      // Same render: go to /login and clear the user (so the guard doesn't add ?next=).
      navigate('/login', { replace: true });
      setUser(null);
    } catch (error) {
      notify('error', error.message);
      setBusy(false);
    }
  };

  return (
    <BusyButton type="button" className={className} busy={busy} busyText="Signing out…" onClick={onClick}>
      <Icon name="logout" size={compact ? 16 : 19} />
      {compact ? <span>Sign out</span> : 'Sign out'}
    </BusyButton>
  );
}

export default function AppLayout() {
  const { user, badges, refreshBadges } = useAuth();
  const [heading, setHeading] = useState('Dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu, scroll up, and refresh the sidebar badges on every page change.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
    refreshBadges();
  }, [location.pathname, refreshBadges]);

  const menu = ROLE_MENUS[user.role] || [];

  return (
    <PageTitleContext.Provider value={setHeading}>
      <div className="app-shell">
        <aside className={`sidebar${menuOpen ? ' sidebar-open' : ''}`}>
          <div className="brand">
            <img className="brand-mark" src={asset('brand/rentease-app-icon.svg')} alt="" width="36" height="36" />
            <div><strong>RentEase</strong><span>Property Management</span></div>
          </div>
          <div className="role-panel">
            <Avatar user={user} />
            <div className="role-copy"><strong>{user.full_name}</strong><span>{user.role_display}</span></div>
          </div>
          <nav className="side-nav">
            {menu.map((item) => {
              const content = <><Icon name={item.icon} size={19} /><span>{item.label}</span></>;
              if (item.href) return <a key={item.label} href={item.href}>{content}</a>;
              if (!item.to) {
                return (
                  <span key={item.label} className="nav-disabled" title="Coming in a later phase">
                    {content}<em>Soon</em>
                  </span>
                );
              }
              const count = item.badge ? badges[item.badge] : 0;
              return (
                <NavLink key={item.label} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {content}
                  {count > 0 && <PingDot className="ml-auto" label={`${count} ${item.badgeLabel}`} />}
                </NavLink>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <div className="scope-pill"><span>Phase</span><strong>Accounts</strong></div>
            <SignOutButton className="logout-button" />
          </div>
        </aside>
        <div className="mobile-overlay" hidden={!menuOpen} onClick={() => setMenuOpen(false)} />
        <main className="main-area">
          <header className="topbar">
            <button className="mobile-menu" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
              <Icon name="menu" />
            </button>
            <img className="topbar-mark" src={asset('brand/rentease-mark.svg')} alt="" width="28" height="28" />
            <div className="topbar-title"><span>RentEase</span><strong>{heading}</strong></div>
            <ThemeToggle className="topbar-theme-toggle" />
            <Link className="topbar-user" to="/profile">
              <Avatar user={user} className="avatar avatar-small" />
              <span>{user.full_name}</span>
            </Link>
            <div className="topbar-logout">
              <SignOutButton className="secondary-button compact" compact />
            </div>
          </header>
          <div className="content-area">
            <Messages />
            <Outlet />
          </div>
        </main>
      </div>
    </PageTitleContext.Provider>
  );
}
