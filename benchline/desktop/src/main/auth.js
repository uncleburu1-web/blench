const API_BASE = process.env.BENCHLINE_API_URL || 'http://localhost:8000/api';

function getStoredTokens(db) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'auth_tokens'`).get();
  return row ? JSON.parse(row.value) : null;
}

function storeTokens(db, tokens) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('auth_tokens', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(tokens));
}

/**
 * The logged-in user's role, as of their last successful login —
 * { username, full_name, is_owner, role }. This is what every screen in
 * the renderer gates on (owner: everything; seller: selling only — see
 * architecture: "any first user is admin, workers the admin creates are
 * sellers with the capacity of selling"). Cached locally so it survives
 * offline restarts exactly like the tokens do; only a fresh login ever
 * refreshes it.
 */
function getStoredProfile(db) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'user_profile'`).get();
  return row ? JSON.parse(row.value) : null;
}

function storeProfile(db, profile) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('user_profile', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(profile));
}

/**
 * The desktop's ONE dependency on the network being reachable: logging in
 * for the first time. Everything after this — every sale, every stock
 * change — works with zero further calls to this function. The resulting
 * tokens (and the user's role, fetched from /api/me/ in the same
 * network-dependent step) are cached locally so a later launch with no
 * internet still counts as "logged in" for local purposes (only cloud
 * sync/heartbeat need a *live* token, refreshed opportunistically).
 */
async function login(db, username, password) {
  const res = await fetch(`${API_BASE}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || 'Login failed — check username and password.');
  }
  const tokens = await res.json();
  storeTokens(db, tokens);

  // Same network window as the login call above — /api/me/ already
  // returns is_owner (superuser, or a Worker with role='owner') vs.
  // seller, so no separate endpoint or local guesswork is needed.
  try {
    const meRes = await fetch(`${API_BASE}/me/`, {
      headers: { Authorization: `Bearer ${tokens.access}` },
      signal: AbortSignal.timeout(8000),
    });
    if (meRes.ok) {
      const me = await meRes.json();
      storeProfile(db, {
        username: me.username,
        full_name: me.full_name,
        is_owner: me.is_owner,
        role: me.role,
      });
    }
  } catch {
    // Login itself already succeeded — don't fail the whole sign-in over
    // this one follow-up call. Fall back below to whatever role is
    // already cached from a previous login, defaulting to the safer,
    // lower-privilege "seller" view if this is the very first login.
  }

  return tokens;
}

function getUserProfile(db) {
  return getStoredProfile(db) || { is_owner: false, role: 'seller', full_name: null, username: null };
}

function logout(db) {
  db.prepare(`DELETE FROM app_settings WHERE key IN ('auth_tokens', 'user_profile')`).run();
}

function getAccessToken(db) {
  const tokens = getStoredTokens(db);
  return tokens ? tokens.access : null;
}

async function refreshAccessToken(db) {
  const tokens = getStoredTokens(db);
  if (!tokens || !tokens.refresh) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: tokens.refresh }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    storeTokens(db, { ...tokens, access: data.access });
    return data.access;
  } catch {
    return null;
  }
}

module.exports = { login, logout, getAccessToken, refreshAccessToken, getStoredTokens, getUserProfile };
