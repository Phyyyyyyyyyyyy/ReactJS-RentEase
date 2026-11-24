import { Link, useNavigate } from 'react-router';
import AuthLayout from '../../components/AuthLayout';
import { BusyButton, Field, FormErrors, Messages } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { SELF_REGISTER_ROLES } from '../../lib/constants';

export default function Register() {
  const { flash } = useFlash();
  const navigate = useNavigate();
  const form = useForm({
    first_name: '', last_name: '', username: '', phone: '', email: '', role: 'tenant', password1: '', password2: '',
  });
  const { bind, errors } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const data = await api('/auth/register/', { method: 'POST', body: values });
      flash('success', data.message);
      navigate('/login');
    });
  };

  return (
    <AuthLayout title="Create account" visualClass="register-visual" visual={(
      <div className="auth-copy">
        <span className="eyebrow light">Account registration</span>
        <h1>Start with the portal that matches your rental role.</h1>
        <p>Public registration is for Tenant and Property Owner accounts. Admin and Staff accounts are created by an administrator.</p>
      </div>
    )}>
      <form className="auth-card wide-auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-card-heading">
          <span className="eyebrow">Create account</span>
          <h2>Register for RentEase</h2>
          <p>All fields are required.</p>
        </div>
        <Messages />
        <FormErrors errors={errors} />
        <div className="form-grid two">
          <Field label="First name" error={errors.first_name}><input {...bind('first_name')} autoComplete="given-name" /></Field>
          <Field label="Last name" error={errors.last_name}><input {...bind('last_name')} autoComplete="family-name" /></Field>
        </div>
        <div className="form-grid two">
          <Field label="Username" error={errors.username}><input {...bind('username')} autoComplete="username" /></Field>
          <Field label="Contact number" error={errors.phone}><input {...bind('phone')} type="tel" autoComplete="tel" /></Field>
        </div>
        <Field label="Email" error={errors.email}><input {...bind('email')} type="email" autoComplete="email" /></Field>
        <Field label="Account type" error={errors.role}>
          <select {...bind('role')}>
            {SELF_REGISTER_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <div className="form-grid two">
          <Field label="Password" error={errors.password1}>
            <input {...bind('password1')} type="password" autoComplete="new-password" />
          </Field>
          <Field label="Password confirmation" error={errors.password2}>
            <input {...bind('password2')} type="password" autoComplete="new-password" />
          </Field>
        </div>
        <small className="field-help">Use at least 8 characters. Avoid common or all-numeric passwords.</small>
        <BusyButton className="primary-button full" busy={form.busy} busyText="Creating account…">Create account</BusyButton>
        <p className="auth-switch">Already registered? <Link to="/login">Back to sign in</Link></p>
      </form>
    </AuthLayout>
  );
}
