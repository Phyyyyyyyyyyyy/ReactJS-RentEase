import { Link } from 'react-router';
import AuthLayout from '../../components/AuthLayout';
import Icon from '../../components/Icon';
import { BusyButton, Field, FormErrors, Messages } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';

export default function Login() {
  const { setUser } = useAuth();
  const { flash } = useFlash();
  const form = useForm({ username: '', password: '' });

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const data = await api('/auth/login/', { method: 'POST', body: values });
      flash('success', data.message);
      setUser(data.user); // <GuestOnly> then sends them on (to ?next= or their dashboard)
    });
  };

  return (
    <AuthLayout title="Sign in" visual={(
      <>
        <div className="auth-copy">
          <span className="eyebrow light">Streamlined rental management</span>
          <h1>Manage access, properties, and rental units in one place.</h1>
          <p>Owners list properties, tenants find their next home, and managers and admins keep everything running.</p>
        </div>
        <div className="auth-feature-grid">
          <div><Icon name="shield" /><strong>Role-based access</strong><span>Admin, owner, manager, and tenant portals</span></div>
          <div><Icon name="key" /><strong>Secure accounts</strong><span>Hashed passwords and protected pages</span></div>
        </div>
      </>
    )}>
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-card-heading">
          <span className="eyebrow">Welcome back</span>
          <h2>Sign in to RentEase</h2>
          <p>Use your username or email address.</p>
        </div>
        <Messages />
        <FormErrors errors={form.errors} />
        <Field label="Username or email" error={form.errors.username}>
          <input {...form.bind('username')} autoFocus autoComplete="username" placeholder="username or name@example.com" />
        </Field>
        <Field label="Password" error={form.errors.password}>
          <input {...form.bind('password')} type="password" autoComplete="current-password" placeholder="Enter your password" />
        </Field>
        <BusyButton className="primary-button full" busy={form.busy} busyText="Signing in…">
          Sign in <Icon name="arrow" size={18} />
        </BusyButton>
        <p className="auth-switch">Have a referral code? <Link to="/register">Create an account</Link></p>
      </form>
    </AuthLayout>
  );
}
