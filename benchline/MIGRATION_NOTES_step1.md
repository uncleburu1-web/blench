# Step 1 Retrofit — Migration Notes

What this covers: the "Retrofit the existing Django models" step from the
architecture doc (`shop-system-architecture.md`, item 10, step 1). This is
the foundation the sync engine (steps 2–3) will build on — no sync code
yet, just the schema and API changes needed to support it later.

## What changed

- **New `core` app models**: `Shop` (tenant) and `SyncModel` (abstract base
  — UUID id, `shop` FK, `created_at`, `updated_at`, `is_deleted`).
- Every existing model (`InventoryItem`, `StockBatch`, `Supplier`, `Worker`,
  `RepairTicket`, `RepairPayment`, `Liability`, `Sale`, `SaleItem`,
  `SaleAllocation`) now inherits `SyncModel` — integer auto-increment PKs
  are gone, replaced with client-generatable UUIDs.
- **`Sale` split into a header + line items.** `Sale` is now the cart
  (customer, staff, payment method, status, amount paid). `SaleItem` is one
  row per product in the cart (what the old single-item `Sale` used to
  hold directly: item, quantity, price, cost, discount, tax rate).
  `SaleAllocation` now points at a `SaleItem`, not a `Sale`.
- **Deletes are soft everywhere.** Every `DELETE` through the API now sets
  `is_deleted=True` instead of removing the row — a hard SQL delete has
  nothing for the future sync engine to replay to other devices. Every
  viewset queryset and every report query filters `is_deleted=False`.
- **Every create is stamped with a shop.** `core.mixins.ShopScopedMixin`
  resolves "the current shop" via `core.utils.get_default_shop()` — a
  single, fixed shop row created on first use. This is a deliberate,
  clearly-marked shim: real multi-tenant auth (a `Shop` per account,
  resolved from the JWT) is scoped for step 2 (`accounts`/`subscriptions`
  apps), not this retrofit. `django.contrib.auth.User` was left alone for
  the same reason — swapping `AUTH_USER_MODEL` is destructive once
  migrations exist, so it's deliberately deferred rather than folded in
  here.

## New/changed endpoints

- `POST /api/sales/` now takes a cart: `{ ...header fields, items: [{item,
  item_name, quantity, unit_price, ...}, ...] }` instead of one item's
  fields directly on the sale. Response shape is a header with a nested
  `items` array and aggregated totals.
- `POST /api/sales/{id}/replace/` is now `POST /api/sales/{id}/replace-item/`.
  If the sale has exactly one item you can still omit `sale_item` from the
  body; a multi-item cart requires naming which line (`sale_item: <uuid>`).

## ⚠️ Breaking changes you need to act on

1. **The database needs to be reset.** Switching every primary key from
   integer to UUID isn't a safe in-place migration — old migration files
   were deleted and replaced with fresh `0001_initial`s per app. If there's
   real data in the Render Postgres instance worth keeping, **export it
   first** (`python manage.py dumpdata > backup.json` against the *old*
   code, before applying these migrations) — I did not attempt an
   automatic data-preserving migration, since guessing at a mapping from
   the old flat `Sale` rows into `Sale`+`SaleItem` without seeing the real
   data risks silently corrupting it. Happy to write that migration for
   real once you confirm what (if anything) needs to be carried over.
2. **The React frontend has been updated to match.** `Sales.jsx` is now a
   proper cart-based POS: a product grid (search + category chips) on the
   left, a live cart with quantity steppers and inline price editing on the
   right, one-tap payment method selection, an installment toggle, and a
   big "Charge ₦X" button that completes the sale and auto-prints the
   receipt. History (completed/outstanding) moved to separate tabs on the
   same page, with "replace item" now able to target a specific line when
   a cart has more than one item. Light/dark mode was also added — a
   toggle in the sidebar (and a floating button on mobile) flips a
   `data-theme` attribute backed by a second set of CSS variables in
   `theme.css`, persisted to `localStorage`. Verified with a real `vite
   build` (clean) and a live end-to-end HTTP test against the Django dev
   server (login → create product → stock it → ring up a cart sale →
   fetch history), not just written and assumed correct.

## How to run it locally

```bash
cd benchline/backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
USE_SQLITE=True python manage.py migrate
USE_SQLITE=True python manage.py createsuperuser
USE_SQLITE=True python manage.py runserver
```

`USE_SQLITE=True` points at a throwaway local SQLite file instead of the
Render Postgres instance in settings — safe to migrate/reset freely while
testing. Drop `USE_SQLITE` (and set `DATABASE_URL`) to point at Postgres
once you're ready to reset the real database.

## Verified end-to-end (against a live Django instance, not just read)

- `makemigrations` / `migrate` run clean, no errors.
- Created products + stock batches, rang up a real multi-item cart sale —
  FEFO stock allocation, per-item and header totals, profit, and margin all
  computed correctly.
- `replace-item` swaps a cart line, restores stock for the old item,
  deducts stock (FEFO) for the new one, and reports the balance owed/refund
  correctly.
- Deleting a sale restores stock for every line, soft-deletes the sale and
  its items, and is correctly excluded from listings, the dashboard, and
  every report (sales-by-item, best-selling, by-category, by-staff,
  by-customer, payment-method, tax, net-worth).
- Suppliers, Workers, Repairs (with sequential per-shop ticket numbers and
  the payment ledger), and Liabilities all still work unchanged, now with
  soft-delete.

## What's still ahead (per the architecture doc)

- Step 2: `subscriptions`, `devices`, `sync` apps — `SyncOperation`,
  `AuditLog` models, subscription status.
- Step 3: `/sync/push/` and `/sync/pull/` endpoints with idempotency.
- Step 4 onward: the Flutter desktop skeleton, local SQLite mirror, outbox,
  sync engine — the Flutter POS screen would eventually replace this React
  page, following the same cart UX now proven out here.
