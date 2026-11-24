# RentEase (React version)

RentEase connects **property owners**, **tenants**, **staff**, and **administrators** in one web app. Owners list properties and units, tenants find and apply for rentals, owners approve applications, and rent is billed monthly and paid through GCash or in person.

This is the React version of the original Django app. The pages are now a **React single-page app**; Django stays as the **JSON API** behind it, so the data model, validation rules, and rent billing are the same.

| Layer | Technology |
|---|---|
| Frontend | **React 19** + **React Router**, built with **Vite** (`frontend/`) |
| Styling | **Tailwind CSS v4** plus the original RentEase stylesheet, light and dark theme |
| Backend | **Django 6** + **Django REST Framework**, JSON API under `/api/` (`backend/`) |
| Database | **PostgreSQL** on **Supabase** (or local SQLite when `DATABASE_URL` is not set) |
| Authentication | Django sessions (cookie) with CSRF protection; hashed passwords |

## Project layout

```
backend/            Django project: the API, models, billing, and Django admin
  accounts/         users and roles, sign in/out, register, profile, dashboards (api.py)
  properties/       properties, units, applications (api.py)
  payments/         monthly rent charges, GCash and in-person payments (api.py, billing.py)
  config/           settings, URL routes (api_urls.py lists every endpoint)
frontend/           React app
  src/pages/        one component per page (auth, dashboards, tenant/, owner/)
  src/components/   layout, sidebar, form fields, badges, tables
  src/lib/api.js    fetch wrapper (sends the CSRF token)
```

## Running it locally

You need **Python 3.12+** and **Node 20+**.

**Quick start (Windows):** copy `backend/.env.example` to `backend/.env`, fill it in, then double-click `run.bat`. It installs everything the first time, starts both servers, and opens http://localhost:5173/.

**Manually:**

```bash
# 1. Backend (terminal 1)
cd backend
python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env           # then edit .env (macOS/Linux: cp)
python manage.py migrate
python manage.py seed_demo_users          # optional demo accounts
python manage.py seed_demo_properties     # optional demo listings
python manage.py runserver                # http://127.0.0.1:8000

# 2. Frontend (terminal 2)
cd frontend
npm install
npm run dev                               # http://localhost:5173
```

Open **http://localhost:5173/**. The Vite dev server forwards `/api`, `/media`, and `/django-admin` to Django, so the browser sees one site and the session cookie just works.

Demo accounts (after `seed_demo_users`): `admin`, `owner`, `tenant`, `staff`, all with password `RentEase@2026`.

### One server instead of two

`npm run build` in `frontend/` writes the app to `frontend/dist/`. Restart Django and it serves the React app itself at http://127.0.0.1:8000/ (any page URL returns the app; its files are served under `/static/`).

### Tests

```bash
cd backend
python manage.py test
```

92 tests cover registration, sign-in (including CSRF), role access, browsing and applying, owner property/unit/application management, rent billing, and GCash/in-person payments.

## Features

### Accounts
- **Register** as a Tenant or Property Owner (Admin and Staff accounts are created in the Django admin). All fields required, unique username and email, Django password rules, passwords stored as PBKDF2 hashes.
- **Sign in** with username or email. **Sign out** from the sidebar or top bar.
- **Role-based dashboards**: each role sees its own dashboard and sidebar. Opening another role's page sends you back to your own dashboard with an error message. Signed-out visitors go to the login page and come back after signing in.
- **Profile**: view and edit your name, email, contact number, and photo. Owners also set their GCash number, account name, and QR code.

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
- On Supabase, Row Level Security is enabled on all tables after each `migrate` so the public Data API can't read them.

## API overview

All endpoints are under `/api/` and listed in [`backend/config/api_urls.py`](backend/config/api_urls.py). Errors from form validation come back as `400 {"message": "...", "errors": {"field": ["..."]}}`.
