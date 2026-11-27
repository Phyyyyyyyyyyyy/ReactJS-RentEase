import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import { BackLink, BusyButton, Field, FormErrors, LoadError, PageSkeleton } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { useForm } from '../../hooks/useForm';
import { api } from '../../lib/api';
import { PROPERTY_TYPES } from '../../lib/constants';

const EMPTY = { name: '', property_type: '', address: '', city: '', description: '', amenities: '' };

/** /owner/properties/new and /owner/properties/:id/edit */
export default function PropertyFormPage() {
  const { id } = useParams();
  if (!id) return <PropertyForm />;
  return <EditProperty id={id} />;
}

function EditProperty({ id }) {
  const { data, error } = useApi(`/owner/properties/${id}/`);
  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  return <PropertyForm property={data.property} />;
}

function PropertyForm({ property }) {
  usePageTitle('My Properties', property ? `Edit ${property.name}` : 'Add property');
  const { flash, notify } = useFlash();
  const { refreshBadges } = useAuth();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const form = useForm(property ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, property[k]])) : EMPTY);
  const { bind, errors } = form;
  const back = property ? `/owner/properties/${property.id}` : '/owner/properties';

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (values) => {
      const data = property
        ? await api(`/owner/properties/${property.id}/`, { method: 'PUT', body: values })
        : await api('/owner/properties/', { method: 'POST', body: values });
      flash('success', data.message);
      navigate(`/owner/properties/${data.property.id}`);
    });
  };

  const onDelete = async () => {
    if (!window.confirm(`Delete ${property.name} and all its units and pending applications? This cannot be undone. (Properties with tenants or payment records can't be deleted.)`)) return;
    setDeleting(true);
    try {
      const data = await api(`/owner/properties/${property.id}/`, { method: 'DELETE' });
      flash('success', data.message);
      refreshBadges();
      navigate('/owner/properties');
    } catch (error) {
      notify('error', error.message);
      setDeleting(false);
    }
  };

  return (
    <div className="page-stack narrow-page">
      <BackLink to={back}>Back</BackLink>
      <div className="page-heading">
        <div>
          <span className="eyebrow">My properties</span>
          <h1>{property ? `Edit ${property.name}` : 'Add a property'}</h1>
          <p>{property ? 'Update the details tenants see when browsing.' : "Enter the building's details. You'll add its units on the next page."}</p>
        </div>
      </div>
      <section className="panel">
        <form className="form-stack p-6" onSubmit={onSubmit} noValidate>
          <FormErrors errors={errors} />
          <div className="form-grid two">
            <Field label="Name" error={errors.name}><input {...bind('name')} maxLength={150} placeholder="e.g. Lahug Apartments" /></Field>
            <Field label="Type" error={errors.property_type}>
              <select {...bind('property_type')}>
                <option value="">---------</option>
                {PROPERTY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-grid two">
            <Field label="Address" error={errors.address}><input {...bind('address')} maxLength={255} placeholder="Street, barangay" /></Field>
            <Field label="City" error={errors.city}><input {...bind('city')} maxLength={100} placeholder="e.g. Cebu City" /></Field>
          </div>
          <Field label="Description" optional error={errors.description}>
            <textarea {...bind('description')} rows={4} placeholder="What makes this place a good home?" />
          </Field>
          <Field label="Amenities" optional help="Separate amenities with commas." error={errors.amenities}>
            <input {...bind('amenities')} maxLength={255} placeholder="Wi-Fi, Parking, CCTV" />
          </Field>
          <div className="form-actions">
            <Link className="secondary-button" to={back}>Cancel</Link>
            <BusyButton className="primary-button" busy={form.busy} busyText="Saving…">{property ? 'Save changes' : 'Add property'}</BusyButton>
          </div>
        </form>
      </section>

      {property && (
        <section className="panel flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <strong className="block text-sm text-red-700">Delete this property</strong>
            <span className="text-xs text-slate-500">Removes the property, all its units, and every application for them. This can't be undone.</span>
          </div>
          <BusyButton type="button" className="danger-button cursor-pointer" busy={deleting} busyText="Deleting…" onClick={onDelete}>
            Delete property
          </BusyButton>
        </section>
      )}
    </div>
  );
}
