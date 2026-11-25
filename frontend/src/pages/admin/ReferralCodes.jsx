import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BusyButton, EmptyState, Field, FormErrors, LoadError, PageHeader, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';

/** /admin/referral-codes: create and manage the codes people need to sign up. */
export default function ReferralCodes() {
  usePageTitle('Referral Codes');
  const { data, error, reload } = useApi('/admin/referral-codes/');

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Administrator" title="Referral codes"
        text="People need a referral code to create an account. Each code gives one role and works until you disable it." />
      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          <CreateCode roles={data.roles} onCreated={reload} />
          <CodeList codes={data.codes} onChange={reload} />
        </>
      )}
    </div>
  );
}

function CreateCode({ roles, onCreated }) {
  const { notify } = useFlash();
  const form = useForm({ role: 'tenant', label: '', code: '' });
  const { bind, errors } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api('/admin/referral-codes/', { method: 'POST', body: values });
      notify('success', result.message);
      form.setValues((v) => ({ ...v, label: '', code: '' }));
      onCreated();
    });
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="m-0 mb-4 flex items-center gap-2 text-base font-bold text-slate-900"><Icon name="key" size={20} />New referral code</h2>
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <FormErrors errors={errors} />
        <div className="form-grid two">
          <Field label="Account type it creates" error={errors.role}>
            <select {...bind('role')}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          </Field>
          <Field label="Label" optional help="A note for yourself, e.g. “Lahug building tenants”." error={errors.label}>
            <input {...bind('label')} maxLength={100} />
          </Field>
        </div>
        <Field label="Custom code" optional help="Leave empty to generate a random code. Letters, numbers, and dashes." error={errors.code}>
          <input {...bind('code')} maxLength={32} autoComplete="off" spellCheck={false} placeholder="e.g. LAHUG-2026" />
        </Field>
        <div className="form-actions">
          <BusyButton className="primary-button" busy={form.busy} busyText="Creating…">Create code</BusyButton>
        </div>
      </form>
    </section>
  );
}

function CodeList({ codes, onChange }) {
  const { notify } = useFlash();
  const { run, busyKey } = useAction();

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', `${what} copied.`);
    } catch {
      notify('error', `Couldn't copy. Select it and copy it yourself: ${text}`);
    }
  };
  const signUpLink = (code) => `${window.location.origin}/register?code=${encodeURIComponent(code)}`;
  const toggle = (c) => run(`toggle-${c.id}`, null, {
    confirm: c.is_active ? `Disable ${c.code}? Nobody can sign up with it until you enable it again.` : undefined,
    request: () => api(`/admin/referral-codes/${c.id}/`, { method: 'PUT', body: { is_active: !c.is_active } }),
    onDone: onChange,
  });
  const remove = (c) => run(`delete-${c.id}`, null, {
    confirm: `Delete ${c.code}?`,
    request: () => api(`/admin/referral-codes/${c.id}/`, { method: 'DELETE' }),
    onDone: onChange,
  });

  if (!codes.length) {
    return <EmptyState icon="key" title="No referral codes yet" text="Create one above, then share it (or its sign-up link) with the people you want to invite." />;
  }
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="compact-table">
          <thead><tr><th>Code</th><th>Creates</th><th>Label</th><th>Accounts</th><th>Status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id}>
                <td>
                  <code className="rounded bg-slate-100 px-2 py-1 text-sm font-bold tracking-wider text-slate-900">{c.code}</code>
                  <div className="mt-1.5 flex gap-2 text-xs">
                    <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand" onClick={() => copy(c.code, 'Code')}>Copy code</button>
                    <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand" onClick={() => copy(signUpLink(c.code), 'Sign-up link')}>Copy sign-up link</button>
                  </div>
                </td>
                <td><span className="badge badge-info">{c.role_display}</span></td>
                <td className="text-slate-500">{c.label || '—'}</td>
                <td><strong>{c.uses}</strong></td>
                <td>{c.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Disabled</span>}</td>
                <td className="text-xs text-slate-500">{formatDate(c.created_at, 'M j, Y')}{c.created_by && <><br />by {c.created_by}</>}</td>
                <td>
                  <div className="flex gap-2">
                    <BusyButton type="button" busy={busyKey === `toggle-${c.id}`} busyText="…" onClick={() => toggle(c)}
                      className="secondary-button compact cursor-pointer">{c.is_active ? 'Disable' : 'Enable'}</BusyButton>
                    {c.uses === 0 && (
                      <BusyButton type="button" busy={busyKey === `delete-${c.id}`} busyText="…" onClick={() => remove(c)}
                        className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">
                        Delete
                      </BusyButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
