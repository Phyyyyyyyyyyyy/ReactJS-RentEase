import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { UNIT_STATUSES } from '../../lib/constants';

const EMPTY = { name: '', bedrooms: '0', bathrooms: '1', floor_area: '0', monthly_rent: '', status: 'vacant' };

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
  const form = useForm(unit ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, String(unit[k])])) : EMPTY);
  const { bind, errors } = form;
  const back = `/owner/properties/${property.id}`;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const data = unit
        ? await api(`/owner/units/${unit.id}/`, { method: 'PUT', body: values })
        : await api(`/owner/properties/${property.id}/units/`, { method: 'POST', body: values });
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
          <p>Set the unit's size, rent, and whether it's available for tenants to apply.</p>
        </div>
      </div>
      <section className="panel">
        <form className="form-stack p-6" onSubmit={onSubmit} noValidate>
          <FormErrors errors={errors} />
          <div className="form-grid two">
            <Field label="Name" error={errors.name}><input {...bind('name')} maxLength={100} placeholder="e.g. Unit 101" /></Field>
            <Field label="Monthly rent (₱)" error={errors.monthly_rent}>
              <input {...bind('monthly_rent')} type="number" min="0" step="0.01" placeholder="8500" />
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
          <div className="form-actions">
            <Link className="secondary-button" to={back}>Cancel</Link>
            <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">{unit ? 'Save changes' : 'Add unit'}</BusyButton>
          </div>
        </form>
      </section>
    </div>
  );
}
