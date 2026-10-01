'use client';

import { useT } from '../lib/i18n';

const STATE_STYLE = {
  LONG_CONFIRMED: { color: 'text-long-bright', bg: 'bg-long-dim', border: 'border-long' },
  LONG_CANDIDATE: { color: 'text-long', bg: 'bg-long-dim/60', border: 'border-long/50' },
  SHORT_CONFIRMED: { color: 'text-short-bright', bg: 'bg-short-dim', border: 'border-short' },
  SHORT_CANDIDATE: { color: 'text-short', bg: 'bg-short-dim/60', border: 'border-short/50' },
  WATCH: { color: 'text-warn', bg: 'bg-warn-dim/60', border: 'border-warn/50' },
  WAIT: { color: 'text-base-300', bg: 'bg-base-800', border: 'border-base-700' },
  NO_TRADE: { color: 'text-base-400', bg: 'bg-base-800', border: 'border-base-700' },
  INVALIDATED: { color: 'text-short', bg: 'bg-short-dim/40', border: 'border-short/40' },
  EXPIRED: { color: 'text-base-400', bg: 'bg-base-800', border: 'border-base-700' },
};

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export default function SignalCard({ signal, compact = false }) {
  const { t } = useT();
  if (!signal) return null;
  const style = STATE_STYLE[signal.state] || STATE_STYLE.WAIT;
  const isNoTrade = signal.state === 'NO_TRADE';

  return (
    <div className={`card border ${style.border} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="mono-num text-base font-semibold text-base-100">{signal.symbol}</div>
          <div className={`mt-1 inline-block rounded px-2 py-0.5 text-[11px] font-medium tracking-wide ${style.bg} ${style.color}`}>
            {t(`state.${signal.state}`)}
          </div>
          {!isNoTrade && signal.mode && (
            <span className="ms-1.5 inline-block rounded bg-base-800 px-1.5 py-0.5 text-[10px] text-base-400">{t(`mode.${signal.mode}`)}</span>
          )}
        </div>
        {!isNoTrade && (
          <div className="text-end">
            <div className="mono-num text-2xl font-semibold text-base-100">{signal.score}</div>
            <div className="text-[10px] text-base-500">{t('score')}</div>
          </div>
        )}
      </div>

      {isNoTrade ? (
        <div className="mt-3 text-xs text-base-400">{signal.failedConditions?.[0]?.reasons?.[0] || t('home.noSetups')}</div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label={t('entry')} value={fmt(signal.price)} />
            <Metric label={t('stop')} value={fmt(signal.plan?.stopLoss)} tone="short" />
            <Metric label={`${t('tp')} 1`} value={fmt(signal.plan?.tp1)} tone="long" />
            <Metric label={`${t('tp')} 2`} value={fmt(signal.plan?.tp2)} tone="long" />
            <Metric label={`${t('tp')} 3`} value={fmt(signal.plan?.tp3)} tone="long" />
            <Metric label={t('rr')} value={signal.plan?.riskRewardToTp1 ? `1:${signal.plan.riskRewardToTp1.toFixed(2)}` : '—'} />
          </div>

          {!compact && signal.reasons?.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-base-500">{t('reasons')}</div>
              <ul className="space-y-0.5">
                {signal.reasons.map((r, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-base-300">
                    <span className="text-long">✓</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!compact && signal.warnings?.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {signal.warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-warn">
                  <span>⚠</span> {w}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!compact && <div className="mt-3 border-t border-base-700 pt-2 text-[10px] text-base-500">{t('disclaimer')}</div>}
    </div>
  );
}

function Metric({ label, value, tone }) {
  const toneClass = tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-base-100';
  return (
    <div>
      <div className="text-[10px] text-base-500">{label}</div>
      <div className={`mono-num font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}
