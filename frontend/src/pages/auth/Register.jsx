import { Link, useNavigate, useSearchParams } from 'react-router';
import AuthLayout from '../../components/AuthLayout';
import { BusyButton, Field, FormErrors, Messages } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';

export default function Register() {
  const { flash } = useFlash();
  const navigate = useNavigate();
  // A sign-up link like /register?code=ABCD-1234 fills in the referral code.
  const [params] = useSearchParams();
  const form = useForm({
    referral_code: params.get('code') || '', first_name: '', last_name: '', username: '', phone: '', email: '',
    password1: '', password2: '',
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
        <p>Signing up needs a referral code from a RentEase administrator. The code sets your account type: tenant, property owner, or property manager.</p>
      </div>
    )}>
      <form className="auth-card wide-auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-card-heading">
          <span className="eyebrow">Create account</span>
          <h2>Register for RentEase</h2>
          <p>All fields are required, including your referral code.</p>
        </div>
        <Messages />
        <FormErrors errors={errors} />
        <Field label="Referral code" help="Ask a RentEase administrator for a code. It decides your account type." error={errors.referral_code}>
          <input {...bind('referral_code')} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="e.g. K7QX-M2PA" />
        </Field>
        <div className="form-grid two">
          <Field label="First name" error={errors.first_name}><input {...bind('first_name')} autoComplete="given-name" /></Field>
          <Field label="Last name" error={errors.last_name}><input {...bind('last_name')} autoComplete="family-name" /></Field>
        </div>
        <div className="form-grid two">
          <Field label="Username" error={errors.username}><input {...bind('username')} autoComplete="username" /></Field>
          <Field label="Contact number" error={errors.phone}><input {...bind('phone')} type="tel" autoComplete="tel" /></Field>
        </div>
        <Field label="Email" error={errors.email}><input {...bind('email')} type="email" autoComplete="email" /></Field>
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
