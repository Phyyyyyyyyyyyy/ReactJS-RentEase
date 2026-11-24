import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

/**
 * Who is signed in. Loaded once from GET /api/auth/session/ (which also sets the
 * CSRF cookie). Any 401 from the API signs the user out here, so the route
 * guards send them to the login page.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading
  const [badges, setBadges] = useState({ pending_applications: 0, pending_payments: 0 });
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api('/auth/session/')
      .then((data) => setUser(data.user))
      .catch((error) => setLoadError(error));
    const onSignedOut = () => setUser(null);
    window.addEventListener('rentease:signed-out', onSignedOut);
    return () => window.removeEventListener('rentease:signed-out', onSignedOut);
  }, []);

  const refreshBadges = useCallback(() => {
    api('/badges/').then(setBadges).catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, badges, refreshBadges, loadError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
