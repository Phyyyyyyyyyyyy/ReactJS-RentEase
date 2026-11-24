import { Link, useSearchParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { ApplicationBadge, BusyButton, EmptyState, LoadError, PageHeader, PageSkeleton, StatusTabs } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { formatDate, peso } from '../../lib/format';

export default function MyApplications() {
  usePageTitle('My Applications', 'My applications');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const { data, error, reload } = useApi(`/applications/${status ? `?status=${status}` : ''}`);
  const { run, busyKey } = useAction();

  const withdraw = (app) => run(`withdraw-${app.id}`, `/applications/${app.id}/withdraw/`, {
    confirm: 'Withdraw this application?', onDone: reload,
  });

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Rental applications" title="My applications" text="Track the status of every unit you've applied for.">
        <Link to="/browse" className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline shadow-md shadow-blue-600/20 hover:bg-brand-dark">
          <Icon name="search" size={16} />Find more rentals
        </Link>
      </PageHeader>

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          <StatusTabs tabs={data.status_tabs} current={data.status} pingLabel="Applications awaiting review"
            onChange={(value) => setParams(value ? { status: value } : {})} />
          <section className="grid gap-3">
            {data.applications.map((app) => (
              <article key={app.id} className="grid gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm sm:grid-cols-[48px_1fr_auto] sm:items-center">
                <div className="hidden h-12 w-12 place-items-center rounded-xl bg-blue-50 text-brand sm:grid"><Icon name="building" size={22} /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-slate-900">{app.unit.property.name} · {app.unit.name}</strong>
                    <ApplicationBadge status={app.status} />
                  </div>
                  <p className="m-0 mt-1 text-xs text-slate-500">{app.unit.property.address}, {app.unit.property.city}</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                    <span>Rent: <strong className="text-slate-700">{peso(app.unit.monthly_rent)}/mo</strong></span>
                    <span>Applied: <strong className="text-slate-700">{formatDate(app.created_at, 'M j, Y')}</strong></span>
                    {app.preferred_move_in && <span>Move-in: <strong className="text-slate-700">{formatDate(app.preferred_move_in, 'M j, Y')}</strong></span>}
                  </div>
                  {app.message && <p className="m-0 mt-2 line-clamp-2 text-xs italic text-slate-500">“{app.message}”</p>}
                </div>
                <div className="flex gap-2 sm:flex-col sm:items-end">
                  <Link to={`/browse/${app.unit.property.id}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 no-underline hover:bg-slate-50">View property</Link>
                  {app.can_withdraw && (
                    <>
                      <Link to={`/applications/${app.id}/edit`} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-brand no-underline hover:bg-blue-100">Edit</Link>
                      <BusyButton type="button" busy={busyKey === `withdraw-${app.id}`} busyText="Withdrawing…" onClick={() => withdraw(app)}
                        className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                        Withdraw
                      </BusyButton>
                    </>
                  )}
                </div>
              </article>
            ))}
            {data.applications.length === 0 && (
              <EmptyState as="div" icon="file" title={data.status ? `No ${data.status} applications` : 'No applications yet'}
                text="Browse available properties and apply for a vacant unit.">
                <Link to="/browse" className="mt-4 text-sm font-bold text-brand no-underline">Browse properties →</Link>
              </EmptyState>
            )}
          </section>
        </>
      )}
    </div>
  );
}
