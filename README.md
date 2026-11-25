# RentEase (React version)

RentEase connects **property owners**, **tenants**, **staff**, and **administrators** in one web app. Owners list properties and units, tenants find and apply for rentals, owners approve applications, and rent is billed monthly and paid through GCash or in person.

The whole project is JavaScript: a **React single-page app** in `frontend/` talks to a **Node.js + Express JSON API** in `backend/`. (It started as a Django app; the API keeps the same endpoints, validation rules, and rent billing.)

| Layer | Technology |
|---|---|
| Frontend | **React 19** + **React Router**, built with **Vite** (`frontend/`) |
| Styling | **Tailwind CSS v4** plus the original RentEase stylesheet, light and dark theme |
| Backend | **Node.js** + **Express 5**, JSON API under `/api/` (`backend/`) |
| Database | Local **SQLite** file (built into Node), or **PostgreSQL** on **Supabase** when `DATABASE_URL` is set |
| Authentication | Session cookie with CSRF protection; passwords hashed with PBKDF2-SHA256 |

## Project layout

```
backend/            Node.js API (Express)
  src/routes/       every /api endpoint, one file per area (see "Who owns what" below)
  src/billing.js    monthly rent charges and balances
  src/leases.js     creating leases on approval
  src/gcash.js      GCashGateway (sandbox online payments)
  src/notifications.js  in-app notifications and rent reminders
  src/referrals.js     referral codes (needed to sign up)
  src/schema.js     database tables
  src/lib/          sessions + CSRF, form validation, passwords, uploads
  scripts/          seed.js (demo data), create-admin.js
  test/             API tests (node --test)
frontend/           React app
  src/pages/        one component per page (auth, dashboards, tenant/, owner/, admin/, Notifications, Receipt)
  src/components/   layout, sidebar, form fields, badges, tables
  src/lib/api.js    fetch wrapper (sends the CSRF token)
```

### Who owns what (team split)

| Member | Area | Backend | Frontend pages |
|---|---|---|---|
| 1: Properties | Property, Unit, Expense, FinancialReport | `routes/properties.js`, `routes/finances.js` | `owner/PropertyList`, `PropertyManage`, `PropertyForm`, `UnitForm`, `Finances`, `tenant/Browse`, `PropertyDetail` |
| 2: Applications & Leases | RentalApplication, Lease, user & role management | `routes/properties.js` (applications), `routes/leases.js`, `leases.js`, `routes/admin.js` | `owner/OwnerApplications`, `tenant/MyApplications`, `EditApplication`, `components/lease.jsx`, `admin/` |
| 3: Payments & Notifications | Payment, GCashGateway, Notification | `routes/payments.js`, `routes/gcash.js`, `gcash.js`, `billing.js`, `routes/notifications.js`, `notifications.js` | `tenant/TenantPayments`, `GCashPay`, `OnlinePay`, `Checkout`, `Receipt`, `Notifications`, `owner/OwnerPayments`, `OwnerTenancy` |

## Running it locally

You need **Node.js 22.13 or newer** (nothing else: the database is built in).

**Quick start (Windows):** double-click `run.bat`. It installs everything the first time, starts both servers, and opens http://localhost:5173/.

**Manually:**

```bash
# 1. Backend (terminal 1)
cd backend
npm install
npm run seed          # optional: demo accounts and sample properties
npm start             # http://127.0.0.1:8000  (npm run dev restarts on code changes)

# 2. Frontend (terminal 2)
cd frontend
npm install
npm run dev           # http://localhost:5173
```

Open **http://localhost:5173/**. The Vite dev server forwards `/api` and `/media` to the API, so the browser sees one site and the session cookie just works.

Demo accounts (after `npm run seed`): `admin`, `owner`, `manager` (manages Cebu City Residences), `tenant`, all with password `RentEase@2026`. To create your own admin instead, run `npm run create-admin` in `backend/`.

### Settings

Settings are optional. To change them, copy `backend/.env.example` to `backend/.env`. Without `DATABASE_URL`, data is kept in `backend/rentease.sqlite3`. With a Supabase `DATABASE_URL`, the tables are created on first start, and Row Level Security is switched on for them so Supabase's public Data API can't read them.

### One server instead of two

`npm run build` in `frontend/` writes the app to `frontend/dist/`. Then `npm start` in `backend/` serves the React app itself at http://127.0.0.1:8000/ (any page URL returns the app).

### Deploying on Render

Create a **Web Service** from this repository with these settings:

| Setting | Value |
|---|---|
| Root Directory | *(leave empty)* |
| Build Command | `npm run build` |
| Start Command | `npm start` |

The build installs both apps and builds the React app; the API then serves it at your `onrender.com` address. On Render the server listens on all interfaces, trusts Render's HTTPS proxy, and marks cookies Secure by itself.

Environment variables:

- `DATABASE_URL` (strongly recommended): a Supabase/Postgres connection string. **Without it, data lives in a SQLite file that Render erases on every deploy and restart.** Uploaded photos are also erased unless you add a Render Disk.
- `SEED_DEMO_DATA=true` (optional): create the demo accounts and properties on startup (Render's free plan has no shell for `npm run seed`). Also set `DEMO_PASSWORD` to something private, or anyone who reads this README can sign in as `admin`.

To try the Render build locally, stop the dev servers first: on Windows, `npm ci` can't replace `node_modules` while they're running.

### Tests

```bash
cd backend
npm test
```

171 tests cover registration with referral codes, sign-in (including CSRF), role access, property managers, browsing and applying, owner property/unit/application management, leases, rent billing, GCash online and manual payments, receipts, expenses and financial reports, notifications, uploads, and user management. [`test/security.test.js`](backend/test/security.test.js) tries 14 common attacks on the app (admin pages, changing IDs in URLs, negative amounts, faked payments, double-submits, password guessing, script injection, fake uploads, SQL injection, and more) and checks that each one fails.

## Features

### Accounts
- **Register** with a **referral code** from an admin. The code decides the account type (Tenant, Property Owner, or Property Manager), so nobody can pick their own role; a link like `/register?code=K7QX-M2PA` fills the code in. Wrong codes are rate-limited. Admin accounts are only created by an admin. All fields required, unique username and email, password rules (length, common passwords, all-numeric, too similar to your name), passwords stored as PBKDF2 hashes.
- **Sign in** with username or email. **Sign out** from the sidebar or top bar.
- **Role-based dashboards**: each role sees its own dashboard and sidebar. Opening another role's page sends you back to your own dashboard with an error message. Signed-out visitors go to the login page and come back after signing in.
- **Profile**: view and edit your name, email, contact number, and photo. Owners also set their GCash number, account name, and QR code.

### Admins
- **Users & Access**: search and filter all accounts, create accounts with any role, change roles, reset passwords, and deactivate accounts (which signs the person out). Admins can't remove their own Admin role or deactivate themselves.
- **Referral codes**: generate random codes or type a custom one, each for one role, with an optional label. Copy the code or its sign-up link, see how many accounts each code created, and disable codes (or delete unused ones).

### Tenants
- **Browse** properties that have a vacant unit; search by name, address, or city and filter by type and maximum rent.
- **Apply** for a vacant unit with an optional move-in date and message. No past dates, no occupied units, one pending application per unit.
- **My Applications** with status tabs; edit or withdraw while pending.
- **Rent & Payments**: monthly balance, overdue months, credit, history, and the lease (dates, rent, deposit).
- **Pay online with GCash**: choose an amount, pay on the checkout screen, and the payment counts immediately with a printable official receipt. This runs in **sandbox (test) mode**: no real money moves. Real GCash payments need a merchant account with a provider such as PayMongo; `src/gcash.js` is where it would plug in.
- **Already sent GCash?** Submit the 13-digit reference number (and optionally a screenshot) for the owner to confirm. Pending submissions can be cancelled.
- **Notifications** (bell in the top bar): application results, payment confirmations, lease changes, and rent reminders (due within 5 days, and monthly while overdue).

### Property owners
- **My Properties**: add, edit, and delete properties (no duplicates at the same address) and their units (unique names, rent above zero, Vacant/Occupied). **Assign a Property Manager** to a property.
- **Applications**: approve or reject. Approving creates a **12-month lease** at the unit's rent, marks the unit occupied, and rejects the other pending applications for it.
- **Leases**: renew (new end date, optionally a new rent for months not billed yet), terminate (rent stops after this month and the unit becomes vacant), and set the deposit.
- **Rent Payments**: confirm or reject tenants' GCash payments, record cash/bank/other payments (they count immediately), "Mark paid" shortcuts per month, void mistakes, and print receipts.
- **Finances**: record expenses per property (repairs, utilities, taxes...), and see rent received, expenses, and net income per property for any period, with CSV export.
- **Notifications** for new applications and GCash payments to confirm.

### Property managers
- See the properties owners assigned to them (view only), review their applications, confirm their payments, and renew or terminate their leases. Owners keep full control; managers can't edit properties, units, or finances.

### Rent billing
Once approved, the tenant is billed the lease's monthly rent every month from the lease start (move-in, never before approval) to its end date, while the unit is occupied. A terminated or expired lease stops billing. Rent is due on the last day of the month. Confirmed payments are applied to the oldest unpaid month first; anything extra becomes credit for future months.

### Security
- Every API query is filtered by the signed-in user, so other people's records return 404.
- Role checks on every endpoint (401 when signed out, 403 for the wrong role).
- CSRF is checked on every request that changes data, including sign-in and registration.
- Sign-in is cut off for 15 minutes after 10 wrong passwords for an account (or 50 from one address), and one address can create at most 10 accounts an hour. When deployed behind a proxy, set `TRUST_PROXY=1`.
- Money amounts must be positive, so negative amounts and "-1 items" tricks are refused. Requests sent at the same moment (double-submits) can only succeed once.
- The built React page sends a Content-Security-Policy, so the browser only runs the site's own scripts.
- Session tokens are stored only as SHA-256 hashes, and uploads must be real images (checked from the file contents).
- On Supabase, Row Level Security is enabled on all tables at startup so the public Data API can't read them.

## API overview

All endpoints are under `/api/`, in [`backend/src/routes/`](backend/src/routes/). Errors from form validation come back as `400 {"message": "...", "errors": {"field": ["..."]}}`.
