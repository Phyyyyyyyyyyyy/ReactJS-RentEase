import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { Avatar, EmptyState, LoadError, PageHeader, PageSkeleton, StatusTabs } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../lib/format';

/** /admin/users: every account, searchable and filtered by role. */
export default function UserList() {
  usePageTitle('Users & Access');
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || '';
  const q = params.get('q') || '';
  const [search, setSearch] = useState(q);
  const { data, error } = useApi(`/admin/users/?${new URLSearchParams({ q, role })}`);

  const update = (changes) => {
    const next = { q, role, ...changes };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Administrator" title="Users & Access"
        text="Create accounts, change roles, reset passwords, and deactivate accounts.">
        <div className="flex flex-wrap gap-2">
          <Link className="secondary-button" to="/admin/referral-codes">Referral codes</Link>
          <Link className="primary-button" to="/admin/users/new">Add account</Link>
        </div>
      </PageHeader>

      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users"
          placeholder="Search by name, username, or email" className="min-w-64 flex-1" />
        <button type="submit" className="secondary-button cursor-pointer">Search</button>
        {q && <button type="button" className="secondary-button cursor-pointer" onClick={() => { setSearch(''); update({ q: '' }); }}>Clear</button>}
      </form>

      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          <StatusTabs tabs={data.role_tabs} current={role} onChange={(value) => update({ role: value })} />
          {data.users.length === 0 ? (
            <EmptyState icon="users" title="No matching accounts" text={q ? `Nothing matches “${q}”.` : 'No accounts with this role yet.'} />
          ) : (
            <section className="panel">
              <div className="table-wrap">
                <table className="compact-table">
                  <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="table-user">
                            <Avatar user={u} className="avatar avatar-small" />
                            <div><strong>{u.full_name}</strong><span>@{u.username} · {u.email}</span></div>
                          </div>
                        </td>
                        <td><span className="badge badge-info">{u.role_display}</span></td>
                        <td>
                          {u.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}
                        </td>
                        <td>{formatDate(u.date_joined, 'M j, Y')}</td>
                        <td>{u.last_login ? formatDate(u.last_login, 'M j, Y g:i A') : 'Never'}</td>
                        <td><Link className="secondary-button compact" to={`/admin/users/${u.id}/edit`}>Edit</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
