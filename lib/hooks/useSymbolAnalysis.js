'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { historicalDataEngine } from '../binance/historical';
import { signalEngine } from '../signals/signalEngine';
import { binanceWs, klineStream } from '../binance/ws';
import { candleFromWsKline } from '../data/candle';
import { classifyDataQuality } from '../data/dataQuality';
import { useConfigStore } from '../runtime/configStore';
import { getTracker } from '../runtime/tracker';
import { dispatch } from '../notifications/notify';
import { binanceRest } from '../binance/rest';

/**
 * Loads REAL candles for the symbol (REST history + WebSocket live candle),
 * classifies data quality, runs the SignalEngine and feeds the shared
 * SignalTracker. The engine is re-run when a candle CLOSES (not on every
 * tick) and on a slow timer so staleness/gaps are noticed.
 */
export function useSymbolAnalysis(symbol, { timeframe } = {}) {
  const base = useConfigStore((s) => s.config);
  const lang = useConfigStore((s) => s.lang);
  const loadedCfg = useConfigStore((s) => s.loaded);
  const cfg = useMemo(
    () => ({ ...base, timeframes: { ...base.timeframes, mtf: timeframe || base.timeframes.mtf } }),
    [base, timeframe]
  );

  const [state, setState] = useState({ loading: true, error: null, signal: null, candles: null, gaps: 0, quality: null, updatedAt: null });
  const [liveCandle, setLiveCandle] = useState(null);
  const candlesRef = useRef([]);
  const busy = useRef(false);

  useEffect(() => {
    if (!symbol || !loadedCfg) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    setLiveCandle(null);
    const stream = klineStream(symbol, cfg.timeframes.mtf);
    let liveTimer = null;
    let pendingLive = null;

    async function run() {
      if (busy.current) return;
      busy.current = true;
      try {
        const tfs = cfg.timeframes;
        const [htf, mtf, ltf] = await Promise.all([
          historicalDataEngine.load({ symbol, interval: tfs.htf, count: 220 }),
          historicalDataEngine.load({ symbol, interval: tfs.mtf, count: 320 }),
          historicalDataEngine.load({ symbol, interval: tfs.ltf, count: 220 }),
        ]);
        if (cancelled) return;
        // keep the live (forming) candle if the WS already delivered a newer one
        let exec = mtf.candles;
        const liveTail = candlesRef.current[candlesRef.current.length - 1];
        if (liveTail && liveTail.openTime >= exec[exec.length - 1].openTime && liveTail.isClosed === false) {
          exec = [...exec.filter((c) => c.openTime < liveTail.openTime), liveTail];
        }
        candlesRef.current = exec;

        const ws = binanceWs?.getStatus();
        const h = ws?.streamHealth?.find((x) => x.stream === stream);
        const gapCount = [htf, mtf, ltf].reduce((a, r) => a + r.validation.gaps.length, 0);
        const quality = classifyDataQuality({
          restOk: true,
          wsStatus: ws?.status,
          streamAgeMs: h?.lastMessageAgoMs ?? null,
          gapCount,
        });
        // WebSocket may still be connecting on first load: don't call that stale.
        const quality2 = quality.state === 'DISCONNECTED' && ws?.status !== 'CONNECTED' && !h?.lastMessageAgoMs ? { ...quality, state: 'DEGRADED', isStale: false } : quality;

        let spreadPct = null;
        try {
          const b = await binanceRest.bookTicker({ symbol });
          const bid = Number(b.bidPrice);
          const ask = Number(b.askPrice);
          if (bid && ask) spreadPct = ((ask - bid) / ((ask + bid) / 2)) * 100;
        } catch {
          /* spread gate is skipped if the book ticker is unavailable */
        }

        const signal = signalEngine.evaluate({
          symbol,
          executionCandles: exec,
          candlesByTf: { [tfs.htf]: htf.candles, [tfs.mtf]: exec, [tfs.ltf]: ltf.candles },
          config: cfg,
          dataQuality: { isStale: quality2.isStale, isComplete: quality2.isComplete, state: quality2.state, spreadPct },
        });

        const events = getTracker(cfg.signalCooldownMs).update(signal, exec);
        for (const ev of events) dispatch(ev, cfg, lang);

        setState({ loading: false, error: null, signal, candles: exec, gaps: gapCount, quality: quality2, updatedAt: Date.now() });
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: err.message, quality: classifyDataQuality({ error: err.message }) }));
      } finally {
        busy.current = false;
      }
    }

    run();
    const timer = setInterval(run, 30_000);

    let unsub = () => {};
    if (binanceWs) {
      binanceWs.subscribe(stream);
      unsub = binanceWs.on(`stream:${stream}`, (data) => {
        if (data.e !== 'kline') return;
        const c = candleFromWsKline(data.k);
        const arr = candlesRef.current;
        if (arr.length) {
          const last = arr[arr.length - 1];
          if (last.openTime === c.openTime) arr[arr.length - 1] = c;
          else if (c.openTime > last.openTime) arr.push(c);
        }
        pendingLive = c;
        if (!liveTimer) {
          liveTimer = setTimeout(() => {
            liveTimer = null;
            setLiveCandle(pendingLive);
          }, 400);
        }
        if (c.isClosed) setTimeout(run, 1200); // candle closed -> re-evaluate on the closed candle
      });
    }

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(liveTimer);
      unsub();
    };
  }, [symbol, cfg, loadedCfg, lang]);

  return { ...state, liveCandle, config: cfg };
}
