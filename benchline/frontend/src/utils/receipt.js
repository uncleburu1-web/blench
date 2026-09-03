import { money } from './format';
import { amountToWords } from './numberToWords';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function printSaleReceipt(sale) {
  const date = new Date(sale.date || Date.now());
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const invoiceNo = String(sale.id).slice(0, 8).toUpperCase();
  const total = Number(sale.total || 0);
  const naira = Math.floor(total);
  const kobo = Math.round((total - naira) * 100);
  const items = sale.items && sale.items.length ? sale.items : [
    { quantity: sale.quantity, item_name: sale.item_name, unit_price: sale.unit_price, total: sale.total },
  ];
  const itemRows = items
    .map(
      (it) => `
        <tr>
          <td>${it.quantity}</td>
          <td>${escapeHtml(it.item_name)}</td>
          <td>${money(it.unit_price)}</td>
          <td>${money(it.total)}</td>
        </tr>`
    )
    .join('');
  const blankRowsNeeded = Math.max(0, 3 - items.length);
  const blankRows = '<tr class="blank-row"><td>&nbsp;</td><td></td><td></td><td></td></tr>'.repeat(blankRowsNeeded);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Invoice ${invoiceNo}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; padding: 24px; color: #1b2a4a; }
  .sheet { max-width: 720px; margin: 0 auto; border: 2px solid #2c4a7c; padding: 22px; }
  .header { text-align: center; }
  .shop-name { font-size: 30px; font-weight: bold; letter-spacing: 2px; color: #2c4a7c; margin: 0; }
  .banner { background: #2c4a7c; color: #fff; padding: 6px 16px; display: inline-block; font-weight: bold; letter-spacing: 1px; border-radius: 3px; margin: 6px 0; }
  .desc { font-size: 12px; margin: 4px 0; }
  .motto { font-style: italic; font-size: 12px; }
  .meta-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 16px 0 10px; gap: 16px; flex-wrap: wrap; }
  .address { font-size: 12px; line-height: 1.5; }
  .invoice-banner { background: #2c4a7c; color: #fff; padding: 6px 14px; font-weight: bold; display: inline-block; border-radius: 3px; font-size: 13px; }
  .date-box { display: flex; border: 1px solid #2c4a7c; margin-top: 8px; }
  .date-box div { flex: 1; text-align: center; font-size: 11px; }
  .date-box div + div { border-left: 1px solid #2c4a7c; }
  .date-label { background: #2c4a7c; color: #fff; font-weight: bold; padding: 3px 0; }
  .date-value { padding: 5px 0; font-weight: bold; }
  .name-line { margin: 10px 0 4px; font-size: 13px; border-bottom: 1px solid #444; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
  th { background: #2c4a7c; color: #fff; padding: 6px 8px; text-align: left; }
  td { padding: 7px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .blank-row td { height: 22px; border-bottom: 1px solid #eee; }
  .total-row td { font-weight: bold; border-top: 2px solid #2c4a7c; border-bottom: none; }
  .footer-note { font-size: 11px; margin-top: 16px; }
  .words-line { font-size: 12.5px; margin-top: 10px; border-bottom: 1px solid #444; padding-bottom: 4px; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 46px; font-size: 12px; }
  .sign-line { border-top: 1px solid #444; width: 190px; text-align: center; padding-top: 4px; }
  .thanks { text-align: center; font-style: italic; margin-top: 18px; font-size: 12.5px; }
  @media print {
    body { padding: 0; }
    .sheet { border: none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="shop-name">EVERYDAY WINE STORE</div>
      <div class="desc">Wines, Spirits &amp; Beverages. Tel: [phone number]</div>
    </div>

    <div class="meta-row">
      <div class="address">
        <strong>Address:</strong><br />
        [Shop address here]
      </div>
      <div>
        <div class="invoice-banner">CASH/CREDIT SALES INVOICE&nbsp;&nbsp;No. ${invoiceNo}</div>
        <div class="date-box">
          <div><div class="date-label">Day</div><div class="date-value">${day}</div></div>
          <div><div class="date-label">Month</div><div class="date-value">${month}</div></div>
          <div><div class="date-label">Year</div><div class="date-value">${year}</div></div>
        </div>
      </div>
    </div>

    <div class="name-line">Name: ${escapeHtml(sale.customer_name || 'Walk-in')}</div>
    <div class="name-line">Address: &nbsp;</div>

    <table>
      <thead>
        <tr><th style="width:10%">QTY</th><th>DESCRIPTION</th><th style="width:20%">RATE</th><th style="width:22%">AMOUNT (₦)</th></tr>
      </thead>
      <tbody>
        ${itemRows}
        ${blankRows}
        <tr class="total-row"><td colspan="3" style="text-align:right">Total</td><td>${money(sale.total)}</td></tr>
      </tbody>
    </table>

    <div class="footer-note">Received the above goods in good condition. No refund of money after payment.</div>
    <div class="words-line">Amount in words: ${amountToWords(total)} (₦${naira}${kobo ? '.' + String(kobo).padStart(2, '0') : ''})</div>

    <div class="sign-row">
      <div class="sign-line">Customer's Sign</div>
      <div class="sign-line">Manager's Sign</div>
    </div>
    <div class="thanks">Thanks For Your Patronage</div>
  </div>
  <script>
    window.onload = function () { window.print(); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) {
    alert('Please allow pop-ups for this site to print the receipt.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
