import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useAction } from '../../hooks/useAction';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { formatDate, peso, todayInManila } from '../../lib/format';

/** /owner/logs/:id: one payment log, laid out like the spreadsheet, with add / import / export. */
export default function PaymentLog() {
  const { id } = useParams();
  const { data, error, reload } = useApi(`/owner/logs/${id}/`);
  usePageTitle('My Properties', data ? `Payment log · ${data.log.holder_name}` : 'Payment log');
  const [panel, setPanel] = useState(null); // 'add' | 'import' | 'edit'
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  const { log, unit, property, entries } = data;
  const toggle = (name) => setPanel(panel === name ? null : name);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink to={`/owner/units/${unit.id}/logs`}>{unit.name} payment logs</BackLink>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="primary-button cursor-pointer" onClick={() => toggle('add')}>+ Add payment</button>
          <button type="button" className="secondary-button cursor-pointer" onClick={() => toggle('import')}>Import CSV</button>
          <a className="secondary-button" href={`/api/owner/logs/${log.id}/export/`} download>Download CSV</a>
          <button type="button" className="secondary-button cursor-pointer" onClick={() => window.print()}>Print</button>
          <button type="button" className="secondary-button cursor-pointer" onClick={() => toggle('edit')}>Edit details</button>
        </div>
      </div>

      {panel === 'add' && <AddEntry logId={log.id} onDone={reload} />}
      {panel === 'import' && <ImportCsv logId={log.id} onDone={() => { reload(); setPanel(null); }} />}
      {panel === 'edit' && <EditLog log={log} onDone={() => { reload(); setPanel(null); }} />}

      <article className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <h1 className="m-0 text-center text-xl font-bold text-slate-900">Statement of Account</h1>
        <dl className="m-0 mt-6 grid gap-1.5 text-sm">
          <Info label="Date" value={`As of ${formatDate(data.as_of, 'F j, Y')}`} />
          <Info label="To" value={log.holder_name} />
          <Info label="Re" value={`${unit.name}, ${property.name}, ${property.address}, ${property.city}`} />
          {log.term_years && <Info label="Term" value={`${log.term_years} yrs${log.start_date ? ` (from ${formatDate(log.start_date, 'M j, Y')})` : ''}`} />}
          {log.contract_price && <Info label="Contract price" value={peso(log.contract_price)} />}
          {log.interest_rate !== null && <Info label="Interest rate" value={`${Number(log.interest_rate)}% per annum`} />}
          {log.monthly_amount && <Info label="Monthly amount" value={peso(log.monthly_amount)} />}
          {log.note && <Info label="Note" value={log.note} />}
        </dl>
        <div className="table-wrap mt-6">
          <table className="compact-table">
            <thead><tr><th>Payments</th><th>Date</th><th>Amount</th><th>Mode of payment</th><th className="print:hidden"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {entries.map((e) => <EntryRow key={e.id} entry={e} onChange={reload} />)}
              {entries.length === 0 && <tr><td colSpan={5} className="empty-inline">No payments yet. Add one or import your spreadsheet.</td></tr>}
            </tbody>
          </table>
        </div>
        <dl className="m-0 mt-6 grid gap-1.5 border-t border-slate-200 pt-4 text-sm">
          <Info label="Total paid" value={`${peso(log.total_paid)} (${log.entries_count} payment${log.entries_count === 1 ? '' : 's'})`} strong />
          {log.remaining_balance !== null && (
            <Info label="Remaining balance" value={`${peso(log.remaining_balance)} of ${peso(log.contract_price)} (${log.percent_paid}% paid)`} strong />
          )}
        </dl>
      </article>
      <DeleteLog log={log} unitId={unit.id} />
    </div>
  );
}

function Info({ label, value, strong }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3">
      <dt className="text-slate-500">{label}:</dt>
      <dd className={`m-0 ${strong ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{value}</dd>
    </div>
  );
}

const ENTRY_FIELDS = (form) => {
  const { bind, errors } = form;
  return (
    <>
      <div className="form-grid two">
        <Field label="Date" error={errors.entry_date}><input {...bind('entry_date')} type="date" /></Field>
        <Field label="Amount (₱)" error={errors.amount}><input {...bind('amount')} type="number" step="0.01" min="0.01" /></Field>
      </div>
      <div className="form-grid two">
        <Field label="Payment" optional error={errors.description}>
          <input {...bind('description')} maxLength={100} list="log-descriptions" placeholder="e.g. Issued check" />
        </Field>
        <Field label="Mode of payment" optional error={errors.mode}>
          <input {...bind('mode')} maxLength={100} list="log-modes" placeholder="e.g. Checked deposit" />
        </Field>
      </div>
      <div className="form-grid two">
        <Field label="Check / reference no." optional error={errors.reference}><input {...bind('reference')} maxLength={50} /></Field>
        <Field label="Note" optional error={errors.note}><input {...bind('note')} maxLength={255} /></Field>
      </div>
      <datalist id="log-descriptions">
        {['Reservation payment', 'Issued check', 'Online banking', 'Cash payment', 'Monthly payment'].map((v) => <option key={v} value={v} />)}
      </datalist>
      <datalist id="log-modes">
        {['Cash payment', 'Checked deposit', 'Online bank deposit', 'GCash', 'Bank transfer'].map((v) => <option key={v} value={v} />)}
      </datalist>
    </>
  );
};

function AddEntry({ logId, onDone }) {
  const { notify } = useFlash();
  const form = useForm({ entry_date: todayInManila(), amount: '', description: '', mode: '', reference: '', note: '' });
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/owner/logs/${logId}/entries/`, { method: 'POST', body: values });
      notify('success', result.message);
      // Keep the description and mode for the next one, which is usually the same kind of payment.
      form.setValues((v) => ({ ...v, amount: '', reference: '', note: '' }));
      onDone();
    });
  };
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm print:hidden">
      <h2 className="m-0 mb-4 text-base font-bold text-slate-900">Add a payment</h2>
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <FormErrors errors={form.errors} />
        {ENTRY_FIELDS(form)}
        <div className="form-actions"><BusyButton className="primary-button" busy={form.busy} busyText="Adding…">Add payment</BusyButton></div>
      </form>
    </section>
  );
}

function EntryRow({ entry, onChange }) {
  const [editing, setEditing] = useState(false);
  const { run, busyKey } = useAction();
  const { notify } = useFlash();
  const form = useForm({ ...entry });
  const remove = () => run(`del-${entry.id}`, null, {
    confirm: `Remove the ${peso(entry.amount)} payment on ${formatDate(entry.entry_date, 'M j, Y')}?`,
    request: () => api(`/owner/log-entries/${entry.id}/`, { method: 'DELETE' }),
    onDone: onChange,
  });
  const save = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/owner/log-entries/${entry.id}/`, { method: 'PUT', body: values });
      notify('success', result.message);
      setEditing(false);
      onChange();
    });
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <form className="form-stack py-2" onSubmit={save} noValidate>
            <FormErrors errors={form.errors} />
            {ENTRY_FIELDS(form)}
            <div className="form-actions">
              <button type="button" className="secondary-button cursor-pointer" onClick={() => setEditing(false)}>Cancel</button>
              <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">Save</BusyButton>
            </div>
          </form>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>
        {entry.description || '—'}
        {(entry.reference || entry.note) && <span className="block text-xs text-slate-400">{[entry.reference, entry.note].filter(Boolean).join(' · ')}</span>}
      </td>
      <td>{formatDate(entry.entry_date, 'M j, Y')}</td>
      <td><strong>{peso(entry.amount)}</strong></td>
      <td>{entry.mode || '—'}</td>
      <td className="print:hidden">
        <div className="flex gap-2">
          <button type="button" className="secondary-button compact cursor-pointer" onClick={() => setEditing(true)}>Edit</button>
          <BusyButton type="button" busy={busyKey === `del-${entry.id}`} busyText="…" onClick={remove}
            className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">
            Remove
          </BusyButton>
        </div>
      </td>
    </tr>
  );
}

function ImportCsv({ logId, onDone }) {
  const { notify, flash } = useFlash();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (isPreview) => {
    setBusy(true);
    try {
      const result = await api(`/owner/logs/${logId}/import/`, { method: 'POST', body: { csv, preview: isPreview } });
      if (isPreview) setPreview(result);
      else {
        flash('success', result.message);
        onDone();
      }
    } catch (error) {
      notify('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files[0];
    setPreview(null);
    if (!file) return;
    if (file.size > 900_000) {
      notify('error', 'That file is too big. Save just the payments sheet as CSV.');
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  };

  const newRows = preview?.rows.filter((r) => !r.duplicate) || [];
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm print:hidden">
      <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Import from Excel</h2>
      <p className="m-0 mb-4 text-xs text-slate-500">
        In Excel choose <strong>File → Save As → CSV (Comma delimited)</strong>, then pick that file here. Each row with a date and an amount becomes a payment:
        the text before the date is the description and the text after the amount is the mode. Titles and totals are skipped, and payments already in the log aren't added twice.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        <BusyButton type="button" className="secondary-button cursor-pointer" busy={busy && !preview} busyText="Reading…" disabled={!csv} onClick={() => send(true)}>
          Preview
        </BusyButton>
      </div>
      {preview && (
        <div className="mt-4 grid gap-3">
          <p className="m-0 text-sm text-slate-700"><strong>{fileName}</strong>: {preview.message}
            {preview.rows.length - newRows.length > 0 && ` ${preview.rows.length - newRows.length} already in the log will be skipped.`}
          </p>
          <div className="table-wrap max-h-80 overflow-y-auto">
            <table className="compact-table">
              <thead><tr><th>Row</th><th>Payment</th><th>Date</th><th>Amount</th><th>Mode</th><th /></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className={r.duplicate ? 'opacity-50' : ''}>
                    <td className="text-xs text-slate-400">{r.line}</td>
                    <td>{r.description || '—'}</td>
                    <td>{formatDate(r.entry_date, 'M j, Y')}</td>
                    <td>{peso(r.amount)}</td>
                    <td>{r.mode || '—'}</td>
                    <td className="text-xs">{r.duplicate ? 'Already in log' : <span className="font-semibold text-emerald-700">New</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">{preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} skipped (no date or amount)</summary>
              <ul className="m-0 mt-2 grid gap-1 pl-4">{preview.skipped.map((s) => <li key={s.line}>Row {s.line}: {s.text}</li>)}</ul>
            </details>
          )}
          <div>
            <BusyButton type="button" className="primary-button cursor-pointer" busy={busy} busyText="Importing…" disabled={!newRows.length} onClick={() => send(false)}>
              Import {newRows.length} payment{newRows.length === 1 ? '' : 's'}
            </BusyButton>
          </div>
        </div>
      )}
    </section>
  );
}

function EditLog({ log, onDone }) {
  const { notify } = useFlash();
  const form = useForm({
    holder_name: log.holder_name, start_date: log.start_date || '', contract_price: log.contract_price || '',
    term_years: log.term_years ?? '', interest_rate: log.interest_rate ?? '', monthly_amount: log.monthly_amount || '', note: log.note,
  });
  const { bind, errors } = form;
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const result = await api(`/owner/logs/${log.id}/`, { method: 'PUT', body: values });
      notify('success', result.message);
      onDone();
    });
  };
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm print:hidden">
      <h2 className="m-0 mb-4 text-base font-bold text-slate-900">Log details</h2>
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <FormErrors errors={errors} />
        <Field label="Buyer / tenant name(s)" error={errors.holder_name}><input {...bind('holder_name')} maxLength={200} /></Field>
        <div className="form-grid two">
          <Field label="Contract start date" optional error={errors.start_date}><input {...bind('start_date')} type="date" /></Field>
          <Field label="Contract price (₱)" optional error={errors.contract_price}><input {...bind('contract_price')} type="number" step="0.01" min="1" /></Field>
        </div>
        <div className="form-grid three">
          <Field label="Term (years)" optional error={errors.term_years}><input {...bind('term_years')} type="number" min="1" max="50" /></Field>
          <Field label="Interest rate (%)" optional error={errors.interest_rate}><input {...bind('interest_rate')} type="number" min="0" max="100" step="0.01" /></Field>
          <Field label="Monthly amount (₱)" optional error={errors.monthly_amount}><input {...bind('monthly_amount')} type="number" step="0.01" min="1" /></Field>
        </div>
        <Field label="Note" optional error={errors.note}><input {...bind('note')} maxLength={500} /></Field>
        <div className="form-actions"><BusyButton className="primary-button" busy={form.busy} busyText="Saving…">Save details</BusyButton></div>
      </form>
    </section>
  );
}

function DeleteLog({ log, unitId }) {
  const navigate = useNavigate();
  const { flash, notify } = useFlash();
  const [busy, setBusy] = useState(false);
  const onDelete = async () => {
    if (!window.confirm(`Delete this payment log and all ${log.entries_count} payments in it? This can't be undone.`)) return;
    setBusy(true);
    try {
      flash('success', (await api(`/owner/logs/${log.id}/`, { method: 'DELETE' })).message);
      navigate(`/owner/units/${unitId}/logs`);
    } catch (error) {
      notify('error', error.message);
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-white p-5 print:hidden">
      <span className="text-xs text-slate-500">Delete this log and every payment in it.</span>
      <BusyButton type="button" className="danger-button cursor-pointer" busy={busy} busyText="Deleting…" onClick={onDelete}>Delete log</BusyButton>
    </section>
  );
}
