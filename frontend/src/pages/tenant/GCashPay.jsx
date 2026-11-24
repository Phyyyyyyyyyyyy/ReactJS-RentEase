import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { RedirectWithMessage } from '../../components/guards';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api, toFormData } from '../../lib/api';
import { peso, positive } from '../../lib/format';

export default function GCashPay() {
  usePageTitle('Pay with GCash');
  const { id } = useParams();
  const { data, error } = useApi(`/payments/${id}/gcash/`);
  // e.g. the owner has no GCash number yet: back to Rent & payments with the reason.
  if (error?.status === 400) return <RedirectWithMessage to="/payments" text={error.message} />;
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return <GCashForm data={data} />;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button type="button" onClick={copy}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function GCashForm({ data }) {
  const { ledger, gcash } = data;
  const t = ledger.tenancy;
  const { flash } = useFlash();
  const { refreshBadges } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ amount: ledger.suggested_amount, paid_on: data.today, reference_number: '', proof: null, note: '' });
  const { bind, errors } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/payments/${t.id}/gcash/`, { method: 'POST', body: toFormData(values) });
      flash('success', result.message);
      refreshBadges();
      navigate('/payments');
    });
  };

  return (
    <div className="grid gap-6">
      <BackLink to="/payments">Rent &amp; payments</BackLink>
      <div>
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">{t.unit.property.name} · {t.unit.name}</span>
        <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-900">Pay rent with GCash</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">
          Send the money to your owner in the GCash app, then enter the reference number from your receipt. Your balance updates once the owner confirms it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="grid content-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">1</span>
            <h2 className="m-0 text-base font-bold text-slate-900">Send to your owner's GCash</h2>
          </div>
          <dl className="m-0 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">GCash number</dt>
              <dd className="m-0 mt-0.5 flex items-center gap-2">
                <strong className="font-mono text-xl tracking-wide text-slate-900">{gcash.number}</strong>
                <CopyButton text={gcash.number} />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Account name</dt>
              <dd className="m-0 mt-0.5 font-semibold text-slate-800">{gcash.name}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Amount due now</dt>
              <dd className="m-0 mt-0.5 font-semibold text-slate-800">
                {peso(ledger.balance)}
                {positive(ledger.overdue) && <span className="text-xs font-bold text-red-600"> ({peso(ledger.overdue)} overdue)</span>}
              </dd>
            </div>
          </dl>
          {gcash.qr && (
            <figure className="m-0 grid justify-items-center gap-2">
              <img src={gcash.qr} alt={`GCash QR code for ${gcash.name}`} className="w-full max-w-[240px] rounded-xl border border-line" />
              <figcaption className="text-xs text-slate-500">Or scan with GCash: Pay QR</figcaption>
            </figure>
          )}
          <p className="m-0 text-xs leading-relaxed text-slate-500">
            Check that the name GCash shows before you send matches <strong>{gcash.name}</strong>. You can pay more than the balance to pay ahead. The extra is credited to the next months.
          </p>
        </section>

        <section className="grid content-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">2</span>
            <h2 className="m-0 text-base font-bold text-slate-900">Enter your GCash receipt</h2>
          </div>
          <form className="form-stack" onSubmit={onSubmit} noValidate>
            <FormErrors errors={errors} />
            <div className="form-grid two">
              <Field label="Amount sent (₱)" error={errors.amount}><input {...bind('amount')} type="number" step="0.01" min="1" /></Field>
              <Field label="Date sent" error={errors.paid_on}><input {...bind('paid_on')} type="date" max={data.today} /></Field>
            </div>
            <Field label="GCash reference number" error={errors.reference_number}>
              <input {...bind('reference_number')} inputMode="numeric" autoComplete="off" placeholder="13 digits" maxLength={20} />
            </Field>
            <Field label="Receipt screenshot" optional error={errors.proof}>
              <input {...form.bindFile('proof')} accept="image/*" />
            </Field>
            <Field label="Note for the owner" optional error={errors.note}><input {...bind('note')} maxLength={255} /></Field>
            <div className="form-actions">
              <Link className="secondary-button" to="/payments">Cancel</Link>
              <BusyButton className="primary-button" busy={form.busy} busyText="Submitting…">Submit payment</BusyButton>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
