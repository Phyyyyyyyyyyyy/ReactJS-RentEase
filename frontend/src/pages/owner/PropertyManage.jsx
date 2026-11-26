import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BackLink, BusyButton, LoadError, PageSkeleton, PingDot, UnitTerms } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { peso, plural, unitSummary } from '../../lib/format';
import { PropertyHeader } from '../tenant/PropertyDetail';

export default function PropertyManage() {
  const { id } = useParams();
  const { data, error, reload } = useApi(`/owner/properties/${id}/`);
  usePageTitle('My Properties', data?.property.name || 'Property');
  const { busyKey, run } = useAction();

  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  const { property, units, can_edit: canEdit } = data;

  // Deleting is a DELETE request, so it goes through api() directly rather than run()'s POST.
  const remove = (unit) => {
    const extra = unit.pending_count ? ` Its ${unit.pending_count} pending application(s) will be removed too.` : '';
    run(`delete-${unit.id}`, null, {
      confirm: `Delete ${unit.name}?${extra}`,
      request: () => api(`/owner/units/${unit.id}/`, { method: 'DELETE' }),
      onDone: reload,
    });
  };

  return (
    <div className="grid gap-6">
      <BackLink to="/owner/properties">{canEdit ? 'All my properties' : 'Managed properties'}</BackLink>
      <PropertyHeader property={property} aside={canEdit && (
        <Link to={`/owner/properties/${property.id}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 no-underline hover:bg-slate-50">
          <Icon name="edit" size={16} />Edit property
        </Link>
      )} />

      {canEdit && <ManagerPanel property={property} onChange={reload} />}

      <section className="rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Units</span>
            <h2 className="m-0 mt-1 text-lg font-bold text-slate-900">{units.length} unit{plural(units.length)}</h2>
            <p className="m-0 mt-1 text-xs text-slate-500">Tenants can apply only for units marked Vacant.</p>
          </div>
          {canEdit && <Link to={`/owner/properties/${property.id}/units/new`} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline shadow-md shadow-blue-600/20 hover:bg-brand-dark">+ Add unit</Link>}
        </div>
        <div className="grid gap-3 p-5">
          {units.map((unit) => (
            <div key={unit.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 p-4">
              <div className="min-w-40 flex-1">
                <strong className="block text-sm text-slate-900">{unit.name}</strong>
                <span className="block text-xs text-slate-500">{unitSummary(unit)}</span>
                    <UnitTerms unit={unit} />
              </div>
              <strong className="text-sm text-slate-900">{peso(unit.monthly_rent)}<span className="text-[11px] font-normal text-slate-400">{unit.listing_type === 'rent_to_own' ? '/mo payment' : '/mo'}</span></strong>
              {unit.is_vacant
                ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">Vacant</span>
                : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">Occupied</span>}
              {unit.pending_count > 0 && (
                <Link to="/owner/applications" className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 no-underline hover:bg-sky-100">
                  <PingDot label="Applications awaiting your review" />{unit.pending_count} pending
                </Link>
              )}
              <Link to={`/owner/units/${unit.id}/logs`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 no-underline hover:bg-slate-50">
                <Icon name="file" size={14} />Payment log
              </Link>
              {canEdit && <div className="flex gap-2">
                <Link to={`/owner/properties/units/${unit.id}/edit`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 no-underline hover:bg-slate-50">Edit</Link>
                <BusyButton type="button" busy={busyKey === `delete-${unit.id}`} busyText="Deleting…" onClick={() => remove(unit)}
                  className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                  Delete
                </BusyButton>
              </div>}
            </div>
          ))}
          {units.length === 0 && (
            <div className="grid place-items-center py-10 text-center text-slate-400">
              <Icon name="building" size={32} />
              <p className="m-0 mt-2 text-sm">No units yet. Add one so tenants can find and apply for this property.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Owner only: choose the Property Manager who looks after this property. */
function ManagerPanel({ property, onChange }) {
  const { data } = useApi('/owner/managers/');
  const { notify } = useFlash();
  const [choice, setChoice] = useState(property.manager ? String(property.manager.id) : '');
  const [busy, setBusy] = useState(false);
  const current = property.manager ? String(property.manager.id) : '';

  const save = async () => {
    setBusy(true);
    try {
      const result = await api(`/owner/properties/${property.id}/manager/`, { method: 'PUT', body: { manager: choice } });
      notify('success', result.message);
      onChange();
    } catch (error) {
      notify('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="min-w-56 flex-1">
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Property manager</span>
        <p className="m-0 mt-1 text-xs text-slate-500">
          A manager reviews this property's applications and confirms its rent payments. You keep full control.
        </p>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-slate-600">
        Manager
        <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!data}>
          <option value="">No manager</option>
          {data?.managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.email})</option>)}
        </select>
      </label>
      <BusyButton type="button" className="primary-button cursor-pointer" busy={busy} busyText="Saving…"
        disabled={choice === current} onClick={save}>
        Save
      </BusyButton>
      {data && data.managers.length === 0 && (
        <p className="m-0 w-full text-xs text-slate-500">There are no Property Manager accounts yet. An admin can create one under Users &amp; Access.</p>
      )}
    </section>
  );
}
