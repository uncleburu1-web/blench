import { useEffect, useState } from 'react';
import { repairs } from '../api/endpoints';
import { money, fmtDate, apiErrorMessage } from '../utils/format';
import { Icons } from '../components/Icons';

const STATUS_ORDER = ['received', 'diagnosing', 'in_repair', 'ready', 'collected'];
const STATUS_LABEL = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  in_repair: 'In repair',
  ready: 'Ready for pickup',
  collected: 'Collected',
};

const emptyForm = {
  customer_name: '', customer_phone: '', device: '', issue: '', status: 'received',
  cost: 0, payment_status: 'installment', amount_paid: 0, notes: '',
};

export default function Repairs() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [payModal, setPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState('');

  async function load() {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (statusFilter !== 'all') params.status = statusFilter;
    const { data } = await repairs.list(params);
    setTickets(data.results || data);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setModalOpen(true);
  }

  function openEdit(ticket) {
    setEditing(ticket);
    setForm({ ...ticket });
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form };
      if (payload.payment_status === 'paid') delete payload.amount_paid; // backend sets it to cost
      if (editing) {
        await repairs.update(editing.id, payload);
      } else {
        await repairs.create(payload);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this ticket — check the fields and try again.'));
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this ticket?')) return;
    await repairs.remove(id);
    load();
  }

  async function handleStatusChange(ticket, status) {
    await repairs.update(ticket.id, { status });
    load();
  }

  function openPay(ticket) {
    setPayModal(ticket);
    setPayAmount('');
  }

  async function handlePaySubmit(e) {
    e.preventDefault();
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return;
    await repairs.addPayment(payModal.id, amt);
    setPayModal(null);
    load();
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Repair tickets</div>
          <div className="page-sub">Track jobs from drop-off to pickup, and what's been paid</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Tickets ({tickets.length})</h3>
          <button className="btn" onClick={openAdd}>{Icons.plus} New ticket</button>
        </div>
        <div className="section-body">
          <div className="searchbar" style={{ marginTop: 12 }}>
            <input placeholder="Search customer, device, or ticket #…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="empty">Loading…</div>
          ) : tickets.length === 0 ? (
            <div className="empty">No matching tickets. Click "New ticket" to log a device drop-off.</div>
          ) : (
            <div className="ticket-grid">
              {tickets.map((r) => (
                <div className="ticket" key={r.id}>
                  <div className="ticket-top">
                    <span className="ticket-id">{r.ticket_no}</span>
                    <span className={`badge ${r.status}`}><span className="ledot" />{STATUS_LABEL[r.status]}</span>
                  </div>
                  <div className="ticket-perf" />
                  <div className="ticket-bottom">
                    <div className="ticket-device">{r.device}</div>
                    <div className="ticket-issue">{r.issue}</div>
                    <div className="ticket-meta">
                      <span>{r.customer_name}{r.customer_phone ? ' · ' + r.customer_phone : ''}</span>
                      <span className="mono">{fmtDate(r.date_in)}</span>
                    </div>
                    {Number(r.cost) > 0 && (
                      <>
                        <div className="ticket-meta"><span>Quoted</span><span className="num">{money(r.cost)}</span></div>
                        <div className="ticket-meta" style={{ alignItems: 'center' }}>
                          <span className={`badge ${r.is_paid ? 'ready' : 'diagnosing'}`}>
                            <span className="ledot" />{r.is_paid ? 'Paid in full' : 'Installment'}
                          </span>
                          {!r.is_paid && <span className="num" style={{ color: 'var(--warn)', fontWeight: 700 }}>{money(r.balance_due)} owed</span>}
                        </div>
                      </>
                    )}
                    <div className="ticket-actions">
                      {r.status !== 'collected' && (
                        <select
                          className="btn small ghost"
                          style={{ padding: '5px 8px' }}
                          value={r.status}
                          onChange={(e) => handleStatusChange(r, e.target.value)}
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                      )}
                      {Number(r.cost) > 0 && !r.is_paid && (
                        <button className="btn small ghost" onClick={() => openPay(r)}>+ Payment</button>
                      )}
                      <button className="btn small ghost" onClick={() => openEdit(r)}>{Icons.edit}</button>
                      <button className="btn small danger" onClick={() => handleDelete(r.id)}>{Icons.trash}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit ticket' : 'New repair ticket'}</h3>
            {error && <div className="form-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="field-row">
                <div className="field">
                  <label>Customer name</label>
                  <input required value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Device</label>
                <input required value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })} placeholder="e.g. Dell Inspiron 15, screen cracked" />
              </div>
              <div className="field">
                <label>Issue reported</label>
                <textarea required rows="3" value={form.issue} onChange={(e) => setForm({ ...form, issue: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Quoted cost (₦)</label>
                  <input type="number" min="0" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                </div>
              </div>

              <div className="field">
                <label>Payment</label>
                <div className="tabs" style={{ display: 'inline-flex' }}>
                  <button
                    type="button"
                    className={`tab ${form.payment_status === 'paid' ? 'active' : ''}`}
                    onClick={() => setForm({ ...form, payment_status: 'paid' })}
                  >
                    ✓ Paid
                  </button>
                  <button
                    type="button"
                    className={`tab ${form.payment_status === 'installment' ? 'active' : ''}`}
                    onClick={() => setForm({ ...form, payment_status: 'installment' })}
                  >
                    Installment
                  </button>
                </div>
              </div>

              {form.payment_status === 'installment' && (
                <div className="field">
                  <label>Amount paid so far (₦)</label>
                  <input type="number" min="0" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} placeholder="0" />
                </div>
              )}
              {form.payment_status === 'paid' && Number(form.cost) > 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: -6, marginBottom: 12 }}>
                  Will be recorded as fully paid — {money(form.cost)} collected.
                </div>
              )}

              <div className="field">
                <label>Notes</label>
                <textarea rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Parts needed, diagnosis details…" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn">{editing ? 'Save changes' : 'Create ticket'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {payModal && (
        <div className="modal-backdrop" onClick={() => setPayModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Record a payment</h3>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: -8 }}>
              {payModal.customer_name} owes <span className="num" style={{ color: 'var(--warn)' }}>{money(payModal.balance_due)}</span> on {payModal.ticket_no} ({payModal.device}).
            </p>
            <form onSubmit={handlePaySubmit}>
              <div className="field">
                <label>Payment amount (₦)</label>
                <input required autoFocus type="number" min="1" max={payModal.balance_due} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setPayModal(null)}>Cancel</button>
                <button type="submit" className="btn">Record payment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
