import { useState } from 'react';
import { posErrorMessage } from './format.js';

export default function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await window.pos.login(username, password);
      onLoggedIn();
    } catch (err) {
      setError(posErrorMessage(err, 'Could not log in — check the shop\'s internet connection and try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={handleSubmit} className="modal" style={{ width: 340, position: 'static' }}>
        <h3 style={{ marginBottom: 4 }}>Everyday Wine Store</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 0, marginBottom: 16 }}>
          Sign in once — after this, the till keeps working even if the internet drops.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label>Username</label>
          <input autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
