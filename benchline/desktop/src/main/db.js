const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Opens (creating if needed) the local SQLite database and applies the
 * schema. This is the ONLY database the POS reads from and writes to for
 * every normal operation — see repository functions below. The sync
 * engine (separate module) is the only thing that ever talks to the
 * cloud, and it only ever *reads* from here (the outbox) and *writes*
 * back confirmations — it never sits in the path of a sale being rung up.
 */
function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate(db);
  return db;
}

/**
 * schema.sql only uses `CREATE TABLE IF NOT EXISTS`, so a column added to
 * an existing table's definition there is silently a no-op for any
 * database file that already exists (e.g. whatever's already on a shop's
 * machine) — SQLite never had a chance to see the new column. There's no
 * migration framework here (overkill for a handful of columns so far), so
 * new columns get a one-line ALTER TABLE guarded by a PRAGMA check,
 * appended to this function as they're added. Safe to run on every open:
 * each ALTER is skipped once the column exists.
 */
function migrate(db) {
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  if (!hasColumn('products', 'barcode')) {
    db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL');
  if (!hasColumn('sync_queue', 'next_attempt_at')) {
    db.exec('ALTER TABLE sync_queue ADD COLUMN next_attempt_at TEXT');
  }
  if (!hasColumn('sales', 'invoice_number')) {
    db.exec('ALTER TABLE sales ADD COLUMN invoice_number INTEGER');
  }
  if (!hasColumn('customers', 'email')) {
    db.exec('ALTER TABLE customers ADD COLUMN email TEXT');
    db.exec('ALTER TABLE customers ADD COLUMN address TEXT');
    db.exec('ALTER TABLE customers ADD COLUMN notes TEXT');
  }
  if (!hasColumn('sales', 'customer_id')) {
    db.exec('ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES customers(id)');
  }
}

/**
 * The next sequential invoice number, scoped to this desktop's local
 * database only (see Sale.invoice_number's help_text on the Django model
 * for why it's not a globally-coordinated number). Reads-then-writes a
 * single app_settings row; safe without extra locking because it only
 * ever runs inside createSale's db.transaction(), which better-sqlite3
 * executes synchronously — nothing else can interleave.
 */
function nextInvoiceNumber(db) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'next_invoice_number'`).get();
  const next = row ? Number(row.value) : 1;
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('next_invoice_number', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(next + 1));
  return next;
}

/**
 * Appends one outbox row. Every write to shop data goes through this so
 * the sync engine has something to push later. Deliberately NOT called
 * for stock_batch quantity_remaining deductions caused by a sale — per
 * the architecture's conflict-resolution design, inventory is never
 * synced as a snapshot number. The cloud derives stock by independently
 * applying the same 'sale'/'sale_item' create operations this queue
 * already carries, via its own FEFO logic — syncing the batch row too
 * would double-apply the deduction and could never be reconciled if two
 * devices sold from the same batch while both offline.
 */
function enqueueSync(db, { entityType, entityId, operation, payload }) {
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, client_timestamp, status, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`
  ).run(uuid(), entityType, entityId, operation, JSON.stringify(payload), nowIso());
}

// ---------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------

function createProduct(db, { name, short_code = '', barcode = null, category = 'other', unit = 'PIECE', sell_price = 0, min_stock = 2 }) {
  const id = uuid();
  const ts = nowIso();
  const cleanBarcode = barcode && barcode.trim() ? barcode.trim() : null; // '' -> null, see idx_products_barcode
  try {
    db.prepare(
      `INSERT INTO products (id, name, short_code, barcode, category, unit, sell_price, min_stock, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(id, name, short_code, cleanBarcode, category, unit, sell_price, min_stock, ts, ts);
  } catch (err) {
    if (cleanBarcode && /UNIQUE constraint failed: products\.barcode/.test(err.message)) {
      throw new Error(`Barcode "${cleanBarcode}" is already used by another product.`);
    }
    throw err;
  }
  const row = getProduct(db, id);
  enqueueSync(db, { entityType: 'product', entityId: id, operation: 'create', payload: row });
  return row;
}

function getProduct(db, id) {
  const row = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, ...computeStockFields(db, id) };
}

function computeStockFields(db, productId) {
  const batches = db.prepare(
    `SELECT * FROM stock_batches WHERE product_id = ? AND is_deleted = 0`
  ).all(productId);
  const quantity = batches.reduce((sum, b) => sum + b.quantity_remaining, 0);
  const remainingWithStock = batches.filter((b) => b.quantity_remaining > 0);
  const totalQty = remainingWithStock.reduce((s, b) => s + b.quantity_remaining, 0);
  const costPrice = totalQty
    ? remainingWithStock.reduce((s, b) => s + b.quantity_remaining * b.cost_price, 0) / totalQty
    : 0;
  return { quantity, cost_price: Math.round(costPrice * 100) / 100 };
}

function listProducts(db, { category = null, search = '' } = {}) {
  let rows = db.prepare(`SELECT * FROM products WHERE is_deleted = 0 ORDER BY name`).all();
  if (category && category !== 'all') rows = rows.filter((r) => r.category === category);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => `${r.name} ${r.short_code || ''} ${r.barcode || ''}`.toLowerCase().includes(q));
  }
  return rows.map((r) => ({ ...r, ...computeStockFields(db, r.id) }));
}

function createCustomer(db, { name, phone = '', email = '', address = '', notes = '' }) {
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO customers (id, name, phone, email, address, notes, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, name, phone, email, address, notes, ts, ts);
  const row = getCustomer(db, id);
  enqueueSync(db, { entityType: 'customer', entityId: id, operation: 'create', payload: row });
  return row;
}

function getCustomer(db, id) {
  return db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id);
}

function listCustomers(db, { search = '' } = {}) {
  let rows = db.prepare(`SELECT * FROM customers WHERE is_deleted = 0 ORDER BY name`).all();
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => `${r.name} ${r.phone || ''} ${r.email || ''}`.toLowerCase().includes(q));
  }
  // What each customer currently owes across their own not-yet-fully-paid
  // sales — computed locally so it works offline, same reasoning as
  // CustomerViewSet.balance on the cloud side (sales/../customers/views.py).
  return rows.map((r) => {
    const outstanding = db.prepare(
      `SELECT amount_paid, id FROM sales WHERE customer_id = ? AND status = 'outstanding' AND is_deleted = 0`
    ).all(r.id);
    const balanceDue = outstanding.reduce((sum, s) => {
      const sale = getSale(db, s.id);
      return sum + (sale ? sale.balance_due : 0);
    }, 0);
    return { ...r, balance_due: balanceDue, outstanding_sale_count: outstanding.length };
  });
}

function addStockBatch(db, { product_id, batch_number = '', quantity_received, cost_price = 0, expiry_date = null }) {
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO stock_batches
       (id, product_id, batch_number, quantity_received, quantity_remaining, cost_price, expiry_date, received_date, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, product_id, batch_number, quantity_received, quantity_received, cost_price, expiry_date, ts, ts, ts);
  const row = db.prepare(`SELECT * FROM stock_batches WHERE id = ?`).get(id);
  // Batch CREATION (new stock arriving) is genuinely new business data the
  // cloud needs — unlike deductions from a sale, this isn't derivable from
  // anything else, so it does get its own sync op.
  enqueueSync(db, { entityType: 'stock_batch', entityId: id, operation: 'create', payload: row });
  return row;
}

// ---------------------------------------------------------------------
// Sales (cart header + line items), FEFO allocation — mirrors the cloud
// Django implementation in sales/views.py exactly, so behavior is
// identical whether a sale happens offline or online.
// ---------------------------------------------------------------------

function allocateStock(db, saleItemId, productId, quantity) {
  if (!productId) return { unitCost: 0 };
  const batches = db.prepare(
    `SELECT * FROM stock_batches
     WHERE product_id = ? AND quantity_remaining > 0 AND is_deleted = 0
     ORDER BY (expiry_date IS NULL), expiry_date, received_date`
  ).all(productId);

  let remaining = quantity;
  let totalCost = 0;
  let totalTaken = 0;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity_remaining, remaining);
    db.prepare(`UPDATE stock_batches SET quantity_remaining = quantity_remaining - ?, updated_at = ? WHERE id = ?`)
      .run(take, nowIso(), batch.id);
    db.prepare(`INSERT INTO sale_allocations (id, sale_item_id, batch_id, quantity) VALUES (?, ?, ?, ?)`)
      .run(uuid(), saleItemId, batch.id, take);
    totalCost += take * batch.cost_price;
    totalTaken += take;
    remaining -= take;
  }
  return { unitCost: totalTaken ? Math.round((totalCost / totalTaken) * 100) / 100 : 0, shortfall: remaining };
}

function restoreStock(db, saleItemId) {
  const allocations = db.prepare(`SELECT * FROM sale_allocations WHERE sale_item_id = ?`).all(saleItemId);
  for (const alloc of allocations) {
    if (alloc.batch_id) {
      db.prepare(`UPDATE stock_batches SET quantity_remaining = quantity_remaining + ?, updated_at = ? WHERE id = ?`)
        .run(alloc.quantity, nowIso(), alloc.batch_id);
    }
  }
  db.prepare(`DELETE FROM sale_allocations WHERE sale_item_id = ?`).run(saleItemId);
}

function computeItemTotals(item) {
  const subtotal = item.unit_price * item.quantity;
  const total = subtotal - item.discount;
  const profit = (item.unit_price - item.unit_cost) * item.quantity - item.discount;
  return { subtotal, total, profit };
}

function getSale(db, saleId) {
  const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
  if (!sale) return null;
  const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ? AND is_deleted = 0 ORDER BY rowid`).all(saleId);
  const itemsWithTotals = items.map((i) => ({ ...i, ...computeItemTotals(i) }));
  const total = itemsWithTotals.reduce((s, i) => s + i.total, 0);
  const profit = itemsWithTotals.reduce((s, i) => s + i.profit, 0);
  const balance_due = sale.status === 'completed' ? 0 : Math.max(total - sale.amount_paid, 0);
  return { ...sale, items: itemsWithTotals, total: Math.round(total * 100) / 100, profit: Math.round(profit * 100) / 100, balance_due };
}

/**
 * Rings up a cart. Fully offline-capable: nothing here touches the
 * network. Wrapped in a single SQLite transaction so a crash mid-sale
 * can never leave stock half-deducted with no sale row to explain it.
 */
const createSale = (db) => db.transaction((input) => {
  const saleId = uuid();
  const ts = nowIso();
  const status = input.status || 'completed';
  const invoiceNumber = nextInvoiceNumber(db);

  db.prepare(
    `INSERT INTO sales (id, invoice_number, customer_id, customer_name, staff_name, payment_method, status, amount_paid, date, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(saleId, invoiceNumber, input.customer_id || null, input.customer_name || 'Walk-in', input.staff_name || '', input.payment_method || 'cash', status, input.amount_paid || 0, ts, ts, ts);

  for (const item of input.items) {
    const itemId = uuid();
    db.prepare(
      `INSERT INTO sale_items (id, sale_id, product_id, item_name, category, quantity, unit_price, unit_cost, discount, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(itemId, saleId, item.product_id || null, item.item_name, item.category || '', item.quantity, item.unit_price, item.unit_cost || 0, item.discount || 0, ts, ts);

    if (item.product_id) {
      const { unitCost } = allocateStock(db, itemId, item.product_id, item.quantity);
      if (unitCost) db.prepare(`UPDATE sale_items SET unit_cost = ? WHERE id = ?`).run(unitCost, itemId);
    }
  }

  const sale = getSale(db, saleId);
  if (status === 'completed' && sale.amount_paid !== sale.total) {
    db.prepare(`UPDATE sales SET amount_paid = ? WHERE id = ?`).run(sale.total, saleId);
  }

  const finalSale = getSale(db, saleId);
  enqueueSync(db, { entityType: 'sale', entityId: saleId, operation: 'create', payload: finalSale });
  for (const item of finalSale.items) {
    enqueueSync(db, { entityType: 'sale_item', entityId: item.id, operation: 'create', payload: item });
  }
  return finalSale;
});

const deleteSale = (db) => db.transaction((saleId) => {
  const sale = getSale(db, saleId);
  if (!sale) return null;
  const ts = nowIso();
  for (const item of sale.items) {
    restoreStock(db, item.id);
    db.prepare(`UPDATE sale_items SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(ts, item.id);
  }
  db.prepare(`UPDATE sales SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(ts, saleId);
  enqueueSync(db, { entityType: 'sale', entityId: saleId, operation: 'delete', payload: { id: saleId } });
  return true;
});

const addPayment = (db) => db.transaction((saleId, amount) => {
  const sale = getSale(db, saleId);
  const newPaid = Math.min(sale.amount_paid + amount, sale.total);
  const newStatus = newPaid >= sale.total ? 'completed' : sale.status;
  db.prepare(`UPDATE sales SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(newPaid, newStatus, nowIso(), saleId);
  const updated = getSale(db, saleId);
  enqueueSync(db, { entityType: 'sale', entityId: saleId, operation: 'update', payload: updated });
  return updated;
});

function listSales(db, { status = null } = {}) {
  let rows = db.prepare(`SELECT id FROM sales WHERE is_deleted = 0 ORDER BY date DESC`).all();
  let sales = rows.map((r) => getSale(db, r.id));
  if (status) sales = sales.filter((s) => s.status === status);
  return sales;
}

module.exports = {
  openDb,
  uuid,
  nowIso,
  enqueueSync,
  createProduct,
  getProduct,
  listProducts,
  createCustomer,
  getCustomer,
  listCustomers,
  addStockBatch,
  createSale,
  deleteSale,
  addPayment,
  listSales,
  getSale,
};
