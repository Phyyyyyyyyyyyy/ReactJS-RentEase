import { Link } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { balanceTone, MonthsTable, PaymentStatus, ReceiptLink } from '../../components/payments';
import { BusyButton, EmptyState, LoadError, PageHeader, PageSkeleton } from '../../components/ui';
import { LeaseSummary } from '../../components/lease';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { formatDate, peso, plural, positive } from '../../lib/format';
import { MessageButton } from '../../components/chat';

export default function TenantPayments() {
  usePageTitle('Rent & Payments', 'Rent & payments');
  const { data, error, reload } = useApi('/payments/');
  const { run, busyKey } = useAction();

  const cancel = (p) => run(`cancel-${p.id}`, `/payments/submissions/${p.id}/cancel/`, {
    confirm: 'Cancel this GCash submission?', onDone: reload,
  });

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Monthly rent" title="Rent & payments"
        text="Rent is billed every month and due on the last day of the month. Pay your owner through GCash, or pay in person and they will record it." />

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          {data.ledgers.map((ledger) => <LedgerCard key={ledger.tenancy.id} ledger={ledger} />)}
          {data.ledgers.length === 0 && (
            <EmptyState icon="wallet" title="No rent to pay yet"
              text="Once an owner approves your application, your monthly rent and payment options appear here.">
              <Link to="/browse" className="mt-4 text-sm font-bold text-brand no-underline">Browse properties →</Link>
            </EmptyState>
          )}

          {data.history.length > 0 && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
              <h2 className="m-0 text-base font-bold text-slate-900">Payment history</h2>
              <ul className="m-0 mt-3 grid list-none gap-0 p-0">
                {data.history.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-slate-900">{peso(p.amount)}</strong>
                        <span className="text-xs text-slate-500">{p.method_display}{p.reference_number && ` · Ref ${p.reference_number}`}</span>
                        <PaymentStatus payment={p} />
                      </div>
                      <p className="m-0 mt-0.5 text-xs text-slate-400">
                        {formatDate(p.paid_on, 'M j, Y')} · {p.tenancy.unit.property.name} {p.tenancy.unit.name}
                        {p.recorded_by_owner && ' · recorded by owner'}{p.note && ` · “${p.note}”`}<ReceiptLink payment={p} />
                      </p>
                      {p.status === 'rejected' && p.owner_note && <p className="m-0 mt-1 text-xs font-semibold text-red-600">Owner: {p.owner_note}</p>}
                    </div>
                    {p.status === 'pending' && p.recorded_by_me && (
                      <BusyButton type="button" busy={busyKey === `cancel-${p.id}`} busyText="Cancelling…" onClick={() => cancel(p)}
                        className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        Cancel
                      </BusyButton>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function LedgerCard({ ledger }) {
  const t = ledger.tenancy;
  const owner = t.owner;
  const balance = positive(ledger.balance);
  const overdue = positive(ledger.overdue);

  return (
    <section className="grid gap-5 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-lg font-bold text-slate-900">{t.unit.property.name} · {t.unit.name}</h2>
            {!ledger.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Tenancy ended</span>}
          </div>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {peso(t.lease?.monthly_rent ?? t.unit.monthly_rent)}/month · Owner: {owner.full_name}{owner.phone && ` · ${owner.phone}`}
          </p>
          <div className="mt-1.5"><LeaseSummary lease={t.lease} /></div>
          <Link to={`/payments/statement/${t.id}`} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-brand no-underline hover:underline">
            <Icon name="receipt" size={14} />Statement of account
          </Link>
          <span className="ml-3"><MessageButton property={t.unit.property.id} label="Message owner" /></span>
        </div>
        {(balance || ledger.active) && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/payments/${t.id}/online`} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline shadow-md shadow-blue-600/20 transition hover:bg-brand-dark">
              <Icon name="phone" size={16} />Pay online
            </Link>
            {owner.accepts_gcash && (
              <Link to={`/payments/${t.id}/gcash`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 no-underline transition hover:bg-slate-50">
                Sent GCash already? Add the reference
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`rounded-xl ${balanceTone(ledger)} p-4`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Balance due</span>
          <strong className={`mt-1 block text-2xl font-bold ${overdue ? 'text-red-700' : balance ? 'text-amber-800' : 'text-emerald-700'}`}>{peso(ledger.balance)}</strong>
          <small className="text-xs text-slate-500">
            {overdue ? `${peso(ledger.overdue)} overdue` : balance ? `due ${formatDate(ledger.current?.due_date, 'F j')}` : "You're all paid up"}
          </small>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">This month</span>
          {ledger.current ? (
            <>
              <strong className="mt-1 block text-2xl font-bold text-slate-900">{ledger.current.label}</strong>
              <small className="text-xs text-slate-500">{formatDate(ledger.current.period, 'F')} rent · due {formatDate(ledger.current.due_date, 'M j')}</small>
            </>
          ) : ledger.active ? (
            <>
              <strong className="mt-1 block text-2xl font-bold text-slate-900">Not started</strong>
              <small className="text-xs text-slate-500">Rent starts {formatDate(t.tenancy_start, 'F j, Y')}</small>
            </>
          ) : (
            <><strong className="mt-1 block text-2xl font-bold text-slate-900">—</strong><small className="text-xs text-slate-500">No longer billed</small></>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          {ledger.pending_count > 0 ? (
            <>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Awaiting confirmation</span>
              <strong className="mt-1 block text-2xl font-bold text-amber-700">{peso(ledger.pending_total)}</strong>
              <small className="text-xs text-slate-500">{ledger.pending_count} GCash payment{plural(ledger.pending_count)} for the owner to check</small>
            </>
          ) : (
            <>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Advance credit</span>
              <strong className="mt-1 block text-2xl font-bold text-slate-900">{peso(ledger.credit)}</strong>
              <small className="text-xs text-slate-500">
                {ledger.months_covered ? `covers about ${ledger.months_covered} more month${plural(ledger.months_covered)}` : 'paid ahead of time'}
              </small>
            </>
          )}
        </div>
      </div>

      <MonthsTable ledger={ledger} />
    </section>
  );
}
