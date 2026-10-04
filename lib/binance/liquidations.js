/**
 * Binance USD-M Futures liquidation stream (public, free, no key):
 *   wss://fstream.binance.com/ws/!forceOrder@arr
 *
 * This is Binance's OFFICIAL all-market force-order (liquidation) stream —
 * not an estimate, not scraped. Each event is one real liquidation order
 * Binance's engine executed. A cluster of same-direction liquidations
 * often marks exhaustion of over-leveraged positioning (context for the
 * Futures panel), but — like funding/OI — this is advisory context, not
 * part of the scored confluence, since it is not available historically
 * for the backtester.
 */

const LIQ_WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
const BUFFER_SIZE = 200;
const STALE_MS = 60_000; // liquidations are bursty; "stale" just means no socket data, not "no liquidations happened"

class Emitter {
  constructor() {
    this._l = new Set();
  }
  on(cb) {
    this._l.add(cb);
    return () => this._l.delete(cb);
  }
  emit(v) {
    this._l.forEach((cb) => {
      try {
        cb(v);
      } catch {
        /* listener errors must never break the stream */
      }
    });
  }
}

function parseForceOrder(msg) {
  const o = msg.o;
  if (!o) return null;
  return {
    symbol: o.s,
    side: o.S, // 'BUY' liquidation = a short position was liquidated; 'SELL' = a long was liquidated
    price: Number(o.p),
    avgPrice: Number(o.ap),
    qty: Number(o.q),
    quoteQty: Number(o.p) * Number(o.q),
    time: o.T,
  };
}

class LiquidationStream extends Emitter {
  constructor() {
    super();
    this.ws = null;
    this.status = 'DISCONNECTED';
    this.buffer = [];
    this.lastMessageAt = 0;
    this.reconnectAttempt = 0;
    this.subscriberCount = 0;
    this._reconnectTimer = null;
  }

  getStatus() {
    return {
      status: this.status,
      lastMessageAgoMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
      stale: this.lastMessageAt ? Date.now() - this.lastMessageAt > STALE_MS : false,
      bufferSize: this.buffer.length,
    };
  }

  recent(symbol = null, limit = 50) {
    const all = symbol ? this.buffer.filter((e) => e.symbol === symbol.toUpperCase()) : this.buffer;
    return all.slice(0, limit);
  }

  /** Big-liquidation heuristic over a lookback window: total notional by side. */
  pressure(symbol, windowMs = 15 * 60_000) {
    const cutoff = Date.now() - windowMs;
    const events = this.recent(symbol, BUFFER_SIZE).filter((e) => e.time >= cutoff);
    const longsLiquidated = events.filter((e) => e.side === 'SELL').reduce((a, e) => a + e.quoteQty, 0);
    const shortsLiquidated = events.filter((e) => e.side === 'BUY').reduce((a, e) => a + e.quoteQty, 0);
    return { windowMs, count: events.length, longsLiquidatedUsd: longsLiquidated, shortsLiquidatedUsd: shortsLiquidated };
  }

  acquire() {
    this.subscriberCount += 1;
    if (this.subscriberCount === 1) this.connect();
    return () => this.release();
  }

  release() {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount === 0) this.close();
  }

  connect() {
    if (typeof window === 'undefined' || this.ws) return;
    this.status = 'CONNECTING';
    this.emit({ type: 'status', status: this.getStatus() });
    const socket = new WebSocket(LIQ_WS_URL);
    this.ws = socket;

    socket.onopen = () => {
      this.status = 'CONNECTED';
      this.reconnectAttempt = 0;
      this.emit({ type: 'status', status: this.getStatus() });
    };
    socket.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      const ev = parseForceOrder(msg);
      if (!ev) return;
      this.lastMessageAt = Date.now();
      this.buffer.unshift(ev);
      if (this.buffer.length > BUFFER_SIZE) this.buffer.length = BUFFER_SIZE;
      this.emit({ type: 'liquidation', event: ev });
    };
    socket.onerror = () => this.emit({ type: 'error' });
    socket.onclose = () => {
      this.ws = null;
      if (this.subscriberCount === 0) {
        this.status = 'DISCONNECTED';
        this.emit({ type: 'status', status: this.getStatus() });
        return;
      }
      this.status = 'RECONNECTING';
      this.emit({ type: 'status', status: this.getStatus() });
      this.reconnectAttempt += 1;
      const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  close() {
    clearTimeout(this._reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.status = 'DISCONNECTED';
  }
}

export { LiquidationStream };
export const liquidationStream = typeof window !== 'undefined' ? new LiquidationStream() : null;
