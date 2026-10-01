'use client';

import { useEffect, useState } from 'react';
import { loadSignalRecords, listSignalEvents } from '../../lib/storage/db';
import { useT } from '../../lib/i18n';

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 6 });
}

const RESULT_COLOR = { SL: 'text-short', TP1: 'text-long', TP2: 'text-long', TP3: 'text-long', TP1_THEN_SL: 'text-warn' };

export default function SignalsPage() {
  const { t } = useT();
  const [tab, setTab] = useState('active');
  const [records, setRecords] = useState([]);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    async function load() {
      const [r, e] = await Promise.all([loadSignalRecords(), listSignalEvents(150)]);
      setRecords(r.sort((a, b) => b.firstSeen - a.firstSeen));
      setEvents(e);
    }
    load();
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, []);

  const active = records.filter((r) => r.status === 'ACTIVE');
  const closed = records.filter((r) => r.status === 'CLOSED');

  return (
    <div className="space-y-3 px-3 py-4">
      <div className="flex gap-1.5">
        {[
          ['active', `${t('signals.active')} (${active.length})`],
          ['closed', `${t('signals.closed')} (${closed.length})`],
          ['events', t('signals.events')],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-3 py-1.5 text-xs ${tab === k ? 'border-accent bg-accent-dim text-accent' : 'border-base-700 text-base-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'events' && (
        <div className="space-y-2">
          {(tab === 'active' ? active : closed).length === 0 && <div className="card p-4 text-xs text-base-400">{t('signals.empty')}</div>}
          {(tab === 'active' ? active : closed).map((r) => (
            <div
              key={r.fingerprint}
              className="card p-3"
              style={{ borderInlineStart: `4px solid ${r.direction === 'LONG' ? '#3FB68B' : '#D65D6B'}` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="mono-num text-sm font-medium text-base-100">{r.symbol}</span>
                  <span className={`mono-num text-xs ${r.direction === 'LONG' ? 'text-long' : 'text-short'}`}>{r.direction}</span>
                  <span className="mono-num text-[10px] text-base-500">{r.timeframe}</span>
                </div>
                <span className="mono-num text-sm text-base-200">{r.score}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1 text-[11px]">
                <MiniStat label={t('entry')} value={fmt(r.entry)} />
                <MiniStat label={t('stop')} value={fmt(r.stopLoss)} />
                <MiniStat label="TP1" value={fmt(r.tp1)} />
                <MiniStat label="R:R" value={r.riskReward ? `1:${r.riskReward.toFixed(2)}` : '—'} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-base-500">
                <span>{new Date(r.firstSeen).toLocaleString()}</span>
                {r.status === 'CLOSED' && <span className={`mono-num ${RESULT_COLOR[r.result] || 'text-base-400'}`}>{r.result}</span>}
              </div>
              {r.status === 'ACTIVE' && (
                <div className="mt-1 flex gap-3 text-[10px] text-base-500">
                  <span>MFE: <span className="mono-num text-long">{r.mfeR?.toFixed(2)}R</span></span>
                  <span>MAE: <span className="mono-num text-short">{r.maeR?.toFixed(2)}R</span></span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <div className="card divide-y divide-base-800">
          {events.length === 0 && <div className="p-4 text-xs text-base-400">{t('signals.empty')}</div>}
          {events.map((e, i) => (
            <div key={i} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="mono-num text-base-100">{e.symbol}</span>
                <span className="text-base-500">{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              <div className="text-base-400">
                {e.type} — {e.note}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded bg-base-800 px-1.5 py-1 text-center">
      <div className="text-base-500">{label}</div>
      <div className="mono-num text-base-100">{value}</div>
    </div>
  );
}
