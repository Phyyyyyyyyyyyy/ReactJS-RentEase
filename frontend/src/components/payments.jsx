import { Link } from 'react-router';
import { formatDate, peso, positive } from '../lib/format';

export function PaymentStatus({ payment }) {
  if (payment.status === 'pending') {
    return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Awaiting confirmation</span>;
  }
  if (payment.status === 'confirmed') {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Confirmed</span>;
  }
  return (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
      {payment.voided ? 'Voided' : 'Rejected'}
    </span>
  );
}

function MonthState({ line }) {
  if (line.state === 'paid') {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Paid</span>;
  }
  if (line.state === 'overdue') {
    return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Overdue · {peso(line.remaining)} left</span>;
  }
  if (line.state === 'partial') {
    return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Partly paid · {peso(line.remaining)} left</span>;
  }
  return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-brand-dark">Due {formatDate(line.due_date, 'M j')}</span>;
}

/** Month-by-month rent. With onMarkPaid (owner), each unpaid month gets a "Mark paid" button. */
export function MonthsTable({ ledger, onMarkPaid }) {
  const owner = Boolean(onMarkPaid);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <th className="py-2 pr-3 font-bold">Month</th>
            <th className="py-2 pr-3 font-bold">Due</th>
            <th className="py-2 pr-3 text-right font-bold">Rent</th>
            <th className="py-2 pr-3 text-right font-bold">Paid</th>
            <th className="py-2 pr-3 font-bold">Status</th>
            {owner && <th className="py-2" />}
          </tr>
        </thead>
        <tbody>
          {ledger.lines.map((line) => (
            <tr key={line.period} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-3 font-semibold text-slate-800">{formatDate(line.period, 'F Y')}</td>
              <td className="py-2.5 pr-3 text-slate-500">{formatDate(line.due_date, 'M j')}</td>
              <td className="py-2.5 pr-3 text-right text-slate-700">{peso(line.amount)}</td>
              <td className="py-2.5 pr-3 text-right text-slate-700">{peso(line.paid)}</td>
              <td className="py-2.5 pr-3"><MonthState line={line} /></td>
              {owner && (
                <td className="py-2.5 text-right">
                  {positive(line.remaining) && (
                    <button type="button" onClick={() => onMarkPaid(line.through_total)}
                      className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-xs font-bold text-brand hover:underline"
                      title={`Prefill the amount that settles everything up to ${formatDate(line.period, 'F')}`}>
                      Mark paid
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {ledger.lines.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-sm text-slate-400">
                Rent starts {formatDate(ledger.tenancy.tenancy_start, 'F j, Y')}. The first bill appears that month.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Colored background for a "Balance due" box. */
export function balanceTone(ledger) {
  if (positive(ledger.overdue)) return 'bg-red-50';
  if (positive(ledger.balance)) return 'bg-amber-50';
  return 'bg-emerald-50';
}

/** Links to the tenant's uploaded GCash screenshot and, once confirmed, the official receipt. */
export function ReceiptLink({ payment }) {
  return (
    <>
      {payment.proof && <> · <a href={payment.proof} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">Screenshot</a></>}
      {payment.status === 'confirmed' && <> · <Link to={`/payments/receipt/${payment.id}`} className="font-semibold text-brand">Receipt</Link></>}
    </>
  );
}

