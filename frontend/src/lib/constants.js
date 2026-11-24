/** Choices that mirror the Django models (models.py in each backend app). */

export const PROPERTY_TYPES = [
  ['apartment', 'Apartment'],
  ['house', 'House'],
  ['townhouse', 'Townhouse'],
  ['studio', 'Studio'],
  ['condo', 'Condominium'],
  ['boarding', 'Boarding House'],
];

export const UNIT_STATUSES = [
  ['vacant', 'Vacant'],
  ['occupied', 'Occupied'],
];

export const PAYMENT_METHODS = [
  ['gcash', 'GCash'],
  ['cash', 'Cash (in person)'],
  ['bank', 'Bank transfer'],
  ['other', 'Other'],
];

// Roles a visitor may pick on the public registration form.
export const SELF_REGISTER_ROLES = [
  ['tenant', 'Tenant'],
  ['owner', 'Property Owner'],
];

/** Sidebar items per role. `to: null` means the module is not built yet ("Soon"). */
export const ROLE_MENUS = {
  admin: [
    { to: '/dashboard/admin', label: 'Dashboard', icon: 'home' },
    { href: '/django-admin/', label: 'Users & Access', icon: 'users' },
    { to: null, label: 'Properties & Units', icon: 'building' },
    { to: null, label: 'Applications', icon: 'file' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
  owner: [
    { to: '/dashboard/owner', label: 'Dashboard', icon: 'home' },
    { to: '/owner/properties', label: 'My Properties', icon: 'building' },
    { to: '/owner/applications', label: 'Applications', icon: 'file', badge: 'pending_applications', badgeLabel: 'pending' },
    { to: '/owner/payments', label: 'Rent Payments', icon: 'wallet', badge: 'pending_payments', badgeLabel: 'to confirm' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
  tenant: [
    { to: '/dashboard/tenant', label: 'Dashboard', icon: 'home' },
    { to: '/browse', label: 'Browse Properties', icon: 'search' },
    { to: '/applications', label: 'My Applications', icon: 'file', badge: 'pending_applications', badgeLabel: 'pending' },
    { to: '/payments', label: 'Rent & Payments', icon: 'wallet' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
  staff: [
    { to: '/dashboard/staff', label: 'Dashboard', icon: 'home' },
    { to: null, label: 'Property Records', icon: 'building' },
    { to: null, label: 'Applications', icon: 'file' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
};

/** Public files (frontend/public) work both in dev (/) and in the Django-served build (/static/). */
export function asset(path) {
  return `${import.meta.env.BASE_URL}${path}`;
}
