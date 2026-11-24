import { Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import { PingDot } from './ui';

export function HeroPanel({ eyebrow, text, role, scope }) {
  const { user } = useAuth();
  return (
    <section className="hero-panel">
      <div>
        <span className="eyebrow light">{eyebrow}</span>
        <h1>Good day, {user.first_name || user.username}.</h1>
        <p>{text}</p>
      </div>
      <div className="hero-scope"><span>Signed in as</span><strong>{role}</strong><small>{scope}</small></div>
    </section>
  );
}

export function StatCard({ icon, label, value, note, ping }) {
  return (
    <div className="stat-card relative">
      {ping && <PingDot className="!absolute top-3 right-3" label={ping} />}
      <div className="stat-icon"><Icon name={icon} /></div>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </div>
  );
}

/** A row in a "Quick actions" panel. Without `to`/`href` it is shown as "Soon". */
export function QuickAction({ to, href, icon, title, text }) {
  const body = <><Icon name={icon} /><div><strong>{title}</strong><span>{text}</span></div></>;
  if (to) return <Link to={to}>{body}<Icon name="chevron" /></Link>;
  if (href) return <a href={href}>{body}<Icon name="chevron" /></a>;
  return <span className="quick-disabled">{body}<em>Soon</em></span>;
}

export function QuickActions({ eyebrow = 'Quick actions', title, children }) {
  return (
    <div className="panel">
      <div className="panel-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>
      <div className="quick-actions">{children}</div>
    </div>
  );
}

export function AccountPanel() {
  const { user } = useAuth();
  return (
    <div className="rounded-2xl border border-line bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">Your account</span>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">Account summary</h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 px-6 py-5 text-sm sm:grid-cols-[140px_1fr] sm:gap-y-3">
        <dt className="text-slate-400">Name</dt>
        <dd className="mb-2 font-semibold text-slate-800 sm:mb-0">{[user.first_name, user.last_name].filter(Boolean).join(' ') || '—'}</dd>
        <dt className="text-slate-400">Email</dt>
        <dd className="mb-2 break-words font-semibold text-slate-800 sm:mb-0">{user.email}</dd>
        <dt className="text-slate-400">Contact number</dt>
        <dd className="mb-2 font-semibold text-slate-800 sm:mb-0">{user.phone || '—'}</dd>
        <dt className="text-slate-400">Role</dt>
        <dd className="font-semibold text-slate-800">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-brand-dark">{user.role_display}</span>
        </dd>
      </dl>
      <div className="border-t border-slate-100 px-6 py-4">
        <Link to="/profile/edit" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white no-underline shadow-md shadow-blue-600/20 transition hover:-translate-y-px hover:bg-brand-dark">
          Edit profile
        </Link>
      </div>
    </div>
  );
}
