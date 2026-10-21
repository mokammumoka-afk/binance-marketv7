'use client';

import { useT } from '../lib/i18n';
import { getDisplayBadge } from '../lib/signals/displayState';

const BADGE_COLOR = {
  '🟢': { color: 'text-long-bright', bg: 'bg-long-dim', border: 'border-long' },
  '🔴': { color: 'text-short-bright', bg: 'bg-short-dim', border: 'border-short' },
  '🔵': { color: 'text-accent', bg: 'bg-accent-dim', border: 'border-accent' },
  '🟡': { color: 'text-warn', bg: 'bg-warn-dim/60', border: 'border-warn/50' },
  '⚪': { color: 'text-base-300', bg: 'bg-base-800', border: 'border-base-700' },
};

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
function fmtRange(low, high) {
  if (low == null || high == null) return '—';
  return `${fmt(low)} – ${fmt(high)}`;
}

export default function SignalCard({ signal, compact = false }) {
  const { t, lang } = useT();
  if (!signal) return null;
  const isNoTrade = signal.state === 'NO_TRADE' || signal.state === 'WAIT';
  const badge = getDisplayBadge({ direction: signal.direction, state: signal.state, entryType: signal.plan?.entryType, entryPending: signal.plan?.entryPending });
  const style = BADGE_COLOR[badge.emoji] || BADGE_COLOR['⚪'];

  return (
    <div className={`card border ${style.border} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="mono-num text-base font-semibold text-base-100">{signal.symbol}</div>
          <div className={`mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium tracking-wide ${style.bg} ${style.color}`}>
            <span>{badge.emoji}</span>
            {lang === 'ar' ? badge.labelAr : badge.labelEn}
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
          {/* Current Price is ALWAYS shown separately from Entry Zone — it is the
              live reference price, never the trade's entry, and it keeps moving
              after the signal was created while the entry below does not. */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-base-800/60 px-3 py-2 text-xs">
            <span className="text-base-400">{t('currentPrice')}</span>
            <span className="mono-num text-base-100">{fmt(signal.currentPrice ?? signal.price)}</span>
          </div>

          <div className="mt-2 rounded-lg border border-base-700 px-3 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-base-400">{t('entryZone')}</span>
              <span className="text-[10px] text-base-500">{t(`entry.${signal.plan?.entryType}`) || signal.plan?.entryType}</span>
            </div>
            <div className="mono-num mt-0.5 text-sm font-medium text-base-100">
              {fmtRange(signal.plan?.entryZone?.low, signal.plan?.entryZone?.high)}
            </div>
            {signal.plan?.entryPending && <div className="mt-0.5 text-[10px] text-warn">{t('entry.pending')}</div>}
            {!compact && signal.plan?.entryRationale && <div className="mt-1 text-[10px] leading-relaxed text-base-500">{signal.plan.entryRationale}</div>}
          </div>

          {signal.volumeProfile?.ready && (
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <Metric label={t('vah')} value={fmt(signal.volumeProfile.vah)} />
              <Metric label={t('poc')} value={fmt(signal.volumeProfile.poc?.price)} />
              <Metric label={t('val')} value={fmt(signal.volumeProfile.val)} />
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <Metric label={t('stop')} value={fmt(signal.plan?.stopLoss)} tone="short" reason={!compact ? signal.plan?.stopLossReason : null} />
            <Metric label={t('rr')} value={signal.plan?.riskRewardToTp1 ? `1:${signal.plan.riskRewardToTp1.toFixed(2)}` : '—'} />
            <Metric label={`${t('tp')} 1`} value={fmt(signal.plan?.tp1)} tone="long" reason={!compact ? signal.plan?.tp1Reason : null} />
            <Metric label={`${t('tp')} 2`} value={fmt(signal.plan?.tp2)} tone="long" reason={!compact ? signal.plan?.tp2Reason : null} />
            <Metric label={`${t('tp')} 3`} value={fmt(signal.plan?.tp3)} tone="long" reason={!compact ? signal.plan?.tp3Reason : null} />
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

      {!compact && <div className="mt-3 border-t border-base-700 pt-2 text-[10px] text-base-500">{t('scoreNote')} · {t('disclaimer')}</div>}
    </div>
  );
}

function Metric({ label, value, tone, reason }) {
  const toneClass = tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-base-100';
  return (
    <div>
      <div className="text-[10px] text-base-500">{label}</div>
      <div className={`mono-num font-medium ${toneClass}`}>{value}</div>
      {reason && <div className="mt-0.5 text-[9px] leading-tight text-base-500">{reason}</div>}
    </div>
  );
}
