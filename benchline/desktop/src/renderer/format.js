export function money(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

// IPC errors arrive as `Error: Error invoking remote method 'x': Error: <message>`
// — strip the Electron wrapper noise down to the actual message we threw.
export function posErrorMessage(err, fallback) {
  const raw = err?.message || '';
  const match = raw.match(/Error:\s*(.+)$/);
  return (match ? match[1] : raw) || fallback;
}
