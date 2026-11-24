import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

const FlashContext = createContext(null);

/**
 * Success / error messages shown at the top of the page (like Django's messages).
 *
 *  - flash(type, text): for the page you are about to navigate to. It survives
 *    exactly one navigation.
 *  - notify(type, text): for the page you are on. It disappears when you leave.
 */
export function FlashProvider({ children }) {
  const [messages, setMessages] = useState([]);
  const nextId = useRef(1);
  const location = useLocation();

  useEffect(() => {
    // On every navigation: drop messages meant for the previous page,
    // and keep the ones that were flashed for this one.
    setMessages((current) => current.filter((m) => m.carry).map((m) => ({ ...m, carry: false })));
  }, [location.key]);

  const add = useCallback((type, text, carry) => {
    if (!text) return;
    const id = nextId.current++;
    setMessages((current) => (current.some((m) => m.type === type && m.text === text)
      ? current // already showing (e.g. React dev mode running an effect twice)
      : [...current, { id, type, text, carry }]));
  }, []);

  const flash = useCallback((type, text) => add(type, text, true), [add]);
  const notify = useCallback((type, text) => {
    add(type, text, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [add]);
  const dismiss = useCallback((id) => setMessages((current) => current.filter((m) => m.id !== id)), []);

  return (
    <FlashContext.Provider value={{ messages, flash, notify, dismiss }}>
      {children}
    </FlashContext.Provider>
  );
}

export function useFlash() {
  return useContext(FlashContext);
}
