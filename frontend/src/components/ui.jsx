import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useFlash } from '../context/FlashContext';
import Icon from './Icon';

export function Avatar({ user, className = 'avatar' }) {
  if (user.photo) return <img className={`${className} avatar-photo`} src={user.photo} alt="" />;
  return <div className={className}>{user.initials}</div>;
}

/** Pinging "needs attention" dot. */
export function PingDot({ label, className = '' }) {
  return (
    <span className={`relative flex size-2.5 shrink-0 ${className}`} title={label}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
      <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL = { system: 'match device', light: 'light', dark: 'dark' };

/** Cycles System -> Light -> Dark. CSS shows the icon for the current choice (see dark.css). */
export function ThemeToggle({ className = '' }) {
  const [pref, setPref] = useState(() => window.rentEaseTheme?.get() || 'system');
  useEffect(() => window.rentEaseTheme?.subscribe(setPref), []);
  const label = `Theme: ${THEME_LABEL[pref]} (switch to ${THEME_LABEL[NEXT_THEME[pref]]})`;
  return (
    <button type="button" className={`icon-button theme-toggle ${className}`} aria-label={label} title={label}
      onClick={() => window.rentEaseTheme.set(NEXT_THEME[pref])}>
      <span data-theme-icon="system"><Icon name="monitor" size={18} /></span>
      <span data-theme-icon="light"><Icon name="sun" size={18} /></span>
      <span data-theme-icon="dark"><Icon name="moon" size={18} /></span>
    </button>
  );
}

/** A labelled form control with "(optional)", help text, and server errors. */
export function Field({ label, optional, help, error, children }) {
  return (
    <label>
      <span>{label}{optional && <span className="label-hint">(optional)</span>}</span>
      {children}
      {help && <small className="field-help">{help}</small>}
      {error?.map((message) => <small key={message} className="field-error">{message}</small>)}
    </label>
  );
}

export function FormErrors({ errors }) {
  return errors?.non_field_errors?.map((message) => (
    <div key={message} className="form-alert error">{message}</div>
  )) || null;
}

/** Flash messages for the current page. */
export function Messages() {
  const { messages } = useFlash();
  if (!messages.length) return null;
  return (
    <div className="messages">
      {messages.map((m) => (
        <div key={m.id} className={`form-alert ${m.type === 'error' ? 'error' : m.type === 'success' ? 'success' : 'info'}`}
          role="alert">{m.text}</div>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="size-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/**
 * A button that shows a spinner and `busyText` while its request runs, and is
 * disabled meanwhile (prevents double submits).
 */
export function BusyButton({ busy, busyText, className = '', children, type = 'submit', disabled, ...props }) {
  return (
    <button type={type} className={`${className}${busy ? ' inline-flex items-center justify-center gap-2 cursor-wait opacity-80' : ''}`}
      disabled={busy || disabled} aria-busy={busy || undefined} {...props}>
      {busy ? <><Spinner /><span>{busyText}</span></> : children}
    </button>
  );
}

/** Placeholder cards shown while a page loads for the first time. */
export function PageSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden="true">
      <div className="grid animate-pulse gap-3">
        <div className="h-2.5 w-28 rounded bg-gray-200" />
        <div className="h-5 w-64 max-w-full rounded bg-gray-200" />
        <div className="h-2.5 w-96 max-w-full rounded bg-gray-200" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="w-full rounded-md border border-blue-300 bg-white p-4">
            <div className="flex animate-pulse space-x-4">
              <div className="size-10 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-6 py-1">
                <div className="h-2 rounded bg-gray-200" />
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 h-2 rounded bg-gray-200" />
                    <div className="col-span-1 h-2 rounded bg-gray-200" />
                  </div>
                  <div className="h-2 rounded bg-gray-200" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shown when a page's data could not be loaded (404, server down…). */
export function LoadError({ error }) {
  return (
    <EmptyState icon="file" title={error.status === 404 ? 'Not found' : 'Could not load this page'}
      text={error.message}>
      <Link to="/dashboard" className="mt-4 text-sm font-bold text-brand no-underline">Back to dashboard →</Link>
    </EmptyState>
  );
}

export function EmptyState({ icon, title, text, children, as: Tag = 'section' }) {
  return (
    <Tag className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-400">
      <Icon name={icon} size={36} />
      <h3 className="m-0 mt-3 text-base font-bold text-slate-700">{title}</h3>
      {text && <p className="m-0 mt-1 text-sm">{text}</p>}
      {children}
    </Tag>
  );
}

export function BackLink({ to, children }) {
  return <Link to={to} className="w-fit text-sm font-semibold text-brand no-underline hover:underline">← {children}</Link>;
}

/** The small uppercase label + big heading used at the top of most pages. */
export function PageHeader({ eyebrow, title, text, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand">{eyebrow}</span>
        <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {text && <p className="m-0 mt-1 text-sm text-slate-500">{text}</p>}
      </div>
      {children}
    </div>
  );
}

const APPLICATION_BADGES = {
  pending: ['bg-amber-50 text-amber-700', 'Pending'],
  approved: ['bg-emerald-50 text-emerald-700', 'Approved'],
  rejected: ['bg-red-50 text-red-700', 'Rejected'],
  withdrawn: ['bg-slate-100 text-slate-500', 'Withdrawn'],
};

export function ApplicationBadge({ status }) {
  const [classes, label] = APPLICATION_BADGES[status] || APPLICATION_BADGES.withdrawn;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${classes}`}>{label}</span>;
}

/** Pill links that filter a list by status (with counts). */
export function StatusTabs({ tabs, current, onChange, pingLabel }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.value === current;
        return (
          <button key={tab.value || 'all'} type="button" onClick={() => onChange(tab.value)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              active ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>
            {tab.label} <span className={active ? 'text-white/75' : 'text-slate-400'}>{tab.count}</span>
            {tab.value === 'pending' && tab.count > 0 && <PingDot label={pingLabel} />}
          </button>
        );
      })}
    </nav>
  );
}

/** Rotating card colors for property listings. */
export const CARD_GRADIENTS = [
  'bg-gradient-to-br from-blue-800 to-blue-500',
  'bg-gradient-to-br from-teal-800 to-teal-500',
  'bg-gradient-to-br from-amber-800 to-amber-500',
];
