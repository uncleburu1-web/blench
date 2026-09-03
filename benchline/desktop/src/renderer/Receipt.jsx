import { money, fmtDateTime } from './format.js';

/**
 * Real shop details, transcribed from the handwritten registration note.
 * Two fields were genuinely hard to read off the handwriting and are
 * flagged back to Wusup in chat to confirm — SHOP_NAME and EMAIL. Fix
 * them here once confirmed; nothing else needs to change.
 */
const SHOP = {
  name: 'SI Everyday Wine Shop',
  addressLines: ['Block B, Shop 31 & 32'],
  phones: ['0806 377 3201'],
  email: 'ogbejoshua42@gmail.com',
};

const SOFTWARE_CREDIT = 'Software by Gavin\'s Software Solutions (GSS)';

/**
 * The receipt that prints immediately after a sale completes (see
 * PosScreen's `charge()` — it renders this into `.receipt-print`, which
 * is invisible on screen and the ONLY thing visible when window.print()
 * runs, via the CSS in theme.css).
 *
 * Design: the overall skeleton (shop header -> invoice -> items -> totals
 * -> "attended by" / thank-you -> software-credit footer) follows the
 * "Day Varieties" reference receipt; the item and totals line formatting
 * ("N Units x price / Units", GRAND TOTAL / Total Invoice Amount /
 * Discount Amount rows) follows the Royalline Technologies reference.
 * `Wallet Balance` from that second reference is deliberately left out —
 * this system has no wallet/credit-balance concept, so an always-N0 row
 * would just be noise.
 */
export default function Receipt({ sale, cashReceived, change }) {
  if (!sale) return null;
  const isCash = sale.payment_method === 'cash';
  const paymentLabel = sale.payment_method === 'pos'
    ? 'POS/Card'
    : sale.payment_method[0].toUpperCase() + sale.payment_method.slice(1);

  // Local (offline) sales don't carry top-level subtotal/discount the way
  // the cloud Sale model does — derive them from the line items, which
  // always have both.
  const itemsSubtotal = sale.items.reduce((s, i) => s + i.subtotal, 0);
  const itemsDiscount = sale.items.reduce((s, i) => s + Number(i.discount || 0), 0);

  return (
    <div className="receipt-print">
      <div className="receipt-center receipt-shop">{SHOP.name}</div>
      {SHOP.addressLines.map((line) => (
        <div className="receipt-center receipt-sub" key={line}>{line}</div>
      ))}
      {SHOP.phones.map((p) => (
        <div className="receipt-center receipt-sub" key={p}>Tel: {p}</div>
      ))}
      <div className="receipt-center receipt-sub">{SHOP.email}</div>

      <div className="receipt-divider" />
      <div className="receipt-row">
        <span>Invoice</span>
        <span>{sale.invoice_number ? `#${sale.invoice_number}` : `#${(sale.id || '—').slice(0, 8).toUpperCase()}`}</span>
      </div>
      <div className="receipt-row">
        <span>Date</span>
        <span>{fmtDateTime(sale.date)}</span>
      </div>
      <div className="receipt-row">
        <span>Customer</span>
        <span>{sale.customer_name || 'Walk-in'}</span>
      </div>

      <div className="receipt-divider" />
      {sale.items.map((item) => (
        <div className="receipt-item" key={item.id || item.item_name}>
          <div className="receipt-row">
            <span>{item.item_name}</span>
            <span>{money(item.total)}</span>
          </div>
          <div className="receipt-row receipt-item-sub">
            <span>{item.quantity} Units x {money(item.unit_price)} / Units</span>
          </div>
        </div>
      ))}

      <div className="receipt-divider" />
      <div className="receipt-row receipt-total">
        <span>GRAND TOTAL</span>
        <span>{money(itemsSubtotal)}</span>
      </div>
      <div className="receipt-row">
        <span>Discount Amount</span>
        <span>{money(itemsDiscount)}</span>
      </div>
      <div className="receipt-row receipt-total">
        <span>Total Invoice Amount</span>
        <span>{money(sale.total)}</span>
      </div>

      <div className="receipt-divider" />
      <div className="receipt-row">
        <span>Payment ({paymentLabel})</span>
        <span>{money(sale.total)}</span>
      </div>
      {isCash && (
        <>
          <div className="receipt-row">
            <span>Received</span>
            <span>{money(cashReceived)}</span>
          </div>
          <div className="receipt-row">
            <span>Change</span>
            <span>{money(change)}</span>
          </div>
        </>
      )}
      {sale.status === 'outstanding' && (
        <div className="receipt-row receipt-total">
          <span>Balance due</span>
          <span>{money(sale.balance_due)}</span>
        </div>
      )}

      <div className="receipt-divider" />
      <div className="receipt-center receipt-sub">Attended by {sale.staff_name || '—'}</div>
      <div className="receipt-center receipt-sub">Thanks for your patronage!!!</div>
      <div className="receipt-center receipt-sub">Goods received in good condition.</div>

      <div className="receipt-divider" />
      <div className="receipt-center receipt-sub">{SOFTWARE_CREDIT}</div>
    </div>
  );
}
