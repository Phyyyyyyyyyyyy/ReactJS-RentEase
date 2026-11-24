import { Link } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { CARD_GRADIENTS, EmptyState, LoadError, PageHeader, PageSkeleton, PingDot } from '../../components/ui';
import { useApi } from '../../hooks/useApi';

export default function PropertyList() {
  usePageTitle('My Properties', 'My properties');
  const { data, error } = useApi('/owner/properties/');

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Property owner" title="My properties"
        text="Add your rentals and their units. Properties with a vacant unit appear in tenants' search.">
        <Link to="/owner/properties/new" className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline shadow-md shadow-blue-600/20 hover:bg-brand-dark">
          <Icon name="building" size={16} />Add property
        </Link>
      </PageHeader>

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (data.properties.length ? (
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.properties.map((p, i) => (
            <article key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
              <div className={`relative flex h-28 items-end justify-between p-4 text-white ${CARD_GRADIENTS[i % 3]}`}>
                <span className="absolute left-4 top-4 rounded-full border border-white/25 bg-black/20 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">{p.type_display}</span>
                {p.pending_count > 0 && (
                  <Link to="/owner/applications" className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-sky-700 no-underline">
                    <PingDot label="Applications awaiting your review" />{p.pending_count} to review
                  </Link>
                )}
                <span className="text-4xl font-black opacity-60">{p.name.slice(0, 1)}</span>
                {p.vacant_count > 0 ? (
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700">{p.vacant_count} vacant</span>
                ) : p.unit_count > 0 && (
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">Fully occupied</span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div>
                  <h3 className="m-0 text-base font-bold text-slate-900">{p.name}</h3>
                  <p className="m-0 mt-1 text-xs text-slate-500">{p.address}, {p.city}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 py-2"><strong className="block text-base text-slate-900">{p.unit_count}</strong><span className="text-[11px] text-slate-500">Units</span></div>
                  <div className="rounded-lg bg-emerald-50 py-2"><strong className="block text-base text-emerald-700">{p.vacant_count}</strong><span className="text-[11px] text-emerald-700/80">Vacant</span></div>
                  <div className="rounded-lg bg-amber-50 py-2"><strong className="block text-base text-amber-700">{p.pending_count}</strong><span className="text-[11px] text-amber-700/80">Pending</span></div>
                </div>
                {p.unit_count === 0 && (
                  <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">No units yet, so tenants can't find this property. Add a unit to list it.</p>
                )}
                <div className="mt-auto flex gap-2 border-t border-slate-100 pt-4">
                  <Link to={`/owner/properties/${p.id}`} className="flex-1 rounded-xl bg-brand px-4 py-2 text-center text-xs font-bold text-white no-underline shadow-md shadow-blue-600/20 hover:bg-brand-dark">Manage units</Link>
                  <Link to={`/owner/properties/${p.id}/edit`} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 no-underline hover:bg-slate-50">Edit</Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState icon="building" title="You haven't listed a property yet"
          text="Add your first property, then its units, and tenants can start applying.">
          <Link to="/owner/properties/new" className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-brand-dark">Add your first property</Link>
        </EmptyState>
      ))}
    </div>
  );
}
