import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Load JSON from the API. Returns { data, error, loading, reload }.
 * While reloading, the previous data stays on screen (no flicker); pages show
 * a skeleton only on the first load.
 */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
