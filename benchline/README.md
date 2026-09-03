# Benchline — Shop Management System

A real full-stack shop management system for a laptop sales & repair shop
(or any small retail/service business): batch-tracked inventory, completed
vs. installment sales, a full reports suite, liabilities & net worth, and
role-based staff accounts.

- **Backend:** Django + Django REST Framework, JWT auth, Postgres
- **Frontend:** React (Vite), React Router, Axios
- Fully responsive: sidebar nav on desktop/tablet, bottom tab bar on phone.

## What's inside

**Inventory** — items with batch tracking (batch number, quantity received,
cost price, selling price, expiry date, supplier). Expiry date is optional —
tick "No expiring date" for stock that doesn't expire. Batches are editable
after the fact (correcting a typo'd quantity automatically adjusts what's
left in stock, and won't let you drop below what's already been sold). Stock
quantity and weighted-average cost are computed automatically from batches.
Low-stock and expiring-batch alerts.

**Sales** — two tabs: **Completed** (paid in full) and **Outstanding**
(installment/part-payment). Record a payment against an outstanding sale at
any time; once fully paid it automatically moves to Completed. Sales linked
to a stock item deduct quantity FEFO (first-expiry-first-out) across batches.
A **Replace** button lets you swap what was sold for something else (e.g. a
customer bought a ₦5,000 charger and wants a ₦6,000 one instead) — stock is
restored/deducted correctly and the balance is calculated for you (pay more,
or refund). Each sale has a **Print** button that opens a receipt formatted
like the shop's own invoice book, auto-filled (item, customer, date, total,
amount in words) — only the signature is left blank for a manual sign.

**Repairs** — ticket-based repair tracking, auto-numbered (`RPR-0001`),
status flow from Received → Diagnosing → In repair → Ready → Collected. Each
ticket tracks payment as **Paid** or **Installment**, with its own
add-payment flow — money collected on repairs counts toward the shop's total
sales figures on the Dashboard and in Reports.

**Reports** — Sales summary (chart + totals, filterable by day or month),
Sales by item, Best-selling (ranked), Sales by category, Sales by staff,
Payment method breakdown, Sales by customer, Tax report, Expiring inventory,
Inventory valuation (what your stock is worth, potential profit, margin).

**Liabilities & net worth** — track rent, loans, utility bills, etc. against
the shop's assets (inventory value + money customers still owe you) to see
net worth and a risk level (how much of what you're worth is owed out).

**Workers** — the owner can add **sellers** with a real login so they can
sign in and make sales themselves (their name is auto-attached to every sale
they record). The owner can also just keep a roster of other staff
(technicians, attendants) without giving them system access. Sellers are
blocked from Reports, Liabilities, and Workers management — those stay
owner-only.

---

## Option A — Run everything with Docker (fastest)

Requires Docker and Docker Compose installed. This spins up its own local
Postgres container (not the hosted Render database) so the whole stack runs
self-contained and offline.

```bash
docker compose up --build
```

This starts:
- Postgres on `localhost:5432`
- Django API on `http://localhost:8000`
- React app on `http://localhost:3000`

The backend container runs migrations automatically on startup. You still
need an owner login — in a second terminal:

```bash
docker compose exec backend python manage.py createsuperuser
```

Open `http://localhost:3000` and log in with that username/password — this
is your **owner** account, with access to everything.

---

## Option B — Run manually (for development)

### 1. Database

By default, the backend connects to the shop's **hosted Postgres on
Render** — nothing to set up, it just works out of the box. If you want to
use a different database instead (your own local Postgres, a staging DB,
etc.), set `DATABASE_URL` in `backend/.env`:

```bash
DATABASE_URL=postgresql://user:password@host:port/dbname
```

Or, for a quick local check with no Postgres at all, set `USE_SQLITE=True`
in `.env`.

If you do want a local Postgres for development:

```bash
docker run --name gps-laptop-db -e POSTGRES_DB=benchline \
  -e POSTGRES_USER=benchline -e POSTGRES_PASSWORD=benchline \
  -p 5432:5432 -d postgres:16-alpine
```
then set `DATABASE_URL=postgresql://benchline:benchline@localhost:5432/benchline`
in `.env`.

### 2. Backend (Django)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # edit if your DB creds differ

python manage.py migrate
python manage.py createsuperuser # this is your owner login
python manage.py runserver       # http://localhost:8000
```

### 3. Frontend (React)

```bash
cd frontend
npm install
cp .env.example .env             # points at http://localhost:8000/api by default
npm run dev                      # http://localhost:5173
```

Log in with the superuser you created — that's the owner account.

### 4. Add a seller (optional)

Once logged in as the owner, go to **Workers → Add worker**, pick role
**Seller**, tick "Give this worker a system login," and set a username and
password. They can now log in separately and make sales — but won't see
Reports, Liabilities, or Workers in their sidebar.

---

## Project layout

```
benchline/
  backend/
    benchline/        # Django project settings & urls
    core/              # health check, /me, dashboard stats & activity feed, shared permissions
    staff/             # Worker model — sellers with login + general staff roster
    suppliers/         # Supplier records (linkable from stock batches)
    inventory/         # Items + StockBatch (batch tracking, FEFO, low-stock/expiry)
    repairs/           # Repair tickets — CRUD, auto ticket numbers, status flow
    sales/             # Sales — completed/outstanding, add-payment, stock deduction
    liabilities/       # Rent/loans/bills tracked against shop net worth
    reports/           # All report endpoints (summary, by item/category/staff/customer, tax, valuation…)
    requirements.txt
    Dockerfile
    .env.example
  frontend/
    src/
      api/             # axios client (JWT + auto-refresh) and endpoint wrappers
      context/          # AuthContext (login/logout/me, isOwner flag)
      components/       # Layout (role-aware sidebar + bottom nav), icons, route guards
      pages/            # Login, Dashboard, Inventory, Repairs, Sales, Reports, Liabilities, Workers
      theme.css         # shared design tokens & styles
    Dockerfile
    .env.example
  docker-compose.yml
```

## API overview

All endpoints (except `/api/health/` and login) require a JWT access token:

```
Authorization: Bearer <token>
```

Endpoints under Reports, Liabilities, and Workers return `403` for
non-owner accounts.

| Method | Endpoint                                   | Purpose                                    |
|--------|----------------------------------------------|---------------------------------------------|
| POST   | `/api/auth/login/`                            | Get access + refresh tokens                  |
| POST   | `/api/auth/refresh/`                          | Refresh an access token                      |
| GET    | `/api/me/`                                     | Current user info (role, owner flag)         |
| GET    | `/api/dashboard/stats/`                       | Stock value, low-stock count, etc.           |
| GET    | `/api/dashboard/activity/`                    | Merged recent-activity feed                  |
| GET/POST | `/api/inventory/items/`                     | List / create stock items (owner writes)     |
| GET/PATCH/DELETE | `/api/inventory/items/{id}/`         | Item detail incl. batches                    |
| GET/POST | `/api/inventory/items/{id}/batches/`        | List / add a stock batch to an item          |
| GET/PATCH/DELETE | `/api/inventory/batches/{id}/`       | Edit / remove a batch directly               |
| GET/POST | `/api/suppliers/`                           | Supplier records                             |
| GET/POST | `/api/repairs/tickets/`                     | Repair tickets                               |
| POST   | `/api/repairs/tickets/{id}/add-payment/`      | Record a payment on a repair ticket          |
| GET/POST | `/api/sales/`                                | Sales — filter `?status=completed|outstanding` |
| POST   | `/api/sales/{id}/add-payment/`                | Record an installment payment                |
| POST   | `/api/sales/{id}/replace/`                    | Swap the item sold; returns balance owed/refund |
| GET/POST | `/api/liabilities/`                         | Rent, loans, bills (owner only)              |
| GET/POST | `/api/workers/`                             | Manage sellers/staff (owner only)            |
| GET    | `/api/reports/sales-summary/`                | `?date=YYYY-MM-DD` or `?month=YYYY-MM`       |
| GET    | `/api/reports/sales-by-item/`                | Per-item totals, cost, profit, margin        |
| GET    | `/api/reports/best-selling/`                 | Ranked top sellers                           |
| GET    | `/api/reports/sales-by-category/`            | Grouped by item category                     |
| GET    | `/api/reports/sales-by-staff/`                | Grouped by seller                            |
| GET    | `/api/reports/payment-method/`               | Cash / transfer / POS breakdown              |
| GET    | `/api/reports/sales-by-customer/`            | Per-customer totals + outstanding balance    |
| GET    | `/api/reports/tax/`                           | Tax collected by rate                        |
| GET    | `/api/reports/expiring-inventory/?days=30`   | Batches nearing expiry                       |
| GET    | `/api/reports/inventory-valuation/`          | What the shop's stock is worth               |
| GET    | `/api/reports/net-worth/`                     | Assets vs. liabilities                       |

Search: append `?search=term` to most list endpoints.

## Notes on production deployment

- Set a real `SECRET_KEY`, `DEBUG=False`, and proper `ALLOWED_HOSTS` in the
  backend `.env` before deploying anywhere public.
- Put the Django app behind a real web server (the Dockerfile already uses
  gunicorn) and serve the React build as static files behind Nginx (also
  already set up in `frontend/Dockerfile`).
- Add HTTPS (e.g. via a reverse proxy like Caddy, Nginx + certbot, or your
  hosting provider) before this touches real customer data.
