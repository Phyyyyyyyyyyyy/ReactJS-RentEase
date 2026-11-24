import { useRef } from 'react';
import { useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { LeaseManager } from '../../components/lease';
import { balanceTone, MonthsTable, PaymentStatus, ReceiptLink } from '../../components/payments';
import { Avatar, BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { PAYMENT_METHODS } from '../../lib/constants';
import { formatDate, peso, plural, positive } from '../../lib/format';
import { useFlash } from '../../context/FlashContext';

export default function OwnerTenancy() {
  usePageTitle('Rent Payments', 'Tenant rent');
  const { id } = useParams();
  const { data, error, reload } = useApi(`/owner/payments/tenancy/${id}/`);
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  // When the balance changes (a payment was recorded or reviewed) the view remounts,
  // so the record form starts over at the new suggested amount.
  const { ledger } = data;
  return <TenancyView key={`${ledger.balance}-${ledger.total_paid}`} data={data} reload={reload} />;
}

function TenancyView({ data, reload }) {
  const { ledger, history } = data;
  const t = ledger.tenancy;
  const { notify } = useFlash();
  const { run, busyKey } = useAction();
  const amountRef = useRef(null);
  const recordRef = useRef(null);
  const form = useForm({ amount: ledger.suggested_amount, method: 'cash', paid_on: data.today, reference_number: '', note: '' });
  const { bind, errors } = form;

  const fillAmount = (amount) => {
    form.setValue('amount', amount);
    recordRef.current?.scrollIntoView({ behavior: 'smooth' });
    amountRef.current?.focus();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/owner/payments/tenancy/${t.id}/`, { method: 'POST', body: values });
      notify('success', result.message);
      reload();
    });
  };

  const review = (p, decision) => {
    const question = {
      confirm: 'Confirm you received this payment?',
      reject: 'Reject this payment?',
      void: `Void this ${peso(p.amount)} payment? Use this only to fix a mistake. It will stop counting toward the balance.`,
    }[decision];
    run(`${decision}-${p.id}`, `/owner/payments/${p.id}/${decision}/`, { confirm: question, onDone: reload });
  };

  return (
    <div className="grid gap-6">
      <BackLink to="/owner/payments">Rent payments</BackLink>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar user={t.tenant} />
        <div className="min-w-0">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">{t.unit.property.name} · {t.unit.name}</span>
          <h1 className="m-0 mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{t.tenant.full_name}</h1>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {peso(t.lease?.monthly_rent ?? t.unit.monthly_rent)}/month · renting since {formatDate(t.tenancy_start, 'M j, Y')}
            {t.tenant.phone && ` · ${t.tenant.phone}`}
            {!ledger.active && <> · <strong>tenancy ended</strong></>}
          </p>
        </div>
      </div>

      {t.lease && <LeaseManager lease={t.lease} unitName={t.unit.name} onChange={reload} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`rounded-xl ${balanceTone(ledger)} p-4`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Balance due</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{peso(ledger.balance)}</strong>
          <small className="text-xs text-slate-500">
            {positive(ledger.overdue) ? `${peso(ledger.overdue)} overdue` : positive(ledger.balance) ? 'due by month end' : 'paid up'}
          </small>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total received</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{peso(ledger.total_paid)}</strong>
          <small className="text-xs text-slate-500">of {peso(ledger.total_charged)} billed so far</small>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Advance credit</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{peso(ledger.credit)}</strong>
          <small className="text-xs text-slate-500">
            {ledger.months_covered ? `covers about ${ledger.months_covered} more month${plural(ledger.months_covered)}` : 'nothing paid ahead'}
          </small>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-3 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
          <h2 className="m-0 text-base font-bold text-slate-900">Monthly rent</h2>
          <p className="m-0 -mt-1 text-xs text-slate-500">
            Payments are applied to the oldest unpaid month first. “Mark paid” fills in the amount that settles everything up to that month.
          </p>
          <MonthsTable ledger={ledger} onMarkPaid={fillAmount} />
        </section>

        <section ref={recordRef} className="grid content-start gap-3 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900"><Icon name="cash" size={20} />Record a payment</h2>
          <p className="m-0 -mt-1 text-xs text-slate-500">
            For rent paid in person, upfront, or any way outside the app. It counts right away. Enter the full balance to mark it paid,
            or the amount the tenant actually gave. Anything over the balance is credited to future months.
          </p>
          <form className="form-stack" onSubmit={onSubmit} noValidate>
            <FormErrors errors={errors} />
            <div className="form-grid two">
              <Field label="Amount received (₱)" error={errors.amount}>
                <input {...bind('amount')} ref={amountRef} type="number" step="0.01" min="1" />
              </Field>
              <Field label="Method" error={errors.method}>
                <select {...bind('method')}>
                  {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
            </div>
            <div className="form-grid two">
              <Field label="Date received" error={errors.paid_on}><input {...bind('paid_on')} type="date" max={data.today} /></Field>
              <Field label="Reference / receipt no." optional error={errors.reference_number}>
                <input {...bind('reference_number')} maxLength={20} />
              </Field>
            </div>
            <Field label="Note" optional error={errors.note}>
              <input {...bind('note')} maxLength={255} placeholder="e.g. Paid 3 months upfront" />
            </Field>
            {positive(ledger.balance) && (
              <p className="m-0 text-xs text-slate-500">
                Balance is{' '}
                <button type="button" onClick={() => fillAmount(ledger.balance)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-brand underline">{peso(ledger.balance)}</button>.
                {' '}Tap to fill it in.
              </p>
            )}
            <div className="form-actions">
              <BusyButton className="primary-button" busy={form.busy} busyText="Recording…">Record payment</BusyButton>
            </div>
          </form>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <h2 className="m-0 text-base font-bold text-slate-900">Payment history</h2>
        {history.length ? (
          <ul className="m-0 mt-3 grid list-none gap-0 p-0">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-slate-900">{peso(p.amount)}</strong>
                    <span className="text-xs text-slate-500">{p.method_display}{p.reference_number && ` · Ref ${p.reference_number}`}</span>
                    <PaymentStatus payment={p} />
                  </div>
                  <p className="m-0 mt-0.5 text-xs text-slate-400">
                    {formatDate(p.paid_on, 'M j, Y')} · {p.recorded_by_owner ? 'recorded by you' : 'submitted by tenant'}
                    {p.note && ` · “${p.note}”`}
                    <ReceiptLink payment={p} />
                  </p>
                  {p.status === 'rejected' && p.owner_note && <p className="m-0 mt-1 text-xs text-slate-500">{p.owner_note}</p>}
                </div>
                {p.status === 'pending' && (
                  <div className="flex gap-2">
                    <BusyButton type="button" busy={busyKey === `confirm-${p.id}`} busyText="Confirming…" onClick={() => review(p, 'confirm')}
                      className="cursor-pointer rounded-lg border-0 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
                      Confirm
                    </BusyButton>
                    <BusyButton type="button" busy={busyKey === `reject-${p.id}`} busyText="Rejecting…" onClick={() => review(p, 'reject')}
                      className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100">
                      Reject
                    </BusyButton>
                  </div>
                )}
                {p.status === 'confirmed' && (
                  <BusyButton type="button" busy={busyKey === `void-${p.id}`} busyText="Voiding…" onClick={() => review(p, 'void')}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50">
                    Void
                  </BusyButton>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-2 text-sm text-slate-400">No payments yet.</p>
        )}
      </section>
    </div>
  );
}
