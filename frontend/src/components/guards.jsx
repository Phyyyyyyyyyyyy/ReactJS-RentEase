import { useEffect } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useFlash } from '../context/FlashContext';

export function dashboardPath(user) {
  return `/dashboard/${user.role}`;
}

/** Go to `to` and show `text` there. */
export function RedirectWithMessage({ to, type = 'error', text }) {
  const { flash } = useFlash();
  useEffect(() => {
    flash(type, text);
  }, [flash, type, text]);
  return <Navigate to={to} replace />;
}

function WrongRole({ to }) {
  return <RedirectWithMessage to={to} text="You do not have permission to open that page." />;
}

/**
 * Only signed-in users (and, with `roles`, only those roles) see `children`.
 * Signed-out visitors go to the login page and come back afterwards; users with
 * the wrong role go back to their own dashboard, like the Django version did.
 */
export function RequireAuth({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !roles.includes(user.role)) return <WrongRole to={dashboardPath(user)} />;
  return children;
}

/**
 * Login and register pages: signed-in users go on to ?next= (the page they
 * wanted before signing in) or else their dashboard.
 */
export function GuestOnly({ children }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user) {
    const next = params.get('next');
    // Only follow in-app paths, never another site.
    const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
    return <Navigate to={safe ? next : dashboardPath(user)} replace />;
  }
  return children;
}
