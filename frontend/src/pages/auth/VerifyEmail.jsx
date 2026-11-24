import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import AuthLayout from '../../components/AuthLayout';
import Icon from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { api } from '../../lib/api';

/** /verify-email?token=...: opened from the link in the verification email. */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ status: token ? 'checking' : 'error', message: 'This link is missing its code. Open the link from your email again.' });
  const sent = useRef(false);

  useEffect(() => {
    // Each link works once, so send it only once (React runs effects twice in development).
    if (!token || sent.current) return;
    sent.current = true;
    api('/auth/verify-email/', { method: 'POST', body: { token } })
      .then((data) => setState({ status: 'done', message: data.message }))
      .catch((error) => setState({ status: 'error', message: error.message }));
  }, [token]);

  return (
    <AuthLayout title="Verify email" visual={(
      <div className="auth-copy">
        <span className="eyebrow light">Account security</span>
        <h1>One last step to activate your account.</h1>
        <p>Confirming your email lets us reach you about your applications and rent.</p>
      </div>
    )}>
      <div className="auth-card">
        <div className="auth-card-heading">
          <span className="eyebrow">Email verification</span>
          <h2>{state.status === 'checking' ? 'Verifying…' : state.status === 'done' ? 'Email verified' : 'Link not valid'}</h2>
        </div>
        {state.status === 'checking' ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Checking your link…</p>
        ) : (
          <div className={`form-alert ${state.status === 'done' ? 'success' : 'error'}`} role="alert">{state.message}</div>
        )}
        {state.status !== 'checking' && (
          <Link className="primary-button full" to="/login">Go to sign in <Icon name="arrow" size={18} /></Link>
        )}
      </div>
    </AuthLayout>
  );
}
