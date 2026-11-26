import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { LISTING_TYPES, PAYMENT_INTERVALS, UNIT_STATUSES } from '../../lib/constants';
import { peso } from '../../lib/format';

const EMPTY = {
  name: '', bedrooms: '0', bathrooms: '1', floor_area: '0', monthly_rent: '', status: 'vacant',
  listing_type: 'rent', payment_interval_months: '1',
  contract_price: '', term_years: '', interest_rate: '', reservation_fee: '',
};

/** /owner/properties/:propertyId/units/new */
export function UnitCreate() {
  const { propertyId } = useParams();
  const { data, error } = useApi(`/owner/properties/${propertyId}/`);
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return <UnitForm property={data.property} />;
}

/** /owner/properties/units/:id/edit */
export function UnitEdit() {
  const { id } = useParams();
  const { data, error } = useApi(`/owner/units/${id}/`);
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return <UnitForm property={data.property} unit={data.unit} />;
}

function UnitForm({ property, unit }) {
  usePageTitle('My Properties', unit ? `Edit ${unit.name}` : 'Add unit');
  const { flash } = useFlash();
  const navigate = useNavigate();
  const form = useForm(unit
    ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, unit[k] === null || unit[k] === undefined ? EMPTY[k] : String(unit[k])]))
    : EMPTY);
  const { bind, errors, values } = form;
  const back = `/owner/properties/${property.id}`;
  const rentToOwn = values.listing_type === 'rent_to_own';
  const interval = Number(values.payment_interval_months) || 1;
  const perPayment = Number(values.monthly_rent) * interval;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (all) => {
      // Contract fields only matter for rent-to-own units.
      const body = rentToOwn ? all : Object.fromEntries(Object.entries(all).filter(([k]) =>
        !['contract_price', 'term_years', 'interest_rate', 'reservation_fee'].includes(k)));
      const data = unit
        ? await api(`/owner/units/${unit.id}/`, { method: 'PUT', body })
        : await api(`/owner/properties/${property.id}/units/`, { method: 'POST', body });
      flash('success', data.message);
      navigate(back);
    });
  };

  return (
    <div className="page-stack narrow-page">
      <BackLink to={back}>Back to {property.name}</BackLink>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{property.name}</span>
          <h1>{unit ? `Edit ${unit.name}` : 'Add a unit'}</h1>
          <p>Set the unit's size, whether it's for rent or rent-to-own, the payment terms, and whether tenants can apply.</p>
        </div>
      </div>
      <section className="panel">
        <form className="form-stack p-6" onSubmit={onSubmit} noValidate>
          <FormErrors errors={errors} />
          <Field label="Name" error={errors.name}><input {...bind('name')} maxLength={100} placeholder="e.g. Unit 101 or Block 2 Lot 42" /></Field>

          <Field label="Listing type" error={errors.listing_type}>
            <span className="flex flex-wrap gap-2">
              {LISTING_TYPES.map(([value, label]) => (
                <button key={value} type="button" onClick={() => form.setValue('listing_type', value)}
                  className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm font-semibold ${values.listing_type === value ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}>
                  {label}
                </button>
              ))}
            </span>
          </Field>

          {rentToOwn && (
            <fieldset className="m-0 grid gap-4 rounded-xl border border-line p-4">
              <legend className="px-1 text-sm font-bold text-slate-800">Rent-to-own contract</legend>
              <div className="form-grid two">
                <Field label="Contract price (₱)" error={errors.contract_price}>
                  <input {...bind('contract_price')} type="number" min="1" step="0.01" placeholder="3000000" />
                </Field>
                <Field label="Term (years)" error={errors.term_years}>
                  <input {...bind('term_years')} type="number" min="1" max="50" placeholder="12" />
                </Field>
              </div>
              <div className="form-grid two">
                <Field label="Interest rate (% per year)" optional help="Recorded on the contract for reference." error={errors.interest_rate}>
                  <input {...bind('interest_rate')} type="number" min="0" max="100" step="0.01" placeholder="5" />
                </Field>
                <Field label="Reservation fee (₱)" optional help="Counts toward the contract price." error={errors.reservation_fee}>
                  <input {...bind('reservation_fee')} type="number" min="0" step="0.01" placeholder="60000" />
                </Field>
              </div>
            </fieldset>
          )}

          <div className="form-grid two">
            <Field label={rentToOwn ? 'Monthly payment (₱)' : 'Monthly rent (₱)'} error={errors.monthly_rent}>
              <input {...bind('monthly_rent')} type="number" min="0" step="0.01" placeholder={rentToOwn ? '20000' : '8500'} />
            </Field>
            <Field label="Payment terms" error={errors.payment_interval_months}
              help={interval > 1 && perPayment > 0 ? `Tenant pays ${peso(perPayment)} every ${interval} months.` : 'How often the tenant pays.'}>
              <select {...bind('payment_interval_months')}>
                {PAYMENT_INTERVALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-grid three">
            <Field label="Bedrooms (0 = studio)" error={errors.bedrooms}><input {...bind('bedrooms')} type="number" min="0" /></Field>
            <Field label="Bathrooms" error={errors.bathrooms}><input {...bind('bathrooms')} type="number" min="0" /></Field>
            <Field label="Floor area (sqm)" error={errors.floor_area}><input {...bind('floor_area')} type="number" min="0" /></Field>
          </div>
          <Field label="Status" error={errors.status}>
            <select {...bind('status')}>
              {UNIT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {unit && <p className="m-0 text-xs text-slate-500">Changes apply to new tenants. A current tenant keeps the terms their lease was approved with.</p>}
          <div className="form-actions">
            <Link className="secondary-button" to={back}>Cancel</Link>
            <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">{unit ? 'Save changes' : 'Add unit'}</BusyButton>
          </div>
        </form>
      </section>
    </div>
  );
}
