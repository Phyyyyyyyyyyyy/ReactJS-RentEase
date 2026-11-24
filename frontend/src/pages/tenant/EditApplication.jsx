import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { RedirectWithMessage } from '../../components/guards';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { formatDate, peso, todayInManila } from '../../lib/format';

export default function EditApplication() {
  usePageTitle('My Applications', 'Edit application');
  const { id } = useParams();
  const { data, error } = useApi(`/applications/${id}/`);
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  if (!data.application.can_withdraw) {
    return <RedirectWithMessage to="/applications" text="Only pending applications can be edited." />;
  }
  return <EditForm application={data.application} />;
}

function EditForm({ application }) {
  const { flash } = useFlash();
  const navigate = useNavigate();
  const form = useForm({ preferred_move_in: application.preferred_move_in || '', message: application.message });
  const { errors } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const data = await api(`/applications/${application.id}/`, {
        method: 'PUT', body: { ...values, preferred_move_in: values.preferred_move_in || null },
      });
      flash('success', data.message);
      navigate('/applications');
    });
  };

  return (
    <div className="page-stack narrow-page">
      <BackLink to="/applications">Back to my applications</BackLink>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{application.unit.property.name} · {application.unit.name}</span>
          <h1>Edit application</h1>
          <p>Update your move-in date or message while the owner hasn't decided yet. To apply for a different unit, withdraw this one and apply again.</p>
        </div>
      </div>
      <section className="panel">
        <form className="form-stack p-6" onSubmit={onSubmit} noValidate>
          <FormErrors errors={errors} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>Rent: <strong className="text-slate-700">{peso(application.unit.monthly_rent)}/mo</strong></span>
            <span>Applied: <strong className="text-slate-700">{formatDate(application.created_at, 'M j, Y')}</strong></span>
          </div>
          <Field label="Preferred move in" optional error={errors.preferred_move_in}>
            <input {...form.bind('preferred_move_in')} type="date" min={todayInManila()} />
          </Field>
          <Field label="Message to the owner" optional error={errors.message}>
            <textarea {...form.bind('message')} rows={5} />
          </Field>
          <div className="form-actions">
            <Link className="secondary-button" to="/applications">Cancel</Link>
            <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">Save changes</BusyButton>
          </div>
        </form>
      </section>
    </div>
  );
}
