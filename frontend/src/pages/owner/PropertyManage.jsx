import { Link, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BackLink, BusyButton, LoadError, PageSkeleton, PingDot } from '../../components/ui';
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
  const { property, units } = data;

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
      <BackLink to="/owner/properties">All my properties</BackLink>
      <PropertyHeader property={property} aside={(
        <Link to={`/owner/properties/${property.id}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 no-underline hover:bg-slate-50">
          <Icon name="edit" size={16} />Edit property
        </Link>
      )} />

      <section className="rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Units</span>
            <h2 className="m-0 mt-1 text-lg font-bold text-slate-900">{units.length} unit{plural(units.length)}</h2>
            <p className="m-0 mt-1 text-xs text-slate-500">Tenants can apply only for units marked Vacant.</p>
          </div>
          <Link to={`/owner/properties/${property.id}/units/new`} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline shadow-md shadow-blue-600/20 hover:bg-brand-dark">+ Add unit</Link>
        </div>
        <div className="grid gap-3 p-5">
          {units.map((unit) => (
            <div key={unit.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 p-4">
              <div className="min-w-40 flex-1">
                <strong className="block text-sm text-slate-900">{unit.name}</strong>
                <span className="block text-xs text-slate-500">{unitSummary(unit)}</span>
              </div>
              <strong className="text-sm text-slate-900">{peso(unit.monthly_rent)}<span className="text-[11px] font-normal text-slate-400">/mo</span></strong>
              {unit.is_vacant
                ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">Vacant</span>
                : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">Occupied</span>}
              {unit.pending_count > 0 && (
                <Link to="/owner/applications" className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 no-underline hover:bg-sky-100">
                  <PingDot label="Applications awaiting your review" />{unit.pending_count} pending
                </Link>
              )}
              <div className="flex gap-2">
                <Link to={`/owner/properties/units/${unit.id}/edit`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 no-underline hover:bg-slate-50">Edit</Link>
                <BusyButton type="button" busy={busyKey === `delete-${unit.id}`} busyText="Deleting…" onClick={() => remove(unit)}
                  className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                  Delete
                </BusyButton>
              </div>
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
