import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

const LiveContext = createContext({ status: 'closed', versions: {} });

function wsUrl() {
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
  const wsBase = apiBase.replace(/^http/, 'ws').replace(/\/api\/?$/, '');
  const token = localStorage.getItem('access_token') || '';
  return `${wsBase}/ws/live/?token=${encodeURIComponent(token)}`;
}

/**
 * One WebSocket connection for the entire app — mounted once here, not
 * per-page, so ten open tabs on ten different pages still only cost one
 * socket each. Reconnects with exponential backoff (1s -> 30s cap) if the
 * connection drops.
 *
 * This is a notification layer ONLY — see the backend's realtime/events.py
 * for the full reasoning, but the short version: it never holds data
 * itself, just bumps a per-resource "version" number whenever a relevant
 * event arrives (`sale.created` -> versions.sale += 1). A page reacts by
 * re-running its normal fetch whenever the version it cares about
 * changes — the fetch is still what's actually correct; the socket just
 * means that fetch happens the instant something changes instead of
 * waiting for the next navigation or manual refresh. If the socket is
 * down for any reason, pages simply don't get nudged and fall back to
 * updating on their next normal fetch — nothing breaks, nothing is lost.
 */
export function LiveProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('closed');
  const [versions, setVersions] = useState({});

  useEffect(() => {
    if (!user) {
      setStatus('closed');
      return;
    }

    let cancelled = false;
    let ws;
    let retryDelay = 1000;
    let retryTimer;

    function connect() {
      if (cancelled) return;
      setStatus('connecting');
      ws = new WebSocket(wsUrl());

      ws.onopen = () => {
        if (cancelled) return;
        setStatus('open');
        retryDelay = 1000;
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus('closed');
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        let data;
        try {
          data = JSON.parse(msg.data);
        } catch {
          return; // malformed frame — ignore, this is a nudge, not critical data
        }
        const resource = (data.event || '').split('.')[0]; // 'sale.created' -> 'sale'
        if (!resource) return;
        setVersions((v) => ({ ...v, [resource]: (v[resource] || 0) + 1 }));
      };
    }
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [user]);

  return <LiveContext.Provider value={{ status, versions }}>{children}</LiveContext.Provider>;
}

/** versions.sale, versions.inventoryitem, versions.stockbatch,
 * versions.customer, versions.saleitem — increments on every relevant
 * change from ANYONE (this tab, another tab, the desktop app, the CEO).
 * Depend on the one(s) a page cares about in a useEffect to refetch live. */
export function useLive() {
  return useContext(LiveContext);
}
