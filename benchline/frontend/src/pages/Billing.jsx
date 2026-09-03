import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { subscription } from '../api/endpoints';
import { useLive } from '../context/LiveContext';
import { money, fmtDate } from '../utils/format';
import { Icons } from '../components/Icons';

const STATUS_LABEL = {
  active: 'Active',
  grace: 'Grace period',
  expired: 'Expired',
};

export default function Billing() {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [verifyResult, setVerifyResult] = useState(null); // 'success' | 'failed' | null
  const { versions } = useLive();

  function load() {
    setLoading(true);
    subscription.status().then(({ data }) => { setSub(data); setLoading(false); });
  }

  useEffect(load, [versions.subscription]);

  // Returning from Paystack checkout lands back here with ?reference=xxx
  // (Paystack appends it to whatever callback_url we sent). Verify it
  // directly rather than waiting on the webhook, so the owner sees
  // confirmation immediately -- see subscription/views.py's comment on why
  // both paths exist and are safe to race.
  useEffect(() => {
    const reference = searchParams.get('reference');
    if (!reference) return;
    subscription.verify(reference)
      .then(({ data }) => {
        setVerifyResult('success');
        setSub(data.subscription);
      })
      .catch(() => setVerifyResult('failed'))
      .finally(() => {
        searchParams.delete('reference');
        setSearchParams(searchParams, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubscribe() {
    setError('');
    setRedirecting(true);
    try {
      const callbackUrl = `${window.location.origin}/billing`;
      const { data } = await subscription.checkout(callbackUrl);
      window.location.href = data.authorization_url;
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not start checkout -- try again.');
      setRedirecting(false);
    }
  }

  if (loading || !sub) return <div className="section-body"><div className="empty">Loading…</div></div>;

  const daysLeft = sub.current_period_end
    ? Math.ceil((new Date(sub.current_period_end) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="section">
      <div className="topbar">
        <div>
          <div className="page-title">Billing</div>
          <div className="page-sub">Cloud sync &amp; the CEO app -- the desktop keeps selling either way</div>
        </div>
      </div>

      {verifyResult === 'success' && (
        <div className="banner good" style={{ marginBottom: 16 }}>
          Payment confirmed -- subscription renewed for another year.
        </div>
      )}
      {verifyResult === 'failed' && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          We couldn't confirm that payment yet. If money left your account, it'll still be picked up shortly -- check back in a minute.
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="section-body" style={{ maxWidth: 480 }}>
        <div className="stat-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="stat-label">Status</div>
            <span className={`badge ${sub.effective_status}`}>{STATUS_LABEL[sub.effective_status] || sub.effective_status}</span>
          </div>
          {sub.current_period_end && (
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 8 }}>
              {sub.effective_status === 'expired'
                ? `Expired ${fmtDate(sub.current_period_end)}`
                : `Renews ${fmtDate(sub.current_period_end)}${daysLeft != null && daysLeft >= 0 ? ` (${daysLeft} day${daysLeft === 1 ? '' : 's'})` : ''}`}
            </div>
          )}
          {!sub.cloud_services_enabled && (
            <div style={{ fontSize: 12.5, color: 'var(--warn)', marginTop: 8 }}>
              Cloud sync and the CEO app are paused. Selling on the desktop still works normally.
            </div>
          )}
        </div>

        <div className="stat-card">
          <div className="stat-label">Annual plan</div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: '6px 0' }}>{money(sub.annual_price_ngn)}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-dim)' }}> / year</span></div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14 }}>
            Covers backend hosting &amp; database -- desktop sales, stock, and cash register never depend on this being paid.
          </div>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={handleSubscribe} disabled={redirecting}>
            {Icons.billing} {redirecting ? 'Redirecting to Paystack…' : sub.effective_status === 'active' ? 'Renew early' : 'Subscribe now'}
          </button>
        </div>
      </div>
    </div>
  );
}
