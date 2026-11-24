import { useEffect } from 'react';
import { asset } from '../lib/constants';
import { ThemeToggle } from './ui';

/** Two-column sign-in / register page: brand panel on the left, the form card on the right. */
export default function AuthLayout({ title, visualClass = '', visual, children }) {
  useEffect(() => {
    document.title = `${title} · RentEase`;
  }, [title]);

  return (
    <div className="auth-layout">
      <section className={`auth-visual ${visualClass}`}>
        <div className="auth-visual-inner">
          <img className="auth-logo" src={asset('brand/rentease-logo-white.svg')} alt="RentEase" width="163" height="40" />
          {visual}
        </div>
      </section>
      <section className="auth-form-side">
        <ThemeToggle className="auth-theme-toggle" />
        {children}
      </section>
    </div>
  );
}
