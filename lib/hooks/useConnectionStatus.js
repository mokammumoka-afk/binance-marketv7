'use client';

import { useEffect, useState } from 'react';
import { binanceRest } from '../binance/rest';
import { binanceWs } from '../binance/ws';

/**
 * Tracks real Binance REST + WebSocket connection health for the
 * System page and the TopBar status pill. All values come from actual
 * calls/socket state — nothing here is simulated.
 */
export function useConnectionStatus() {
  const [restStatus, setRestStatus] = useState({ ok: null, latencyMs: null, checkedAt: null, usedWeight: 0 });
  const [wsStatus, setWsStatus] = useState({ status: 'DISCONNECTED', streamCount: 0, latencyMs: null, streamHealth: [] });

  useEffect(() => {
    let mounted = true;

    async function checkRest() {
      const start = performance.now();
      try {
        await binanceRest.ping();
        const latency = Math.round(performance.now() - start);
        if (mounted) {
          setRestStatus({
            ok: true,
            latencyMs: latency,
            checkedAt: Date.now(),
            usedWeight: binanceRest.getUsedWeight(),
          });
        }
      } catch (err) {
        if (mounted) {
          setRestStatus({ ok: false, latencyMs: null, checkedAt: Date.now(), error: err.message, usedWeight: binanceRest.getUsedWeight() });
        }
      }
    }

    checkRest();
    const restInterval = setInterval(checkRest, 30000);

    let unsubStatus = () => {};
    if (binanceWs) {
      setWsStatus(binanceWs.getStatus());
      unsubStatus = binanceWs.on('status', (s) => mounted && setWsStatus(s));
    }

    return () => {
      mounted = false;
      clearInterval(restInterval);
      unsubStatus();
    };
  }, []);

  return { restStatus, wsStatus };
}
