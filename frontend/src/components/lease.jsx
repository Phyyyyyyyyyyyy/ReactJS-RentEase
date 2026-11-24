import { useState } from 'react';
import { useFlash } from '../context/FlashContext';
import { useForm } from '../hooks/useForm';
import { api } from '../lib/api';
import { formatDate, peso, positive } from '../lib/format';
import Icon from './Icon';
import { BusyButton, Field } from './ui';

const STATE_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-amber-50 text-amber-700',
  terminated: 'bg-slate-100 text-slate-600',
};

export function LeaseBadge({ lease }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATE_STYLE[lease.status]}`}>{lease.status_display}</span>;
}

/** One line about the lease, for the tenant. */
export function LeaseSummary({ lease }) {
  if (!lease) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <Icon name="file" size={14} />
      Lease {formatDate(lease.start_date, 'M j, Y')} – {formatDate(lease.end_date, 'M j, Y')}
      <LeaseBadge lease={lease} />
      {positive(lease.deposit) && <span>· Deposit {peso(lease.deposit)}</span>}
    </p>
  );
}

/** Owner / manager: lease details with renew, terminate, and deposit controls. */
export function LeaseManager({ lease, unitName, onChange }) {
  const { notify } = useFlash();
  const [open, setOpen] = useState(null); // 'renew' | 'deposit' | null
  const [terminating, setTerminating] = useState(false);
  const renew = useForm({ end_date: '', monthly_rent: '' });
  const deposit = useForm({ deposit: lease.deposit });

  const done = (message) => {
    notify('success', message);
    setOpen(null);
    onChange();
  };

  const submitRenew = (e) => {
    e.preventDefault();
    renew.submit(async (values) => {
      const body = { end_date: values.end_date, ...(values.monthly_rent ? { monthly_rent: values.monthly_rent } : {}) };
      done((await api(`/owner/leases/${lease.id}/renew/`, { method: 'POST', body })).message);
    });
  };

  const submitDeposit = (e) => {
    e.preventDefault();
    deposit.submit(async (values) => done((await api(`/owner/leases/${lease.id}/`, { method: 'PUT', body: values })).message));
  };

  const terminate = async () => {
    if (!window.confirm(`Terminate the lease for ${unitName} today? Rent stops after this month and the unit becomes vacant.`)) return;
    setTerminating(true);
    try {
      done((await api(`/owner/leases/${lease.id}/terminate/`, { method: 'POST' })).message);
    } catch (error) {
      notify('error', error.message);
    } finally {
      setTerminating(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Lease</span>
          <LeaseBadge lease={lease} />
        </div>
        <Fact label="Term" value={`${formatDate(lease.start_date, 'M j, Y')} – ${formatDate(lease.end_date, 'M j, Y')}`} />
        <Fact label="Monthly rent" value={peso(lease.monthly_rent)} />
        <Fact label="Deposit" value={peso(lease.deposit)} />
        <div className="ml-auto flex flex-wrap gap-2">
          {lease.can_renew && <button type="button" className="secondary-button compact cursor-pointer" onClick={() => setOpen(open === 'renew' ? null : 'renew')}>Renew</button>}
          <button type="button" className="secondary-button compact cursor-pointer" onClick={() => setOpen(open === 'deposit' ? null : 'deposit')}>Deposit</button>
          {lease.can_terminate && (
            <BusyButton type="button" busy={terminating} busyText="Terminating…" onClick={terminate}
              className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
              Terminate
            </BusyButton>
          )}
        </div>
      </div>
      {lease.status === 'expired' && (
        <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This lease has ended, so rent is no longer billed. Renew it if the tenant is staying.</p>
      )}
      {open === 'renew' && (
        <form className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4" onSubmit={submitRenew} noValidate>
          <Field label="New end date" error={renew.errors.end_date}>
            <input {...renew.bind('end_date')} type="date" min={lease.end_date} />
          </Field>
          <Field label="New monthly rent (₱)" optional help="Applies to months not billed yet." error={renew.errors.monthly_rent}>
            <input {...renew.bind('monthly_rent')} type="number" step="0.01" min="1" placeholder={lease.monthly_rent} />
          </Field>
          <BusyButton className="primary-button" busy={renew.busy} busyText="Renewing…">Renew lease</BusyButton>
        </form>
      )}
      {open === 'deposit' && (
        <form className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4" onSubmit={submitDeposit} noValidate>
          <Field label="Security deposit (₱)" help="Money held for the lease. It doesn't count as rent." error={deposit.errors.deposit}>
            <input {...deposit.bind('deposit')} type="number" step="0.01" min="0" />
          </Field>
          <BusyButton className="primary-button" busy={deposit.busy} busyText="Saving…">Save deposit</BusyButton>
        </form>
      )}
    </section>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <span className="block text-[11px] text-slate-400">{label}</span>
      <strong className="text-sm text-slate-800">{value}</strong>
    </div>
  );
}
