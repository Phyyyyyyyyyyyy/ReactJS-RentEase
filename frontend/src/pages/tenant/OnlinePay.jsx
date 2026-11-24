import { useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BackLink, BusyButton, EmptyState, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { peso, positive } from '../../lib/format';

/** /payments/:id/online: choose how much to pay, then go to the GCash checkout. */
export default function OnlinePay() {
  usePageTitle('Rent & Payments', 'Pay online');
  const { id } = useParams();
  const { data, error } = useApi('/payments/');
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  const ledger = data.ledgers.find((l) => String(l.tenancy.id) === id);
  if (!ledger) return <EmptyState icon="wallet" title="Not found" text="That rental could not be found." />;
  return <PayForm ledger={ledger} />;
}

function PayForm({ ledger }) {
  const t = ledger.tenancy;
  const navigate = useNavigate();
  const form = useForm({ amount: ledger.suggested_amount });

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/payments/${t.id}/checkout/`, { method: 'POST', body: values });
      navigate(result.url);
    });
  };

  return (
    <div className="page-stack narrow-page">
      <BackLink to="/payments">Rent & payments</BackLink>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t.unit.property.name} · {t.unit.name}</span>
          <h1>Pay rent online</h1>
          <p>Pay with GCash. The payment counts toward your balance as soon as it goes through.</p>
        </div>
      </div>
      <section className="panel">
        <form className="form-stack p-6" onSubmit={onSubmit} noValidate>
          <FormErrors errors={form.errors} />
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            Balance due: <strong className="text-slate-900">{peso(ledger.balance)}</strong>
            {positive(ledger.overdue) && <> · <strong className="text-red-700">{peso(ledger.overdue)} overdue</strong></>}
            {!positive(ledger.balance) && ' · Paying now adds credit for next month.'}
          </div>
          <Field label="Amount (₱)" error={form.errors.amount}>
            <input {...form.bind('amount')} type="number" step="0.01" min="1" />
          </Field>
          <div className="form-actions">
            <BusyButton className="primary-button inline-flex items-center gap-2" busy={form.busy} busyText="Starting…">
              <Icon name="phone" size={16} />Continue to GCash
            </BusyButton>
          </div>
        </form>
      </section>
    </div>
  );
}
