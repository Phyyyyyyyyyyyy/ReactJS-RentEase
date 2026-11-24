import { Link } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import { AccountPanel, HeroPanel, QuickAction, QuickActions, StatCard } from '../components/dashboard';
import Icon from '../components/Icon';
import { Avatar, LoadError, PageSkeleton } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { formatDate, peso, plural, positive } from '../lib/format';

/** Loads /api/dashboard/ and renders `children(data)` once it arrives. */
function DashboardData({ children }) {
  const { data, error } = useApi('/dashboard/');
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return children(data);
}

export function AdminDashboard() {
  usePageTitle('Admin Dashboard', 'Admin dashboard');
  return (
    <DashboardData>{(d) => (
      <div className="page-stack">
        <HeroPanel eyebrow="Administrator portal" text="Manage user accounts, roles, and access across RentEase."
          role="Admin" scope="Full system access" />
        <section className="stats-grid">
          <StatCard icon="users" label="Registered users" value={d.total_users} note={`${d.active_users} active accounts`} />
          {d.role_counts.filter((r) => r.role !== 'admin').map((r) => (
            <StatCard key={r.role} icon="user" label={`${r.label}s`} value={r.count} note="accounts" />
          ))}
        </section>
        <section className="dashboard-grid">
          <div className="panel">
            <div className="panel-heading">
              <div><span className="eyebrow">Newest accounts</span><h2>Recent registrations</h2></div>
              <Link className="secondary-button compact" to="/admin/users">Manage users</Link>
            </div>
            <div className="table-wrap">
              <table className="compact-table">
                <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
                <tbody>
                  {d.recent_users.map((u) => (
                    <tr key={u.id}>
                      <td><div className="table-user"><Avatar user={u} className="avatar avatar-small" /><div><strong>{u.full_name}</strong><span>{u.email}</span></div></div></td>
                      <td><span className="badge badge-info">{u.role_display}</span></td>
                      <td>{u.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                      <td>{formatDate(u.date_joined, 'M j, Y')}</td>
                    </tr>
                  ))}
                  {d.recent_users.length === 0 && <tr><td colSpan={4} className="empty-inline">No users yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <QuickActions eyebrow="Quick actions" title="Administration">
            <QuickAction to="/admin/users/new" icon="users" title="Create an account" text="Add Admin or Staff users and assign roles." />
            <QuickAction to="/admin/users" icon="shield" title="Roles & access" text="Change roles or deactivate accounts." />
            <QuickAction to="/profile" icon="user" title="My profile" text="Keep your own account details current." />
          </QuickActions>
        </section>
      </div>
    )}</DashboardData>
  );
}

export function StaffDashboard() {
  usePageTitle('Staff Dashboard', 'Staff dashboard');
  return (
    <DashboardData>{(d) => (
      <div className="page-stack">
        <HeroPanel eyebrow="Staff portal" text="Support owners and tenants and keep property records accurate."
          role="Staff" scope="View-only property access" />
        <section className="stats-grid">
          <StatCard icon="users" label="Active tenants" value={d.tenant_count} note="registered tenants" />
          <StatCard icon="building" label="Active owners" value={d.owner_count} note="registered property owners" />
        </section>
        <section className="dashboard-grid">
          <QuickActions title="Today's work">
            <QuickAction icon="building" title="View property records" text="Review property and unit information. Coming soon." />
            <QuickAction icon="file" title="View applications" text="Monitor submitted rental applications. Coming soon." />
            <QuickAction to="/profile" icon="user" title="Update profile" text="Keep your staff contact details current." />
          </QuickActions>
          <AccountPanel />
        </section>
      </div>
    )}</DashboardData>
  );
}

export function OwnerDashboard() {
  usePageTitle('Owner Dashboard', 'Owner dashboard');
  return (
    <DashboardData>{(d) => (
      <div className="page-stack">
        <HeroPanel eyebrow="Property owner portal" text="List your properties, manage units, and review tenant applications."
          role="Property Owner" scope="Manage your own listings" />
        <section className="stats-grid">
          <StatCard icon="building" label="Properties" value={d.property_count} note="listed by you" />
          <StatCard icon="home" label="Units" value={d.unit_count} note="across all properties" />
          <StatCard icon="key" label="Vacant units" value={d.vacant_units} note="open for applications" />
          <StatCard icon="clock" label="To review" value={d.app_pending} note="pending applications"
            ping={d.app_pending > 0 && 'Applications awaiting your review'} />
        </section>
        <section className="dashboard-grid">
          <QuickActions title="Your workspace">
            <QuickAction to="/owner/properties" icon="building" title="Manage my properties" text="Add properties and units, update rent and availability." />
            <QuickAction to="/owner/applications" icon="file" title="Review applications"
              text={d.app_pending ? `${d.app_pending} application${plural(d.app_pending)} waiting for your decision.` : 'Approve or reject tenant applications.'} />
            <QuickAction to="/owner/payments" icon="wallet" title="Rent payments"
              text={d.payments_to_confirm ? `${d.payments_to_confirm} GCash payment${plural(d.payments_to_confirm)} to confirm.` : 'Confirm GCash payments and record rent paid in person.'} />
            <QuickAction to="/profile" icon="user" title="Update profile" text="Keep your contact information current for tenants." />
          </QuickActions>
          <div className="panel">
            <div className="panel-heading">
              <div><span className="eyebrow">Needs your review</span><h2>Recent applications</h2></div>
              {d.app_pending > 0 && <Link to="/owner/applications" className="text-xs font-bold text-brand no-underline">View all →</Link>}
            </div>
            <div className="grid gap-1 p-2.5">
              {d.recent_pending.map((app) => (
                <Link key={app.id} to="/owner/applications" className="flex items-center gap-3 rounded-lg p-3 no-underline hover:bg-slate-50">
                  <Avatar user={app.tenant} className="avatar avatar-small" />
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-slate-800">{app.tenant.full_name}</strong>
                    <span className="block truncate text-[11px] text-slate-500">{app.property_name} · {app.unit_name}</span>
                  </div>
                  <span className="text-[11px] text-slate-400">{formatDate(app.created_at, 'M j')}</span>
                </Link>
              ))}
              {d.recent_pending.length === 0 && <p className="m-0 px-3 py-8 text-center text-sm text-slate-400">No applications waiting for review.</p>}
            </div>
          </div>
        </section>
      </div>
    )}</DashboardData>
  );
}

function RentBanner({ rent: r }) {
  const tone = positive(r.overdue) ? 'border-red-200 bg-red-50' : positive(r.balance) ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
  let headline;
  if (positive(r.balance)) {
    headline = (
      <p className="m-0 mt-0.5 text-lg font-bold text-slate-900">
        {peso(r.balance)} {positive(r.overdue) ? <span className="text-red-700">overdue</span> : `due ${formatDate(r.current?.due_date, 'F j')}`}
      </p>
    );
  } else if (r.current) {
    headline = (
      <p className="m-0 mt-0.5 text-lg font-bold text-emerald-800">
        {formatDate(r.current.period, 'F')} rent is paid{positive(r.credit) && ` · ${peso(r.credit)} credit`}
      </p>
    );
  } else {
    headline = <p className="m-0 mt-0.5 text-lg font-bold text-slate-900">Rent starts {formatDate(r.tenancy_start, 'F j')}</p>;
  }
  return (
    <section className={`flex flex-wrap items-center gap-4 rounded-2xl border ${tone} p-5`}>
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand"><Icon name="wallet" size={22} /></div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500">Rent · {r.property_name} {r.unit_name}</span>
        {headline}
        {r.pending_count > 0 && <p className="m-0 text-xs font-semibold text-amber-700">{peso(r.pending_total)} GCash payment awaiting owner confirmation</p>}
      </div>
      <Link to="/payments" className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white no-underline shadow-md shadow-blue-600/20 hover:bg-brand-dark">
        {positive(r.balance) ? 'Pay rent' : 'View payments'}
      </Link>
    </section>
  );
}

export function TenantDashboard() {
  usePageTitle('Tenant Dashboard', 'Tenant dashboard');
  return (
    <DashboardData>{(d) => (
      <div className="page-stack">
        <HeroPanel eyebrow="Tenant portal" text="Find a rental, track your applications, and manage your account."
          role="Tenant" scope="Browse and apply for rentals" />
        {d.rent.map((r) => <RentBanner key={r.tenancy_id} rent={r} />)}
        <section className="stats-grid">
          <StatCard icon="home" label="Vacant units" value={d.vacant_units} note="available to apply for" />
          <StatCard icon="file" label="My applications" value={d.app_total} note="submitted so far" />
          <StatCard icon="clock" label="Pending" value={d.app_pending} note="awaiting owner review"
            ping={d.app_pending > 0 && 'Applications awaiting review'} />
          <StatCard icon="check" label="Approved" value={d.app_approved} note="applications approved" />
        </section>
        <section className="dashboard-grid">
          <QuickActions title="Find your next home">
            <QuickAction to="/browse" icon="search" title="Browse properties" text="Search vacant units by type and rent, then apply." />
            <QuickAction to="/applications" icon="file" title="Track my applications" text="See the status of your rental applications." />
            <QuickAction to="/payments" icon="wallet" title="Rent & payments" text="Pay your monthly rent with GCash and see your balance." />
            <QuickAction to="/profile" icon="user" title="Update profile" text="Owners use these details to contact you." />
          </QuickActions>
          <AccountPanel />
        </section>
      </div>
    )}</DashboardData>
  );
}
