import { useSearchParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { ApplicationBadge, Avatar, BusyButton, EmptyState, LoadError, PageHeader, PageSkeleton, StatusTabs } from '../../components/ui';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { formatDate, peso } from '../../lib/format';

export default function OwnerApplications() {
  usePageTitle('Applications');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'pending';
  const { data, error, reload } = useApi(`/owner/applications/?status=${status}`);
  const { run, busyKey } = useAction();

  const decide = (app, decision) => {
    const question = decision === 'approve'
      ? `Approve ${app.tenant.full_name} for ${app.unit.name}? The unit will be marked occupied and other pending applications for it will be rejected.`
      : 'Reject this application?';
    run(`${decision}-${app.id}`, `/owner/applications/${app.id}/${decision}/`, { confirm: question, onDone: reload });
  };

  const emptyTitle = data?.status === 'pending' ? 'No applications waiting for review'
    : data?.status === 'all' ? 'No applications yet' : `No ${data?.status} applications`;

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Property owner" title="Tenant applications"
        text="Review applications for your units. Approving one marks the unit occupied and rejects the other pending applications for it." />

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          <StatusTabs tabs={data.status_tabs} current={data.status} pingLabel="Applications awaiting your review"
            onChange={(value) => setParams({ status: value })} />
          <section className="grid gap-3">
            {data.applications.map((app) => (
              <article key={app.id} className="grid gap-4 rounded-2xl border border-line bg-white p-5 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="flex min-w-0 gap-4">
                  <Avatar user={app.tenant} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-base font-bold text-slate-900">{app.tenant.full_name}</h3>
                      <ApplicationBadge status={app.status} />
                    </div>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">{app.tenant.email}{app.tenant.phone && ` · ${app.tenant.phone}`}</p>
                    <p className="m-0 mt-2 text-sm text-slate-700">
                      <strong>{app.unit.property.name}</strong> · {app.unit.name} · {peso(app.unit.monthly_rent)}/mo
                    </p>
                    <p className="m-0 mt-0.5 text-xs text-slate-400">
                      Applied {formatDate(app.created_at, 'M j, Y')}
                      {app.preferred_move_in && ` · Move-in ${formatDate(app.preferred_move_in, 'M j, Y')}`}
                      {app.status === 'pending' && !app.unit.is_vacant && <> · <span className="font-semibold text-red-600">Unit is now occupied</span></>}
                    </p>
                    {app.message && <p className="m-0 mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">“{app.message}”</p>}
                  </div>
                </div>
                {app.status === 'pending' && (
                  <div className="flex gap-2 lg:flex-col">
                    <BusyButton type="button" busy={busyKey === `approve-${app.id}`} busyText="Approving…" onClick={() => decide(app, 'approve')}
                      disabled={!app.unit.is_vacant} title={app.unit.is_vacant ? undefined : 'Unit is occupied'}
                      className="w-full cursor-pointer rounded-lg border-0 bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      Approve
                    </BusyButton>
                    <BusyButton type="button" busy={busyKey === `reject-${app.id}`} busyText="Rejecting…" onClick={() => decide(app, 'reject')}
                      className="w-full cursor-pointer rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                      Reject
                    </BusyButton>
                  </div>
                )}
              </article>
            ))}
            {data.applications.length === 0 && (
              <EmptyState icon="file" title={emptyTitle} text="Tenants' applications for your vacant units will appear here." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
