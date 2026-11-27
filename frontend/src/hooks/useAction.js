import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useFlash } from '../context/FlashContext';
import { api } from '../lib/api';

/**
 * A one-click request (withdraw, approve, confirm, delete…) with an optional confirm() prompt.
 * Shows the server's message, refreshes the sidebar badges, then calls onDone.
 * `busyKey` tells which button is working, so only that one shows a spinner.
 */
export function useAction() {
  const [busyKey, setBusyKey] = useState(null);
  const inFlight = useRef(false);
  const { notify } = useFlash();
  const { refreshBadges } = useAuth();

  const run = async (key, path, { confirm: question, body, request, onDone } = {}) => {
    if (inFlight.current) return; // a click while another action is still running
    if (question && !window.confirm(question)) return;
    inFlight.current = true;
    setBusyKey(key);
    try {
      // `request` replaces the default POST (e.g. a DELETE).
      const data = request ? await request() : await api(path, { method: 'POST', body });
      notify('success', data?.message);
      refreshBadges();
      if (onDone) await onDone(data);
    } catch (error) {
      notify('error', error.message);
      if (onDone) await onDone(null);
    } finally {
      inFlight.current = false;
      setBusyKey(null);
    }
  };

  return { run, busyKey };
}
