'use client';

import { useEffect, useState } from 'react';
import { useConnectionStatus } from '../../lib/hooks/useConnectionStatus';
import { binanceRest } from '../../lib/binance/rest';
import { listSystemLogs, applyRetention, isSupabaseActive } from '../../lib/storage/db';
import { useSupabaseStatus } from '../../lib/hooks/useSupabaseStatus';
import { useT } from '../../lib/i18n';

const SB_COLOR = { CONNECTED: 'text-long', CONNECTING: 'text-warn', ERROR: 'text-short', NOT_CONFIGURED: 'text-base-400' };

export default function SystemPage() {
  const { t } = useT();
  const { restStatus, wsStatus } = useConnectionStatus();
  const supabase = useSupabaseStatus();
  const [serverTime, setServerTime] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    binanceRest.serverTime().then(setServerTime).catch(() => {});
    listSystemLogs(50).then(setLogs);
    applyRetention().catch(() => {});
  }, []);

  const drift = serverTime ? serverTime - Date.now() : null;

  return (
    <div className="space-y-4 px-3 py-4">
      <div className="card space-y-2 p-4 text-sm">
        <div className="text-xs uppercase tracking-wide text-base-500">Binance REST</div>
        <Row label="Status" value={restStatus.ok === true ? 'CONNECTED' : restStatus.ok === false ? 'ERROR' : '…'} />
        <Row label="Latency" value={restStatus.latencyMs ? `${restStatus.latencyMs} ms` : '—'} />
        <Row label="Used Weight (1m)" value={restStatus.usedWeight ?? 0} />
        <Row label="Server Time" value={serverTime ? new Date(serverTime).toISOString() : '…'} />
        <Row label="Clock Drift" value={drift !== null ? `${drift} ms` : '—'} />
      </div>

      <div className="card space-y-2 p-4 text-sm">
        <div className="text-xs uppercase tracking-wide text-base-500">Binance WebSocket</div>
        <Row label="Status" value={wsStatus.status} />
        <Row label="Active Streams" value={wsStatus.streamCount} />
        <Row label="Reconnects" value={wsStatus.reconnectAttempt} />
      </div>

      <div className="card space-y-2 p-4 text-sm">
        <div className="text-xs uppercase tracking-wide text-base-500">Storage — Supabase</div>
        <Row label="Backend" value={isSupabaseActive ? 'Supabase (Postgres)' : 'IndexedDB (local, this browser only)'} />
        <div className="flex items-center justify-between">
          <span className="text-base-400">Status</span>
          <span className={`mono-num ${SB_COLOR[supabase.state]}`}>{supabase.state}</span>
        </div>
        {supabase.userId && <Row label="Session (anon user id)" value={supabase.userId.slice(0, 8) + '…'} />}
        {supabase.error && <div className="text-xs text-short">{supabase.error}</div>}
        {!supabase.enabled && (
          <p className="text-[11px] leading-relaxed text-base-500">
            Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example) and run
            docs/supabase-schema.sql to sync data across devices instead of storing it only in this browser.
          </p>
        )}
        {supabase.state === 'ERROR' && (
          <p className="text-[11px] leading-relaxed text-warn">
            Usually means docs/supabase-schema.sql hasn&apos;t been run yet, or Authentication → Providers →
            Anonymous Sign-Ins is still off in your Supabase project.
          </p>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-base-500">Stream Health</div>
        {wsStatus.streamHealth.length === 0 && <div className="text-xs text-base-400">—</div>}
        <div className="space-y-1">
          {wsStatus.streamHealth.map((s) => (
            <div key={s.stream} className="flex items-center justify-between text-xs">
              <span className="mono-num text-base-300">{s.stream}</span>
              <span className={`mono-num ${s.stale ? 'text-warn' : 'text-long'}`}>{s.stale ? 'STALE' : 'LIVE'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-base-500">Logs</div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {logs.length === 0 && <div className="text-xs text-base-400">—</div>}
          {logs.map((l) => (
            <div key={l.id} className="flex gap-2 text-xs text-base-400">
              <span className="mono-num text-base-500">{new Date(l.timestamp).toLocaleTimeString()}</span>
              <span>{l.message || JSON.stringify(l)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-base-400">{label}</span>
      <span className="mono-num text-base-100">{value}</span>
    </div>
  );
}
