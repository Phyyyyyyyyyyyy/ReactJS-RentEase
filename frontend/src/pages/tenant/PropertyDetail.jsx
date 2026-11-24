import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { BackLink, BusyButton, Field, LoadError, PageSkeleton } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { peso, todayInManila, unitSummary } from '../../lib/format';

export function PropertyHeader({ property, aside }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-brand-dark">{property.type_display}</span>
          <h1 className="m-0 mt-3 text-2xl font-bold tracking-tight text-slate-900">{property.name}</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">{property.address}, {property.city}</p>
        </div>
        {aside}
      </div>
      {property.description && <p className="m-0 mt-5 text-sm leading-relaxed text-slate-600">{property.description}</p>}
      {property.amenity_list.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {property.amenity_list.map((a) => <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{a}</span>)}
        </div>
      )}
    </section>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();
  const { data, error } = useApi(`/browse/${id}/`);
  usePageTitle('Browse Properties', data?.property.name || 'Property');
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return <PropertyDetailView data={data} />;
}

function PropertyDetailView({ data }) {
  const { property, owner, units, pending_unit_ids: pendingIds } = data;
  const { flash } = useFlash();
  const { refreshBadges } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ unit: '', preferred_move_in: '', message: '' });
  const { errors } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/browse/${property.id}/apply/`, {
        method: 'POST', body: { ...values, preferred_move_in: values.preferred_move_in || null },
      });
      flash('success', result.message);
      refreshBadges();
      navigate('/applications');
    });
  };

  return (
    <div className="grid gap-6">
      <BackLink to="/browse">Back to listings</BackLink>
      <PropertyHeader property={property} aside={(
        <div className="text-right">
          <span className="block text-[11px] uppercase tracking-wider text-slate-400">Listed by</span>
          <strong className="text-sm text-slate-800">{owner.full_name}</strong>
          {owner.phone && <span className="block text-xs text-slate-500">{owner.phone}</span>}
        </div>
      )} />

      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_380px]" noValidate>
        <section className="rounded-2xl border border-line bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Step 1</span>
            <h2 className="m-0 mt-1 text-lg font-bold text-slate-900">Choose a unit</h2>
            <p className="m-0 mt-1 text-xs text-slate-500">Occupied units can't be selected.</p>
          </div>
          <div className="grid gap-3 p-5">
            {units.map((unit) => {
              const applied = pendingIds.includes(unit.id);
              const checked = String(form.values.unit) === String(unit.id);
              const state = !unit.is_vacant
                ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                : checked ? 'border-brand bg-blue-50/60 ring-2 ring-brand/20' : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30';
              return (
                <label key={unit.id} className={`!flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition ${state}`}>
                  <input type="radio" name="unit" value={unit.id} className="!w-auto accent-brand"
                    disabled={!unit.is_vacant || applied} checked={checked}
                    onChange={() => form.setValue('unit', unit.id)} />
                  <div className="flex-1">
                    <strong className="block text-sm text-slate-900">{unit.name}</strong>
                    <span className="block text-xs font-normal text-slate-500">{unitSummary(unit)}</span>
                  </div>
                  <div className="text-right">
                    <strong className="block text-sm text-slate-900">{peso(unit.monthly_rent)}<span className="text-[11px] font-normal text-slate-400">/mo</span></strong>
                    {applied ? <span className="text-[11px] font-bold text-amber-600">You applied</span>
                      : unit.is_vacant ? <span className="text-[11px] font-bold text-emerald-600">Vacant</span>
                        : <span className="text-[11px] font-bold text-slate-400">Occupied</span>}
                  </div>
                </label>
              );
            })}
            {units.length === 0 && <p className="m-0 py-8 text-center text-sm text-slate-400">This property has no units listed yet.</p>}
            {errors.unit?.map((m) => <p key={m} className="m-0 text-xs font-medium text-red-600">{m}</p>)}
          </div>
        </section>

        <section className="h-fit rounded-2xl border border-line bg-white shadow-sm lg:sticky lg:top-24">
          <div className="border-b border-slate-100 px-6 py-5">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Step 2</span>
            <h2 className="m-0 mt-1 text-lg font-bold text-slate-900">Send your application</h2>
          </div>
          <div className="grid gap-4 p-6">
            {errors.non_field_errors?.map((m) => (
              <div key={m} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{m}</div>
            ))}
            <Field label="Preferred move in" optional error={errors.preferred_move_in}>
              <input {...form.bind('preferred_move_in')} type="date" min={todayInManila()} />
            </Field>
            <Field label="Message to the owner" optional error={errors.message}>
              <textarea {...form.bind('message')} rows={4} placeholder="Introduce yourself and mention when you can move in." />
            </Field>
            <BusyButton busy={form.busy} busyText="Submitting…" disabled={!data.can_apply}
              className="cursor-pointer rounded-xl border-0 bg-brand px-4 py-3 text-sm font-bold text-white shadow-md shadow-blue-600/20 transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
              Submit application
            </BusyButton>
            <p className="m-0 text-center text-[11px] text-slate-400">
              The owner will review your application. Track it under <Link to="/applications" className="font-semibold text-brand no-underline">My Applications</Link>.
            </p>
          </div>
        </section>
      </form>
    </div>
  );
}
