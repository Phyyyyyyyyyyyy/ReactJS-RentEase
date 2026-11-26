import { useParams } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import Icon from '../components/Icon';
import { BackLink, LoadError, PageSkeleton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { formatDate, peso, positive } from '../lib/format';

/** /payments/statement/:id: statement of account for one tenancy, ready to print or download. */
export default function Statement() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error } = useApi(`/payments/${id}/statement/`);
  usePageTitle('Statement of Account');
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  const s = data.statement;
  const l = s.lease;
  const back = user.role === 'tenant' ? '/payments' : `/owner/payments/tenancy/${s.tenancy_id}`;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink to={back}>Back</BackLink>
        <div className="flex gap-2">
          <a className="secondary-button inline-flex items-center gap-2" href={`/api/payments/${s.tenancy_id}/statement/export/`} download>
            <Icon name="file" size={16} />Download CSV
          </a>
          <button type="button" className="primary-button inline-flex cursor-pointer items-center gap-2" onClick={() => window.print()}>
            <Icon name="receipt" size={16} />Print / save as PDF
          </button>
        </div>
      </div>

      <article className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <h1 className="m-0 text-center text-xl font-bold text-slate-900">Statement of Account</h1>
        <dl className="m-0 mt-6 grid gap-1.5 text-sm">
          <Info label="Date" value={`As of ${formatDate(s.as_of, 'F j, Y')}`} />
          <Info label="To" value={s.to.full_name} />
          <Info label="Re" value={`${s.unit}, ${s.property.name}, ${s.property.address}, ${s.property.city}`} />
          {l && s.is_rent_to_own && (
            <>
              <Info label="Term" value={`${l.term_years} yrs / Rent to Own`} />
              <Info label="Contract price" value={peso(l.contract_price)} />
              {l.interest_rate !== null && <Info label="Interest rate" value={`${Number(l.interest_rate)}% per annum`} />}
              {positive(l.reservation_fee) && <Info label="Reservation fee" value={peso(l.reservation_fee)} />}
            </>
          )}
          {l && <Info label="Payment terms" value={`${l.payment_terms} · ${peso(l.amount_per_payment)} per payment`} />}
          {l && <Info label="Lease" value={`${formatDate(l.start_date, 'M j, Y')} – ${formatDate(l.end_date, 'M j, Y')} (${l.status_display})`} />}
        </dl>

        <div className="table-wrap mt-6">
          <table className="compact-table">
            <thead><tr><th>Payments</th><th>Date</th><th>Amount</th><th>Mode of payment</th><th>Reference</th></tr></thead>
            <tbody>
              {s.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.description}{p.note && <span className="block text-xs text-slate-400">{p.note}</span>}</td>
                  <td>{formatDate(p.date, 'M j, Y')}</td>
                  <td><strong>{peso(p.amount)}</strong></td>
                  <td>{p.mode}</td>
                  <td className="text-slate-500">{p.reference_number || '—'}</td>
                </tr>
              ))}
              {s.payments.length === 0 && <tr><td colSpan={5} className="empty-inline">No confirmed payments yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <dl className="m-0 mt-6 grid gap-1.5 border-t border-slate-200 pt-4 text-sm">
          <Info label="Total paid" value={`${peso(s.totals.total_paid)} (${s.totals.payments} payment${s.totals.payments === 1 ? '' : 's'})`} strong />
          {s.is_rent_to_own && (
            <>
              {positive(s.totals.reservation_paid) && <Info label="Reservation paid" value={peso(s.totals.reservation_paid)} />}
              <Info label="Remaining balance" value={`${peso(s.totals.remaining_balance)} of ${peso(s.totals.contract_price)} (${s.totals.percent_paid}% paid)`} strong />
            </>
          )}
          <Info label="Due now" value={positive(s.totals.balance_due)
            ? `${peso(s.totals.balance_due)}${positive(s.totals.overdue) ? ` (${peso(s.totals.overdue)} overdue)` : ''}`
            : positive(s.totals.credit) ? `Paid up · ${peso(s.totals.credit)} advance credit` : 'Paid up'} />
        </dl>
      </article>
    </div>
  );
}

function Info({ label, value, strong }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3">
      <dt className="text-slate-500">{label}:</dt>
      <dd className={`m-0 ${strong ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{value}</dd>
    </div>
  );
}
