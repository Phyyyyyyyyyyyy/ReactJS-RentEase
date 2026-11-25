import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { ROLES } from '../../lib/constants';

const EMPTY = {
  first_name: '', last_name: '', username: '', email: '', phone: '', role: 'manager', password1: '', password2: '',
};

/** /admin/users/new and /admin/users/:id/edit */
export default function UserFormPage() {
  const { id } = useParams();
  if (!id) return <UserForm />;
  return <EditUser id={id} />;
}

function EditUser({ id }) {
  const { data, error } = useApi(`/admin/users/${id}/`);
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return <UserForm account={data.user} />;
}

function UserForm({ account }) {
  usePageTitle('Users & Access', account ? `Edit ${account.username}` : 'Add account');
  const { user: me, setUser } = useAuth();
  const { flash } = useFlash();
  const navigate = useNavigate();
  const self = account?.id === me.id;
  const form = useForm(account
    ? { first_name: account.first_name, last_name: account.last_name, email: account.email, phone: account.phone,
      role: account.role, is_active: account.is_active, password1: '', password2: '' }
    : EMPTY);
  const { bind, errors, values, setValue } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (body) => {
      const data = account
        ? await api(`/admin/users/${account.id}/`, { method: 'PUT', body })
        : await api('/admin/users/', { method: 'POST', body });
      if (self) setUser(data.user);
      flash('success', data.message);
      navigate('/admin/users');
    });
  };

  return (
    <div className="page-stack narrow-page">
      <BackLink to="/admin/users">Users & Access</BackLink>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Users & Access</span>
          <h1>{account ? `Edit ${account.full_name}` : 'Add an account'}</h1>
          <p>{account ? `@${account.username}` : 'Create an account with any role, including Admin and Property Manager.'}</p>
        </div>
      </div>
      <section className="panel">
        <form className="form-stack p-6" onSubmit={onSubmit} noValidate>
          <FormErrors errors={errors} />
          <div className="form-grid two">
            <Field label="First name" error={errors.first_name}><input {...bind('first_name')} maxLength={150} /></Field>
            <Field label="Last name" error={errors.last_name}><input {...bind('last_name')} maxLength={150} /></Field>
          </div>
          {!account && (
            <Field label="Username" error={errors.username}><input {...bind('username')} maxLength={150} autoComplete="off" /></Field>
          )}
          <div className="form-grid two">
            <Field label="Email" error={errors.email}><input {...bind('email')} type="email" /></Field>
            <Field label="Contact number" optional={Boolean(account)} error={errors.phone}><input {...bind('phone')} type="tel" maxLength={20} /></Field>
          </div>
          <Field label="Role" error={errors.role}
            help={self ? 'You can’t remove your own Admin role.' : 'Admins manage accounts; Property Managers run the properties owners assign to them.'}>
            <select {...bind('role')} disabled={self}>
              {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {account && (
            <Field label="Account status" error={errors.is_active}>
              <span className="inline-flex items-center gap-2 text-sm font-normal text-slate-700">
                <input type="checkbox" className="!w-auto" checked={Boolean(values.is_active)} disabled={self}
                  onChange={(e) => setValue('is_active', e.target.checked)} />
                Active: can sign in. Deactivating signs the person out.
              </span>
            </Field>
          )}
          <fieldset className="m-0 grid gap-4 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-bold text-slate-800">{account ? 'Set a new password' : 'Password'}</legend>
            {account && <p className="m-0 -mt-2 text-xs text-slate-500">Leave both empty to keep the current password.</p>}
            <div className="form-grid two">
              <Field label="Password" optional={Boolean(account)} error={errors.password1}>
                <input {...bind('password1')} type="password" autoComplete="new-password" />
              </Field>
              <Field label="Confirm password" optional={Boolean(account)} error={errors.password2}>
                <input {...bind('password2')} type="password" autoComplete="new-password" />
              </Field>
            </div>
          </fieldset>
          <div className="form-actions">
            <Link className="secondary-button" to="/admin/users">Cancel</Link>
            <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">{account ? 'Save changes' : 'Create account'}</BusyButton>
          </div>
        </form>
      </section>
    </div>
  );
}
