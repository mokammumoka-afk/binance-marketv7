'use client';

import { useEffect, useState } from 'react';
import { liquidationStream } from '../binance/liquidations';
import { futuresContextEngine } from '../futures/futuresContextEngine';

/**
 * Pulls together everything that ISN'T in the scored confluence: Binance
 * Futures funding/OI/long-short ratios (via our own /api/futures-context
 * route, server-side to match the architecture — though fapi.binance.com
 * also allows direct browser CORS, routing through our API keeps one
 * consistent, cacheable path), live liquidation pressure (direct
 * WebSocket, like the rest of the app's live data), whole-market Fear &
 * Greed + dominance, and recent asset-relevant news headlines.
 */
export function useFuturesContext(symbol, direction) {
  const [state, setState] = useState({ loading: true, context: null, error: null });
  const [liqStatus, setLiqStatus] = useState(null);

  useEffect(() => {
    if (!symbol) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    async function load() {
      try {
        const baseAsset = symbol.replace(/USDT$|BUSD$|USDC$/, '');
        const [futuresRes, newsRes, marketRes] = await Promise.all([
          fetch(`/api/futures-context?symbol=${symbol}`).then((r) => r.json()),
          fetch(`/api/news?asset=${baseAsset}&limit=10`).then((r) => r.json()),
          fetch('/api/market-context').then((r) => r.json()),
        ]);
        if (cancelled) return;

        const liquidationPressure = liquidationStream ? liquidationStream.pressure(symbol) : null;
        const built = futuresContextEngine.build({
          direction: direction || 'LONG',
          futuresSnapshot: futuresRes,
          liquidationPressure,
          marketContext: marketRes,
        });

        setState({ loading: false, error: null, context: { futures: futuresRes, news: newsRes, market: marketRes, advisory: built, liquidationPressure } });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, context: null });
      }
    }

    load();
    const interval = setInterval(load, 60_000);

    let unsub = () => {};
    let release = () => {};
    if (liquidationStream) {
      release = liquidationStream.acquire();
      unsub = liquidationStream.on((msg) => {
        if (msg.type === 'status') setLiqStatus(msg.status);
      });
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsub();
      release();
    };
  }, [symbol, direction]);

  return { ...state, liqStatus };
}
