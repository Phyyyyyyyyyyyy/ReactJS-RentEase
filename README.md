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
  src/routes/       accounts.js, properties.js, payments.js, admin.js: every /api endpoint
  src/billing.js    monthly rent charges and balances
  src/schema.js     database tables
  src/lib/          sessions + CSRF, form validation, passwords, uploads
  scripts/          seed.js (demo data), create-admin.js
  test/             API tests (node --test)
frontend/           React app
  src/pages/        one component per page (auth, dashboards, tenant/, owner/, admin/)
  src/components/   layout, sidebar, form fields, badges, tables
  src/lib/api.js    fetch wrapper (sends the CSRF token)
```

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

Demo accounts (after `npm run seed`): `admin`, `owner`, `tenant`, `staff`, all with password `RentEase@2026`. To create your own admin instead, run `npm run create-admin` in `backend/`.

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

124 tests cover registration, sign-in (including CSRF), role access, browsing and applying, owner property/unit/application management, rent billing, GCash/in-person payments, uploads, and user management. [`test/security.test.js`](backend/test/security.test.js) tries 14 common attacks on the app (admin pages, changing IDs in URLs, negative amounts, faked payments, double-submits, password guessing, script injection, fake uploads, SQL injection, and more) and checks that each one fails.

## Features

### Accounts
- **Register** as a Tenant or Property Owner (Admin and Staff accounts are created by an admin). All fields required, unique username and email, password rules (length, common passwords, all-numeric, too similar to your name), passwords stored as PBKDF2 hashes.
- **Sign in** with username or email. **Sign out** from the sidebar or top bar.
- **Role-based dashboards**: each role sees its own dashboard and sidebar. Opening another role's page sends you back to your own dashboard with an error message. Signed-out visitors go to the login page and come back after signing in.
- **Profile**: view and edit your name, email, contact number, and photo. Owners also set their GCash number, account name, and QR code.

### Admins
- **Users & Access**: search and filter all accounts, create accounts with any role, change roles, reset passwords, and deactivate accounts (which signs the person out). Admins can't remove their own Admin role or deactivate themselves.

### Tenants
- **Browse** properties that have a vacant unit; search by name, address, or city and filter by type and maximum rent.
- **Apply** for a vacant unit with an optional move-in date and message. No past dates, no occupied units, one pending application per unit.
- **My Applications** with status tabs; edit or withdraw while pending.
- **Rent & Payments**: monthly balance, overdue months, credit, and history. **Pay with GCash**: send to the owner's number or QR code, then submit the 13-digit reference number (and optionally a receipt screenshot). Pending submissions can be cancelled.

### Property owners
- **My Properties**: add, edit, and delete properties (no duplicates at the same address) and their units (unique names, rent above zero, Vacant/Occupied).
- **Applications**: approve or reject. Approving marks the unit occupied and rejects the other pending applications for it.
- **Rent Payments**: confirm or reject tenants' GCash payments, record cash/bank/other payments (they count immediately), "Mark paid" shortcuts per month, and void mistakes.

### Rent billing
Once approved, the tenant is billed the unit's rent every month while the unit is occupied, starting the month of move-in (never before approval). Rent is due on the last day of the month. Confirmed payments are applied to the oldest unpaid month first; anything extra becomes credit for future months.

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
