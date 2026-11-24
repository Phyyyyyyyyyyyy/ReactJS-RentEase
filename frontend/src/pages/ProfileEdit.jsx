import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import { BusyButton, Field, FormErrors } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useFlash } from '../context/FlashContext';
import { useForm } from '../hooks/useForm';
import { api, toFormData } from '../lib/api';
import { ProfileCard } from './Profile';

/** Current file plus "Clear" checkbox, like Django's ClearableFileInput. */
function FileField({ label, current, name, form, help, accept = 'image/*' }) {
  return (
    <Field label={label} optional help={help} error={form.errors[name]}>
      {current && (
        <span className="flex flex-wrap items-center gap-3 text-xs font-normal text-slate-500">
          <span>Currently: <a href={current} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">{current.split('/').pop()}</a></span>
          <span className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="!w-auto" checked={Boolean(form.values[`${name}-clear`])}
              onChange={(e) => form.setValue(`${name}-clear`, e.target.checked)} />
            Clear
          </span>
        </span>
      )}
      <input {...form.bindFile(name)} accept={accept} />
    </Field>
  );
}

export default function ProfileEdit() {
  usePageTitle('Edit Profile', 'Edit profile');
  const { user, setUser } = useAuth();
  const { flash } = useFlash();
  const navigate = useNavigate();
  const location = useLocation();
  const isOwner = user.role === 'owner';
  const form = useForm({
    first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone,
    ...(isOwner ? { gcash_number: user.gcash_number, gcash_name: user.gcash_name } : {}),
  });
  const { bind, errors } = form;

  // Links to /profile/edit#gcash scroll to the GCash section.
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const data = await api('/profile/', { method: 'POST', body: toFormData(values) });
      setUser(data.user);
      flash('success', data.message);
      navigate('/profile');
    });
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div><span className="eyebrow">User profile</span><h1>Edit profile</h1><p>Update your name, contact details, and photo.</p></div>
      </div>
      <div className="profile-layout">
        <ProfileCard user={user} />
        <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Profile information</span><h2>Edit account details</h2></div></div>
          <form className="form-stack" onSubmit={onSubmit} noValidate>
            <FormErrors errors={errors} />
            <div className="form-grid two">
              <Field label="First name" error={errors.first_name}><input {...bind('first_name')} /></Field>
              <Field label="Last name" error={errors.last_name}><input {...bind('last_name')} /></Field>
            </div>
            <Field label="Email" error={errors.email}><input {...bind('email')} type="email" /></Field>
            <Field label="Contact number" optional error={errors.phone}><input {...bind('phone')} type="tel" /></Field>
            <FileField label="Profile photo" name="profile_photo" current={user.photo} form={form} />
            {isOwner && (
              <fieldset id="gcash" className="m-0 grid gap-4 rounded-xl border border-line p-4">
                <legend className="px-1 text-sm font-bold text-slate-800">GCash for rent payments</legend>
                <p className="m-0 -mt-2 text-xs text-slate-500">
                  Tenants send rent to this number in the GCash app and submit the reference number. You confirm each payment before it counts.
                </p>
                <div className="form-grid two">
                  <Field label="GCash number" optional error={errors.gcash_number}>
                    <input {...bind('gcash_number')} inputMode="numeric" maxLength={15} placeholder="09171234567" />
                  </Field>
                  <Field label="GCash account name" optional error={errors.gcash_name}>
                    <input {...bind('gcash_name')} maxLength={100} />
                  </Field>
                </div>
                <FileField label="GCash QR code" name="gcash_qr" current={user.gcash_qr} form={form}
                  help="Your QR code from GCash (Receive, then QR). Tenants can scan it to pay you." />
              </fieldset>
            )}
            <div className="form-actions">
              <Link className="secondary-button" to="/profile">Cancel</Link>
              <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">Save changes</BusyButton>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
