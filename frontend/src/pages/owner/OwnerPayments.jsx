import { useState } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { ReceiptLink } from '../../components/payments';
import { Avatar, BusyButton, LoadError, PageHeader, PageSkeleton, PingDot } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { formatDate, peso, positive } from '../../lib/format';

export default function OwnerPayments() {
  usePageTitle('Rent Payments', 'Rent payments');
  const { data, error, reload } = useApi('/owner/payments/');
  const { run, busyKey } = useAction();
  const [reasons, setReasons] = useState({});

  const confirmPayment = (p) => run(`confirm-${p.id}`, `/owner/payments/${p.id}/confirm/`, {
    confirm: `Confirm you received ${peso(p.amount)} with reference ${p.reference_number}?`, onDone: reload,
  });
  const reject = (p) => run(`reject-${p.id}`, `/owner/payments/${p.id}/reject/`, {
    confirm: 'Reject this payment? It will not count toward the balance.',
    body: { reason: reasons[p.id] || '' },
    onDone: reload,
  });

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Property owner" title="Rent payments"
        text="Confirm tenants' GCash payments, and record rent you receive in person or upfront.">
        {data && (
          <div className="rounded-xl bg-slate-50 px-4 py-2.5 text-right">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Outstanding</span>
            <strong className="text-xl font-bold text-slate-900">{peso(data.outstanding)}</strong>
          </div>
        )}
      </PageHeader>

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          {!data.gcash_ready && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <Icon name="phone" size={20} />
              <span className="flex-1"><strong>Add your GCash number</strong> so tenants can pay you through GCash. Until then they can only pay in person.</span>
              <Link to="/profile/edit#gcash" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white no-underline hover:bg-amber-700">Set up GCash</Link>
            </div>
          )}

          {data.pending.length > 0 && (
            <section className="grid gap-3">
              <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900">
                GCash payments to confirm <PingDot label="Payments awaiting confirmation" />
              </h2>
              <p className="m-0 -mt-1 text-xs text-slate-500">Check each reference number and amount in your GCash transaction history before you confirm it.</p>
              {data.pending.map((p) => (
                <article key={p.id} className="grid gap-4 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="flex min-w-0 gap-4">
                    <Avatar user={p.tenancy.tenant} />
                    <div className="min-w-0">
                      <p className="m-0 text-base font-bold text-slate-900">
                        {peso(p.amount)} <span className="text-sm font-semibold text-slate-500">from {p.tenancy.tenant.full_name}</span>
                      </p>
                      <p className="m-0 mt-0.5 text-sm text-slate-700">Ref <strong className="font-mono">{p.reference_number}</strong> · sent {formatDate(p.paid_on, 'M j, Y')}</p>
                      <p className="m-0 mt-0.5 text-xs text-slate-400">
                        {p.tenancy.unit.property.name} · {p.tenancy.unit.name} · submitted {formatDate(p.created_at, 'M j, g:i A')}
                        <ReceiptLink payment={p} />
                      </p>
                      {p.note && <p className="m-0 mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">“{p.note}”</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-2 lg:flex-col lg:items-stretch">
                    <BusyButton type="button" busy={busyKey === `confirm-${p.id}`} busyText="Confirming…" onClick={() => confirmPayment(p)}
                      className="w-full cursor-pointer rounded-lg border-0 bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">
                      Confirm received
                    </BusyButton>
                    <div className="flex gap-2">
                      <input maxLength={255} placeholder="Reason (optional)" value={reasons[p.id] || ''}
                        onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" />
                      <BusyButton type="button" busy={busyKey === `reject-${p.id}`} busyText="Rejecting…" onClick={() => reject(p)}
                        className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                        Reject
                      </BusyButton>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}

          <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <h2 className="m-0 text-base font-bold text-slate-900">Tenants</h2>
            {data.ledgers.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-3 font-bold">Tenant</th><th className="py-2 pr-3 font-bold">Unit</th>
                      <th className="py-2 pr-3 text-right font-bold">Rent</th><th className="py-2 pr-3 font-bold">This month</th>
                      <th className="py-2 pr-3 text-right font-bold">Balance</th><th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledgers.map((l) => <TenantRow key={l.tenancy.id} ledger={l} />)}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid place-items-center px-6 py-12 text-center text-slate-400">
                <Icon name="wallet" size={36} />
                <h3 className="m-0 mt-3 text-base font-bold text-slate-700">No tenants yet</h3>
                <p className="m-0 mt-1 text-sm">When you approve an application, that tenant's monthly rent shows up here.</p>
                <Link to="/owner/applications" className="mt-4 text-sm font-bold text-brand no-underline">Review applications →</Link>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TenantRow({ ledger: l }) {
  const t = l.tenancy;
  let thisMonth = '—';
  if (l.current) {
    thisMonth = l.current.state === 'paid' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Paid</span>
      : l.current.state === 'partial' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Partly paid</span>
        : <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-brand-dark">Due {formatDate(l.current.due_date, 'M j')}</span>;
  } else if (l.active) {
    thisMonth = <span className="text-xs">Starts {formatDate(t.tenancy_start, 'M j')}</span>;
  }

  return (
    <tr className={`border-b border-line last:border-0 ${l.active ? '' : 'text-slate-400'}`}>
      <td className="py-3 pr-3">
        <strong className={l.active ? 'text-slate-900' : ''}>{t.tenant.full_name}</strong>
        {!l.active && <span className="text-[11px]"> (ended)</span>}
      </td>
      <td className="py-3 pr-3">{t.unit.property.name} · {t.unit.name}</td>
      <td className="py-3 pr-3 text-right">{peso(t.unit.monthly_rent)}</td>
      <td className="py-3 pr-3">{thisMonth}</td>
      <td className="py-3 pr-3 text-right">
        {positive(l.balance) ? (
          <>
            <strong className={positive(l.overdue) ? 'text-red-700' : 'text-slate-900'}>{peso(l.balance)}</strong>
            {positive(l.overdue) && <><br /><span className="text-[11px] font-bold text-red-600">{peso(l.overdue)} overdue</span></>}
          </>
        ) : positive(l.credit) ? (
          <span className="text-xs font-bold text-emerald-700">{peso(l.credit)} credit</span>
        ) : (
          <span className="text-xs font-bold text-emerald-700">Paid up</span>
        )}
        {l.pending_count > 0 && <><br /><span className="text-[11px] font-bold text-amber-700">{peso(l.pending_total)} to confirm</span></>}
      </td>
      <td className="py-3 text-right">
        <Link to={`/owner/payments/tenancy/${t.id}`} className="whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white no-underline hover:bg-brand-dark">Record / view</Link>
      </td>
    </tr>
  );
}
