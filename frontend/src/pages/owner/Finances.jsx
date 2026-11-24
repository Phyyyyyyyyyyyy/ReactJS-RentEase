import { useSearchParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BusyButton, Field, FormErrors, LoadError, PageHeader, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { formatDate, peso, todayInManila } from '../../lib/format';

const pad = (n) => String(n).padStart(2, '0');

/** Quick date ranges for the report. */
function presets(today) {
  const [y, m] = today.split('-').map(Number);
  const lastMonthEnd = new Date(Date.UTC(y, m - 1, 0));
  const lm = `${lastMonthEnd.getUTCFullYear()}-${pad(lastMonthEnd.getUTCMonth() + 1)}`;
  return [
    ['This month', `${y}-${pad(m)}-01`, today],
    ['Last month', `${lm}-01`, `${lm}-${pad(lastMonthEnd.getUTCDate())}`],
    ['This year', `${y}-01-01`, today],
  ];
}

/** /owner/finances: income vs. expenses report, CSV export, and recording expenses. */
export default function Finances() {
  usePageTitle('Finances', 'Finances');
  const today = todayInManila();
  const [params, setParams] = useSearchParams();
  const start = params.get('start') || `${today.slice(0, 8)}01`;
  const end = params.get('end') || today;
  const range = new URLSearchParams({ start, end }).toString();
  const report = useApi(`/owner/reports/?${range}`);
  const expenses = useApi(`/owner/expenses/?${range}`);
  const properties = useApi('/owner/properties/');
  const setRange = (s, e) => setParams({ start: s, end: e });
  const reloadAll = () => { report.reload(); expenses.reload(); };

  return (
    <div className="grid gap-6">
      <PageHeader eyebrow="Property owner" title="Finances" text="Rent received, expenses, and net income for your properties.">
        <a className="secondary-button inline-flex items-center gap-2" href={`/api/owner/reports/export/?${range}`} download>
          <Icon name="file" size={16} />Export CSV
        </a>
      </PageHeader>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <label className="grid gap-1 text-xs font-semibold text-slate-600">From
          <input type="date" value={start} max={end} onChange={(e) => e.target.value && setRange(e.target.value, end)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">To
          <input type="date" value={end} min={start} max={today} onChange={(e) => e.target.value && setRange(start, e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {presets(today).map(([label, s, e]) => (
            <button key={label} type="button" onClick={() => setRange(s, e)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-semibold ${s === start && e === end ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {report.error && <LoadError error={report.error} />}
      {!report.data && !report.error && <PageSkeleton />}
      {report.data && <Report r={report.data} />}

      {properties.data && (
        <ExpenseForm properties={properties.data.properties} categories={expenses.data?.categories || []} today={today} onSaved={reloadAll} />
      )}
      {expenses.data && <ExpenseList data={expenses.data} onChange={reloadAll} />}
    </div>
  );
}

function Report({ r }) {
  const netTone = Number(r.net) < 0 ? 'text-red-700' : 'text-emerald-700';
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        <Card label="Rent received" value={peso(r.total_income)} note="confirmed payments" tone="text-slate-900" />
        <Card label="Expenses" value={peso(r.total_expenses)} note="recorded expenses" tone="text-slate-900" />
        <Card label="Net income" value={peso(r.net)} note={`${formatDate(r.start, 'M j, Y')} – ${formatDate(r.end, 'M j, Y')}`} tone={netTone} />
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">By property</span><h2>Income and expenses</h2></div></div>
        <div className="table-wrap">
          <table className="compact-table">
            <thead><tr><th>Property</th><th>Rent received</th><th>Payments</th><th>Expenses</th><th>Net</th></tr></thead>
            <tbody>
              {r.properties.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{peso(p.income)}</td>
                  <td>{p.payments}</td>
                  <td>{peso(p.expenses)}</td>
                  <td className={Number(p.net) < 0 ? 'font-bold text-red-700' : 'font-bold'}>{peso(p.net)}</td>
                </tr>
              ))}
              {r.properties.length === 0 && <tr><td colSpan={5} className="empty-inline">No properties yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {r.categories.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
            {r.categories.map((c) => (
              <span key={c.category} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{c.label}: <strong>{peso(c.total)}</strong></span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Card({ label, value, note, tone }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <strong className={`mt-1 block text-2xl font-bold ${tone}`}>{value}</strong>
      <span className="text-xs text-slate-400">{note}</span>
    </div>
  );
}

function ExpenseForm({ properties, categories, today, onSaved }) {
  const { notify } = useFlash();
  const form = useForm({ property: properties[0]?.id ?? '', category: 'maintenance', amount: '', spent_on: today, note: '' });
  const { bind, errors } = form;
  if (!properties.length) return null;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api('/owner/expenses/', { method: 'POST', body: values });
      notify('success', result.message);
      form.setValues((v) => ({ ...v, amount: '', note: '' }));
      onSaved();
    });
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="m-0 mb-4 flex items-center gap-2 text-base font-bold text-slate-900"><Icon name="cash" size={20} />Record an expense</h2>
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <FormErrors errors={errors} />
        <div className="form-grid two">
          <Field label="Property" error={errors.property}>
            <select {...bind('property')}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          <Field label="Category" error={errors.category}>
            <select {...bind('category')}>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          </Field>
        </div>
        <div className="form-grid two">
          <Field label="Amount (₱)" error={errors.amount}><input {...bind('amount')} type="number" step="0.01" min="1" /></Field>
          <Field label="Date" error={errors.spent_on}><input {...bind('spent_on')} type="date" max={today} /></Field>
        </div>
        <Field label="Note" optional error={errors.note}><input {...bind('note')} maxLength={255} placeholder="e.g. Replaced the water heater in 101" /></Field>
        <div className="form-actions"><BusyButton className="primary-button" busy={form.busy} busyText="Saving…">Add expense</BusyButton></div>
      </form>
    </section>
  );
}

function ExpenseList({ data, onChange }) {
  const { run, busyKey } = useAction();
  const remove = (e) => run(`delete-${e.id}`, null, {
    confirm: `Delete this ${peso(e.amount)} expense?`,
    request: () => api(`/owner/expenses/${e.id}/`, { method: 'DELETE' }),
    onDone: onChange,
  });
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="eyebrow">This period</span><h2>Expenses · {peso(data.total)}</h2></div>
      </div>
      <div className="table-wrap">
        <table className="compact-table">
          <thead><tr><th>Date</th><th>Property</th><th>Category</th><th>Amount</th><th>Note</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.expenses.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.spent_on, 'M j, Y')}</td>
                <td>{e.property.name}</td>
                <td><span className="badge badge-info">{e.category_display}</span></td>
                <td><strong>{peso(e.amount)}</strong></td>
                <td className="text-slate-500">{e.note}</td>
                <td>
                  <BusyButton type="button" busy={busyKey === `delete-${e.id}`} busyText="…" onClick={() => remove(e)}
                    className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">
                    Delete
                  </BusyButton>
                </td>
              </tr>
            ))}
            {data.expenses.length === 0 && <tr><td colSpan={6} className="empty-inline">No expenses recorded in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
