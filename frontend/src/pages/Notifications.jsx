import { useNavigate } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import Icon from '../components/Icon';
import { BusyButton, EmptyState, LoadError, PageHeader, PageSkeleton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAction } from '../hooks/useAction';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';

const TYPE_ICON = { application: 'file', payment: 'wallet', lease: 'key', reminder: 'clock' };

/** /notifications: application results, payments, lease changes, and rent reminders. */
export default function Notifications() {
  usePageTitle('Notifications');
  const { data, error, reload } = useApi('/notifications/');
  const { refreshBadges } = useAuth();
  const { run, busyKey } = useAction();
  const navigate = useNavigate();

  const open = async (n) => {
    if (!n.is_read) {
      await api(`/notifications/${n.id}/read/`, { method: 'POST' }).catch(() => {});
      refreshBadges();
    }
    if (n.link) navigate(n.link);
    else reload();
  };

  const readAll = () => run('read-all', '/notifications/read-all/', { onDone: () => { reload(); refreshBadges(); } });

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Inbox" title="Notifications" text="Updates about your applications, payments, leases, and rent.">
        {data?.unread > 0 && (
          <BusyButton type="button" className="secondary-button cursor-pointer" busy={busyKey === 'read-all'} busyText="Marking…" onClick={readAll}>
            Mark all as read
          </BusyButton>
        )}
      </PageHeader>
      {error && <LoadError error={error} />}
      {!data && !error && <PageSkeleton />}
      {data && (data.notifications.length ? (
        <section className="grid gap-2">
          {data.notifications.map((n) => (
            <button key={n.id} type="button" onClick={() => open(n)}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition hover:border-blue-300 ${n.is_read ? 'border-line bg-white' : 'border-blue-200 bg-blue-50/60'}`}>
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${n.is_read ? 'bg-slate-100 text-slate-500' : 'bg-white text-brand'}`}>
                <Icon name={TYPE_ICON[n.type] || 'bell'} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${n.is_read ? 'text-slate-600' : 'font-semibold text-slate-900'}`}>{n.message}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{formatDate(n.created_at, 'M j, Y g:i A')}</span>
              </span>
              {!n.is_read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
            </button>
          ))}
        </section>
      ) : (
        <EmptyState icon="bell" title="No notifications yet" text="You'll see updates about applications, payments, and rent here." />
      ))}
    </div>
  );
}
