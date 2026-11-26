/** Choices that mirror the backend (backend/src/routes/*.js and backend/src/users.js). */

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

// Mode of payment.
export const PAYMENT_METHODS = [
  ['cash', 'Cash (in person)'],
  ['check', 'Check deposit'],
  ['online_bank', 'Online bank deposit'],
  ['gcash', 'GCash'],
  ['bank', 'Bank transfer'],
  ['other', 'Other'],
];

// What a payment is for. Reservation payments count toward a rent-to-own contract, not the regular bills.
export const PAYMENT_KINDS = [
  ['monthly', 'Rent payment'],
  ['reservation', 'Reservation payment'],
  ['other', 'Other payment'],
];

export const LISTING_TYPES = [
  ['rent', 'For rent'],
  ['rent_to_own', 'Rent-to-own'],
];

/** Payment terms: pay every N months. */
export const PAYMENT_INTERVALS = Array.from({ length: 12 }, (_, i) => [i + 1, i === 0 ? 'Monthly' : `Every ${i + 1} months`]);

export const ROLES = [
  ['admin', 'Admin'],
  ['owner', 'Property Owner'],
  ['tenant', 'Tenant'],
  ['manager', 'Property Manager'],
];

/** Sidebar items per role. `to: null` means the module is not built yet ("Soon"). */
export const ROLE_MENUS = {
  admin: [
    { to: '/dashboard/admin', label: 'Dashboard', icon: 'home' },
    { to: '/admin/users', label: 'Users & Access', icon: 'users' },
    { to: '/admin/referral-codes', label: 'Referral Codes', icon: 'key' },
    { to: null, label: 'Properties & Units', icon: 'building' },
    { to: null, label: 'Applications', icon: 'file' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
  owner: [
    { to: '/dashboard/owner', label: 'Dashboard', icon: 'home' },
    { to: '/owner/properties', label: 'My Properties', icon: 'building' },
    { to: '/owner/applications', label: 'Applications', icon: 'file', badge: 'pending_applications', badgeLabel: 'pending' },
    { to: '/owner/payments', label: 'Rent Payments', icon: 'wallet', badge: 'pending_payments', badgeLabel: 'to confirm' },
    { to: '/messages', label: 'Messages', icon: 'chat', badge: 'unread_messages', badgeLabel: 'unread' },
    { to: '/owner/finances', label: 'Finances', icon: 'chart' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
  tenant: [
    { to: '/dashboard/tenant', label: 'Dashboard', icon: 'home' },
    { to: '/browse', label: 'Browse Properties', icon: 'search' },
    { to: '/applications', label: 'My Applications', icon: 'file', badge: 'pending_applications', badgeLabel: 'pending' },
    { to: '/payments', label: 'Rent & Payments', icon: 'wallet' },
    { to: '/messages', label: 'Messages', icon: 'chat', badge: 'unread_messages', badgeLabel: 'unread' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
  manager: [
    { to: '/dashboard/manager', label: 'Dashboard', icon: 'home' },
    { to: '/owner/properties', label: 'Managed Properties', icon: 'building' },
    { to: '/owner/applications', label: 'Applications', icon: 'file', badge: 'pending_applications', badgeLabel: 'pending' },
    { to: '/owner/payments', label: 'Rent Payments', icon: 'wallet', badge: 'pending_payments', badgeLabel: 'to confirm' },
    { to: '/messages', label: 'Messages', icon: 'chat', badge: 'unread_messages', badgeLabel: 'unread' },
    { to: '/profile', label: 'My Profile', icon: 'user' },
  ],
};

/** URL of a public file (frontend/public), e.g. asset('brand/favicon.svg'). */
export function asset(path) {
  return `${import.meta.env.BASE_URL}${path}`;
}
