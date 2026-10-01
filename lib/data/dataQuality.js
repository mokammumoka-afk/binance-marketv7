/**
 * Data quality classification (spec section 66):
 * LIVE | STALE | DEGRADED | DISCONNECTED | DATA_ERROR
 * A directional signal must never be shown for STALE / INCOMPLETE data.
 */
export const DataState = Object.freeze({
  LIVE: 'LIVE',
  STALE: 'STALE',
  DEGRADED: 'DEGRADED',
  DISCONNECTED: 'DISCONNECTED',
  DATA_ERROR: 'DATA_ERROR',
});

export function classifyDataQuality({ restOk = true, wsStatus = null, streamAgeMs = null, gapCount = 0, error = null, staleAfterMs = 20_000 } = {}) {
  if (error) return { state: DataState.DATA_ERROR, isStale: true, isComplete: false, detail: String(error) };
  if (restOk === false) return { state: DataState.DISCONNECTED, isStale: true, isComplete: gapCount === 0, detail: 'Binance REST unreachable' };
  const wsUp = wsStatus === 'CONNECTED';
  const stale = streamAgeMs != null && streamAgeMs > staleAfterMs;
  if (wsStatus && !wsUp && wsStatus !== 'CONNECTING') {
    return { state: DataState.DISCONNECTED, isStale: true, isComplete: gapCount === 0, detail: `WebSocket ${wsStatus}` };
  }
  if (stale) return { state: DataState.STALE, isStale: true, isComplete: gapCount === 0, detail: `No update for ${Math.round(streamAgeMs / 1000)}s` };
  if (gapCount > 0) return { state: DataState.DEGRADED, isStale: false, isComplete: false, detail: `${gapCount} gap(s) in history` };
  return { state: DataState.LIVE, isStale: false, isComplete: true, detail: 'OK' };
}
