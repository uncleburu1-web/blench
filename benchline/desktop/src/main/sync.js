const { getAccessToken, refreshAccessToken } = require('./auth');

const API_BASE = process.env.BENCHLINE_API_URL || 'http://localhost:8000/api';
const SYNC_INTERVAL_MS = 15_000;
const BATCH_SIZE = 25;
const MAX_BACKOFF_MS = 5 * 60_000; // never wait longer than 5 minutes between retries of the same row

// Exponential backoff after N consecutive failures — 30s, 60s, 120s, 240s,
// capped at 5 min. Keeps a flaky/offline connection from hammering the
// Django/Railway backend with the exact same batch every 15s; it still
// retries promptly the FIRST time (retryCount 0 -> next tick, unchanged),
// it just backs off if that keeps failing.
function backoffMs(retryCount) {
  return Math.min(SYNC_INTERVAL_MS * 2 ** retryCount, MAX_BACKOFF_MS);
}

/**
 * Drains the local outbox to the cloud whenever there's connectivity and
 * an authenticated session. Targets `/api/sync/push/` — the idempotent
 * batch-ingest endpoint from the architecture doc's synchronization
 * design (§7), implemented server-side in backend/sync/views.py.
 *
 * A push failure (offline, DNS failure, backend down, 5xx) is caught
 * below and just leaves the queue rows `pending` for a later tick — sale
 * ringing never depends on this succeeding; see db.js, none of whose
 * functions call this module or await anything network-related.
 * Consecutive failures back off exponentially (see backoffMs) instead of
 * hammering the backend every SYNC_INTERVAL_MS.
 */
function startSyncEngine(db) {
  async function doPush(token, operations) {
    return fetch(`${API_BASE}/sync/push/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ operations }),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async function tick() {
    const nowIso = new Date().toISOString();
    const pending = db.prepare(
      `SELECT * FROM sync_queue
       WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY client_timestamp LIMIT ?`
    ).all(nowIso, BATCH_SIZE);
    if (pending.length === 0) return;

    let token = getAccessToken(db);
    if (!token) return; // not logged in yet

    const operations = pending.map((row) => ({
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      operation: row.operation,
      payload: JSON.parse(row.payload),
      client_timestamp: row.client_timestamp,
    }));

    try {
      let res = await doPush(token, operations);
      if (res.status === 401) {
        token = await refreshAccessToken(db);
        if (!token) return;
        res = await doPush(token, operations);
      }
      if (!res.ok) throw new Error(`sync push responded ${res.status}`);

      const result = await res.json();
      const byId = new Map((result.results || []).map((r) => [r.id, r.status]));
      for (const row of pending) {
        const outcome = byId.get(row.id);
        if (outcome === 'applied' || outcome === 'already_applied') {
          db.prepare(`UPDATE sync_queue SET status = 'synced', next_attempt_at = NULL WHERE id = ?`).run(row.id);
        } else if (outcome === 'rejected') {
          console.error(`[sync] rejected ${row.entity_type} ${row.entity_id}: ${row.last_error || 'see server response'}`);
          db.prepare(`UPDATE sync_queue SET status = 'failed', last_error = ? WHERE id = ?`).run('rejected by server', row.id);
        }
        // anything else — including the endpoint not existing yet — is
        // left `pending`, retried automatically on the next tick.
      }
    } catch (err) {
      const message = String((err && err.message) || err);
      console.error(`[sync] push failed for ${pending.length} pending item(s): ${message}`);
      for (const row of pending) {
        const nextRetryCount = row.retry_count + 1;
        const nextAttemptAt = new Date(Date.now() + backoffMs(nextRetryCount)).toISOString();
        db.prepare(
          `UPDATE sync_queue SET retry_count = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`
        ).run(nextRetryCount, message, nextAttemptAt, row.id);
      }
    }
  }

  tick();
  const timer = setInterval(tick, SYNC_INTERVAL_MS);
  return () => clearInterval(timer);
}

module.exports = { startSyncEngine };
