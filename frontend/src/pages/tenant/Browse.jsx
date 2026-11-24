import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { CARD_GRADIENTS, EmptyState, LoadError, PageSkeleton } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { PROPERTY_TYPES } from '../../lib/constants';
import { peso, plural } from '../../lib/format';

export default function Browse() {
  usePageTitle('Browse Properties', 'Browse properties');
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({
    q: params.get('q') || '', type: params.get('type') || '', max_rent: params.get('max_rent') || '',
  });
  const query = params.toString();
  const { data, error, loading } = useApi(`/browse/${query ? `?${query}` : ''}`);
  const filtered = query !== '';

  const onSubmit = (e) => {
    e.preventDefault();
    setParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')));
  };
  const clear = () => {
    setFilters({ q: '', type: '', max_rent: '' });
    setParams({});
  };
  const bind = (name) => ({ name, value: filters[name], onChange: (e) => setFilters((f) => ({ ...f, [name]: e.target.value })) });

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 rounded-2xl bg-gradient-to-br from-navy to-brand-dark p-6 text-white shadow-lg shadow-blue-900/10 sm:p-7">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-white/70">Find your next home</span>
          <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight">Browse available properties</h1>
          <p className="m-0 mt-1 text-sm text-white/75">Only properties with at least one vacant unit are shown.</p>
        </div>
        <form onSubmit={onSubmit} className="grid gap-2.5 md:grid-cols-[1fr_190px_170px_auto]">
          <input {...bind('q')} placeholder="Search by name, address, or city" aria-label="Search" />
          <select {...bind('type')} aria-label="Property type">
            <option value="">All types</option>
            {PROPERTY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input {...bind('max_rent')} type="number" min="0" placeholder="Max rent (₱)" aria-label="Maximum rent" />
          <div className="flex gap-2">
            <button type="submit" disabled={loading}
              className="flex-1 cursor-pointer rounded-xl border-0 bg-white px-5 py-2.5 text-sm font-bold text-brand-dark transition hover:bg-blue-50">
              {loading && data ? 'Searching…' : 'Search'}
            </button>
            {filtered && (
              <button type="button" onClick={clear}
                className="cursor-pointer rounded-xl border border-white/25 bg-transparent px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
                Clear
              </button>
            )}
          </div>
        </form>
        {data?.invalid_filter && <p className="m-0 text-xs text-red-300">Enter a valid maximum rent (a whole number).</p>}
      </section>

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          <div className="flex items-end justify-between">
            <p className="m-0 text-sm text-slate-500">
              <strong className="text-slate-800">{data.properties.length}</strong> propert{plural(data.properties.length, 'y', 'ies')} found
            </p>
          </div>
          {data.properties.length ? (
            <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {data.properties.map((p, i) => <PropertyCard key={p.id} property={p} gradient={CARD_GRADIENTS[i % 3]} />)}
            </section>
          ) : (
            <EmptyState icon="search" title="No properties match your search"
              text="Try a different keyword, property type, or a higher maximum rent.">
              {filtered && (
                <button type="button" onClick={clear} className="mt-4 cursor-pointer border-0 bg-transparent text-sm font-bold text-brand">
                  Clear filters
                </button>
              )}
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}

function PropertyCard({ property: p, gradient }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className={`relative flex h-36 items-end justify-between p-4 text-white ${gradient}`}>
        <span className="absolute left-4 top-4 rounded-full border border-white/25 bg-black/20 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">{p.type_display}</span>
        <span className="text-4xl font-black opacity-60">{p.name.slice(0, 1)}</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700">{p.vacant_count} vacant</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">{p.name}</h3>
          <p className="m-0 mt-1 text-xs text-slate-500">{p.address}, {p.city}</p>
        </div>
        <p className="m-0 line-clamp-2 text-xs leading-relaxed text-slate-500">{p.description || 'No description provided.'}</p>
        {p.amenity_list.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.amenity_list.map((a) => <span key={a} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{a}</span>)}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            <span className="block text-[11px] text-slate-400">Starts at</span>
            <strong className="text-lg text-slate-900">{peso(p.min_rent)}</strong><span className="text-xs text-slate-400"> /month</span>
          </div>
          <Link to={`/browse/${p.id}`} className="rounded-xl bg-brand px-4 py-2 text-xs font-bold text-white no-underline shadow-md shadow-blue-600/20 transition hover:bg-brand-dark">View units</Link>
        </div>
      </div>
    </article>
  );
}
