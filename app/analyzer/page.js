'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSymbolAnalysis } from '../../lib/hooks/useSymbolAnalysis';
import SignalCard from '../../components/SignalCard';
import Chart from '../../components/Chart';
import FuturesPanel from '../../components/FuturesPanel';
import { symbolService } from '../../lib/binance/symbols';
import { useT } from '../../lib/i18n';

const TF_TABS = ['5m', '15m', '1h', '4h', '1d'];

function DataBadge({ quality, gaps }) {
  const { t } = useT();
  if (!quality) return null;
  const color = { LIVE: 'text-long', STALE: 'text-warn', DEGRADED: 'text-warn', DISCONNECTED: 'text-short', DATA_ERROR: 'text-short' }[quality.state];
  return (
    <div className={`flex items-center gap-1 text-[11px] ${color}`}>
      <span className="status-dot bg-current" />
      {t(`data.${quality.state}`)}
      {gaps > 0 && <span className="text-warn"> · GAP DETECTED ×{gaps}</span>}
    </div>
  );
}

function AnalyzerInner() {
  const params = useSearchParams();
  const { t } = useT();
  const [symbol, setSymbol] = useState(params.get('symbol') || 'BTCUSDT');
  const [inputValue, setInputValue] = useState(symbol);
  const [tf, setTf] = useState('15m');
  const [allSymbols, setAllSymbols] = useState([]);

  useEffect(() => {
    symbolService.getUsdtTradingSymbols().then((s) => setAllSymbols(s.map((x) => x.symbol)));
  }, []);

  const { loading, error, signal, candles, gaps, quality, config } = useSymbolAnalysis(symbol, { timeframe: tf });

  return (
    <div className="space-y-3 px-3 py-4">
      <div className="flex items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const val = inputValue.trim().toUpperCase();
            if (allSymbols.includes(val)) setSymbol(val);
          }}
          className="flex flex-1 items-center gap-2"
        >
          <input
            list="symbol-list"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="mono-num w-full rounded-lg border border-base-600 bg-base-800 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="BTCUSDT"
          />
          <datalist id="symbol-list">
            {allSymbols.slice(0, 500).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </form>
        <DataBadge quality={quality} gaps={gaps} />
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {TF_TABS.map((x) => (
          <button
            key={x}
            onClick={() => setTf(x)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs mono-num ${tf === x ? 'border-accent bg-accent-dim text-accent' : 'border-base-700 text-base-400'}`}
          >
            {x}
          </button>
        ))}
      </div>

      <div className="card p-2">
        {loading && <div className="flex h-[320px] items-center justify-center text-sm text-base-400">{t('loading')}</div>}
        {error && <div className="flex h-[320px] items-center justify-center text-sm text-short">{t('dataError')}</div>}
        {!loading && !error && candles && (
          <Chart candles={candles} structure={signal?.structure} volumeProfile={signal?.volumeProfile} plan={signal?.plan} direction={signal?.direction} />
        )}
      </div>

      {loading ? <div className="card h-56 animate-pulse p-4" /> : error ? null : <SignalCard signal={signal} />}

      {signal && signal.state !== 'NO_TRADE' && (
        <div className="card space-y-2 p-4 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-base-500">{t('score')} — {t('scoreNote')}</div>
          {Object.entries(signal.scoreBreakdown || {}).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-base-300">{k}</span>
              <span className="mono-num text-base-100">{v.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {signal?.indicators && (
        <div className="card space-y-1.5 p-4 text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-base-500">{t('rsi')} / EMA / ATR / {t('poc')}</div>
          <Row label="RSI(14)" value={signal.indicators.rsiReady ? signal.indicators.rsi?.toFixed(1) : 'NOT_READY'} />
          <Row label="ATR(14)" value={signal.indicators.atr?.toFixed(6)} />
          <Row label="EMA20" value={signal.indicators.ema20?.toFixed(4)} />
          <Row label="EMA50" value={signal.indicators.ema50?.toFixed(4)} />
          {signal.volumeProfile?.ready && (
            <>
              <Row label="POC" value={signal.volumeProfile.poc.price.toFixed(4)} />
              <Row label="VAH" value={signal.volumeProfile.vah?.toFixed(4)} />
              <Row label="VAL" value={signal.volumeProfile.val?.toFixed(4)} />
            </>
          )}
        </div>
      )}

      {signal?.mtf && (
        <div className="card space-y-1.5 p-4 text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-base-500">{t('mtf')}</div>
          {Object.entries(signal.mtf.perTimeframe).map(([k, v]) => (
            <Row key={k} label={k.toUpperCase()} value={t(v.bias)} />
          ))}
          <Row label={t('trend')} value={t(signal.mtf.overallBias)} />
        </div>
      )}

      {signal && signal.direction && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-base-400">{t('futures.heading')}</h2>
          <FuturesPanel symbol={symbol} direction={signal.direction} entry={signal.price} stopLoss={signal.plan?.stopLoss} />
        </section>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-base-400">{label}</span>
      <span className="mono-num text-base-100">{value ?? '—'}</span>
    </div>
  );
}

export default function AnalyzerPage() {
  return (
    <Suspense fallback={<div className="p-5 text-sm text-base-400">…</div>}>
      <AnalyzerInner />
    </Suspense>
  );
}
