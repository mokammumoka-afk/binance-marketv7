'use client';

import { useFuturesContext } from '../lib/hooks/useFuturesContext';
import { futuresContextEngine } from '../lib/futures/futuresContextEngine';
import { useT } from '../lib/i18n';

function usd(n) {
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

export default function FuturesPanel({ symbol, direction, entry, stopLoss }) {
  const { loading, error, context } = useFuturesContext(symbol, direction);
  const { lang } = useT();

  if (loading) return <div className="card h-40 animate-pulse p-4" />;
  if (error || !context) return null;

  const { futures, advisory, news, market, liquidationPressure } = context;
  const liq = futuresContextEngine.estimateLiquidation(direction || 'LONG', entry || futures?.markPrice || 0, [5, 10, 20, 25]);

  return (
    <div className="space-y-3">
      <div className="card p-4 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-base-500">Futures Context (fapi.binance.com)</span>
          <span className="text-[9px] text-base-600">not scored — advisory only</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Funding (8h)" value={futures?.fundingRate != null ? `${(futures.fundingRate * 100).toFixed(4)}%` : '—'} />
          <Stat label="Mark Price" value={futures?.markPrice?.toLocaleString('en-US') ?? '—'} />
          <Stat label="Open Interest" value={futures?.openInterest ? futures.openInterest.toLocaleString('en-US') : '—'} />
          <Stat
            label="Long/Short (accounts)"
            value={futures?.longShortRatioHistory?.length ? futures.longShortRatioHistory[futures.longShortRatioHistory.length - 1].ratio.toFixed(2) : '—'}
          />
        </div>

        {liquidationPressure?.count > 0 && (
          <div className="mt-2 flex items-center justify-between rounded bg-base-800 px-2 py-1.5">
            <span className="text-base-400">Liquidations (15m)</span>
            <span className="mono-num">
              <span className="text-short">{usd(liquidationPressure.longsLiquidatedUsd)} longs</span> ·{' '}
              <span className="text-long">{usd(liquidationPressure.shortsLiquidatedUsd)} shorts</span>
            </span>
          </div>
        )}

        {(advisory.reasons.length > 0 || advisory.warnings.length > 0) && (
          <div className="mt-2 space-y-1">
            {advisory.reasons.map((r, i) => (
              <div key={i} className="flex gap-1.5 text-long">
                <span>✓</span>
                <span className="text-base-300">{r}</span>
              </div>
            ))}
            {advisory.warnings.map((w, i) => (
              <div key={i} className="flex gap-1.5 text-warn">
                <span>⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-2 text-[10px] text-base-600">{lang === 'ar' ? advisory.disclaimerAr : advisory.disclaimer}</p>
      </div>

      <div className="card p-4 text-xs">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-base-500">
          Estimated Liquidation Price ({direction || 'LONG'}) — approximate, isolated, no fees
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {Object.entries(liq.estimates).map(([lev, price]) => (
            <div key={lev} className="rounded bg-base-800 py-1.5">
              <div className="text-base-500">{lev}</div>
              <div className="mono-num text-base-100">{price.toLocaleString('en-US', { maximumFractionDigits: price >= 100 ? 1 : 4 })}</div>
            </div>
          ))}
        </div>
        {stopLoss != null && (
          <p className="mt-2 text-[10px] text-base-600">
            Your stop-loss ({stopLoss.toLocaleString('en-US')}) is reached before liquidation at every leverage shown here, as long as it isn&apos;t moved.
            Leverage changes your position size, not your analytical edge — it only amplifies both outcomes.
          </p>
        )}
      </div>

      {market?.fearGreed?.value != null && (
        <div className="card flex items-center justify-between p-4 text-xs">
          <span className="text-base-400">Market Sentiment — Fear &amp; Greed</span>
          <span className="mono-num text-base-100">
            {market.fearGreed.value}/100 ({market.fearGreed.classification})
          </span>
        </div>
      )}

      {news?.items?.length > 0 && (
        <div className="card p-4 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-base-500">Recent News</span>
            <span className="text-[9px] text-base-600">
              keyword heuristic: {news.heuristic.bullishKeywordHits} bullish / {news.heuristic.bearishKeywordHits} bearish terms — not NLP sentiment
            </span>
          </div>
          <div className="space-y-2">
            {news.items.slice(0, 6).map((n, i) => (
              <a key={i} href={n.link} target="_blank" rel="noreferrer" className="block hover:underline">
                <div className="text-base-200">{n.title}</div>
                <div className="text-[10px] text-base-500">
                  {n.source} {n.publishedAt ? '· ' + new Date(n.publishedAt).toLocaleString() : ''}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded bg-base-800 px-2 py-1.5">
      <div className="text-[10px] text-base-500">{label}</div>
      <div className="mono-num text-base-100">{value}</div>
    </div>
  );
}
