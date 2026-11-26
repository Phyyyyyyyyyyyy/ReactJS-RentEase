import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BackLink, BusyButton, EmptyState, Field, FormErrors, LoadError, PageHeader, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { formatDate, peso } from '../../lib/format';

/** /owner/units/:id/logs: the unit's payment logs (one per buyer/contract), and starting a new one. */
export default function UnitLogs() {
  const { id } = useParams();
  const { data, error } = useApi(`/owner/units/${id}/logs/`);
  usePageTitle('My Properties', data ? `${data.unit.name} payment logs` : 'Payment logs');
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;

  return (
    <div className="grid gap-6">
      <BackLink to={`/owner/properties/${data.property.id}`}>Back to {data.property.name}</BackLink>
      <PageHeader eyebrow={`${data.property.name} · ${data.unit.name}`} title="Payment logs"
        text="Your own record of this unit's payments, like a spreadsheet. Use it for buyers or tenants who don't use RentEase, or for payments from before." />
      {data.logs.length > 0 ? (
        <section className="grid gap-3">
          {data.logs.map((log) => (
            <Link key={log.id} to={`/owner/logs/${log.id}`}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-white p-5 no-underline shadow-sm transition hover:border-blue-300">
              <div className="min-w-56 flex-1">
                <strong className="block text-base text-slate-900">{log.holder_name}</strong>
                <span className="text-xs text-slate-500">
                  {log.start_date ? `Since ${formatDate(log.start_date, 'M j, Y')} · ` : ''}{log.entries_count} payment{log.entries_count === 1 ? '' : 's'}
                  {log.last_entry_date && ` · last ${formatDate(log.last_entry_date, 'M j, Y')}`}
                </span>
              </div>
              <div className="text-right">
                <strong className="block text-lg text-slate-900">{peso(log.total_paid)}</strong>
                <span className="text-xs text-slate-500">
                  {log.remaining_balance !== null ? `${peso(log.remaining_balance)} left of ${peso(log.contract_price)}` : 'total paid'}
                </span>
              </div>
              <Icon name="chevron" />
            </Link>
          ))}
        </section>
      ) : (
        <EmptyState icon="file" title="No payment logs yet" text="Start one below, then add payments or import your spreadsheet." />
      )}
      <NewLog unitId={id} />
    </div>
  );
}

function NewLog({ unitId }) {
  const navigate = useNavigate();
  const { flash } = useFlash();
  const form = useForm({ holder_name: '', start_date: '', note: '' });
  const { bind, errors } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/owner/units/${unitId}/logs/`, { method: 'POST', body: values });
      flash('success', result.message);
      navigate(`/owner/logs/${result.id}`);
    });
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Start a payment log</h2>
      <p className="m-0 mb-4 text-xs text-slate-500">The contract price, term, interest rate, and monthly amount are copied from the unit. You can change them on the log.</p>
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <FormErrors errors={errors} />
        <Field label="Buyer / tenant name(s)" error={errors.holder_name}>
          <input {...bind('holder_name')} maxLength={200} placeholder="e.g. Mr. Artchille L. Alcuino & Cheryl L. Alcuino" />
        </Field>
        <div className="form-grid two">
          <Field label="Contract start date" optional error={errors.start_date}><input {...bind('start_date')} type="date" /></Field>
          <Field label="Note" optional error={errors.note}><input {...bind('note')} maxLength={500} /></Field>
        </div>
        <div className="form-actions"><BusyButton className="primary-button" busy={form.busy} busyText="Creating…">Create log</BusyButton></div>
      </form>
    </section>
  );
}
