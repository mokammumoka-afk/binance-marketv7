/**
 * BinanceWebSocketManager
 * -----------------------------------------------------------------------
 * A SINGLE combined-stream WebSocket connection that multiplexes many
 * subscriptions (kline, trade, aggTrade, depth, ticker, bookTicker)
 * instead of opening one socket per UI element.
 *
 * Runs in the browser (client component). Binance's public WebSocket
 * market streams do not require an API key.
 *
 * Features:
 *  - automatic reconnect with exponential backoff + jitter
 *  - ping/pong handling (browsers auto-answer WS ping frames; we also
 *    track a message-level "no data" watchdog since Binance combined
 *    streams don't send an app-level heartbeat)
 *  - subscription / unsubscribe management via SUBSCRIBE/UNSUBSCRIBE frames
 *  - duplicate event protection (dedup by stream+event id/time)
 *  - stale-data detection (per-stream last-message age)
 *  - connection latency measurement (round trip via a synthetic ping id)
 *  - stream health monitoring exposed via getStatus()
 */

const WS_BASE = 'wss://stream.binance.com:9443/stream';
const MAX_STREAMS_PER_CONNECTION = 200; // Binance combined-stream soft guidance
const STALE_MS = 15_000;

function backoffDelay(attempt) {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

class Emitter {
  constructor() {
    this._listeners = new Map();
  }
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }
  emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[BinanceWS] listener error', e);
      }
    });
  }
}

export class BinanceWebSocketManager extends Emitter {
  constructor() {
    super();
    this.ws = null;
    this.status = 'DISCONNECTED'; // DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING
    this.streams = new Set(); // desired streams
    this.refs = new Map(); // stream -> subscriber count (shared by many components)
    this._sent = new Set(); // streams the current socket is actually subscribed to
    this._rpcId = 1;
    this._rpcSentAt = new Map();
    this.reconnectAttempt = 0;
    this.lastMessageAt = {};
    this.seenEventKeys = new Map(); // stream -> last dedup key
    this.latencyMs = null;
    this._pingSentAt = 0;
    this._watchdogTimer = null;
    this._manualClose = false;
    this._reconnectTimer = null;
  }

  getStatus() {
    const now = Date.now();
    const streamHealth = Array.from(this.streams).map((s) => {
      const last = this.lastMessageAt[s] || 0;
      return {
        stream: s,
        lastMessageAgoMs: last ? now - last : null,
        stale: last ? now - last > STALE_MS : true,
      };
    });
    return {
      status: this.status,
      streamCount: this.streams.size,
      reconnectAttempt: this.reconnectAttempt,
      latencyMs: this.latencyMs,
      streamHealth,
    };
  }

  _buildUrl() {
    const streamList = Array.from(this.streams).join('/');
    return `${WS_BASE}?streams=${streamList}`;
  }

  connect() {
    if (typeof window === 'undefined') return; // client-only
    if (this.streams.size === 0) return;
    this._manualClose = false;
    this.status = this.reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING';
    this.emit('status', this.getStatus());

    const url = this._buildUrl();
    const socket = new WebSocket(url);
    this.ws = socket;
    this._sent = new Set(this.streams);

    socket.onopen = () => {
      this.status = 'CONNECTED';
      this.reconnectAttempt = 0;
      this.emit('status', this.getStatus());
      this._startWatchdog();
      this._syncSubscriptions();
      this._measureLatency();
    };

    socket.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg && msg.id !== undefined && !msg.stream) {
        const sentAt = this._rpcSentAt.get(msg.id);
        if (sentAt) {
          this.latencyMs = Date.now() - sentAt; // real request/response round trip
          this._rpcSentAt.delete(msg.id);
        }
        return;
      }
      const streamName = msg.stream;
      const data = msg.data;
      if (!streamName || !data) return;

      this.lastMessageAt[streamName] = Date.now();

      const dedupKey = this._dedupKeyFor(streamName, data);
      if (dedupKey && this.seenEventKeys.get(streamName) === dedupKey) {
        return; // duplicate event, drop
      }
      if (dedupKey) this.seenEventKeys.set(streamName, dedupKey);

      this.emit('message', { stream: streamName, data });
      this.emit(`stream:${streamName}`, data);
    };

    socket.onerror = () => {
      this.emit('error', { message: 'WebSocket error' });
    };

    socket.onclose = () => {
      this._stopWatchdog();
      if (this._manualClose) {
        this.status = 'DISCONNECTED';
        this.emit('status', this.getStatus());
        return;
      }
      this.status = 'RECONNECTING';
      this.emit('status', this.getStatus());
      this._scheduleReconnect();
    };
  }

  _dedupKeyFor(streamName, data) {
    // kline: dedup by (openTime,isFinal); trade/aggTrade: by trade id;
    // depth: by lastUpdateId; ticker: by event time
    if (data.e === 'kline') return `${data.k.t}:${data.k.x}`;
    if (data.e === 'trade') return String(data.t);
    if (data.e === 'aggTrade') return String(data.a);
    if (data.e === '24hrTicker') return String(data.E);
    if (data.lastUpdateId) return String(data.lastUpdateId);
    return null;
  }

  _scheduleReconnect() {
    if (this._manualClose) return;
    this.reconnectAttempt += 1;
    const delay = backoffDelay(this.reconnectAttempt);
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _startWatchdog() {
    this._stopWatchdog();
    this._watchdogTimer = setInterval(() => {
      this.emit('status', this.getStatus());
      if (Date.now() % 6 === 0 || this.latencyMs === null) this._measureLatency();
      // If the socket has gone totally silent well past stale threshold,
      // force a reconnect — Binance sends a ping frame every ~3 min but
      // combined streams should have app data far more often.
      const now = Date.now();
      const allStale =
        this.streams.size > 0 &&
        Array.from(this.streams).every((s) => {
          const last = this.lastMessageAt[s];
          return !last || now - last > STALE_MS * 4;
        });
      if (allStale && this.ws) {
        this.ws.close();
      }
    }, 5000);
  }

  _stopWatchdog() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
  }

  _rpc(method, params) {
    if (!this.ws || this.status !== 'CONNECTED' || typeof this.ws.send !== 'function') return;
    const id = this._rpcId++;
    this._rpcSentAt.set(id, Date.now());
    this.ws.send(JSON.stringify(params ? { method, params, id } : { method, id }));
  }

  _measureLatency() {
    this._rpc('LIST_SUBSCRIPTIONS');
  }

  /** Brings the live socket in line with the desired stream set without reconnecting. */
  _syncSubscriptions() {
    const add = [...this.streams].filter((s) => !this._sent.has(s));
    const drop = [...this._sent].filter((s) => !this.streams.has(s));
    if (add.length) {
      this._rpc('SUBSCRIBE', add);
      add.forEach((s) => this._sent.add(s));
    }
    if (drop.length) {
      this._rpc('UNSUBSCRIBE', drop);
      drop.forEach((s) => this._sent.delete(s));
    }
  }

  /** Reference-counted: several components may share one stream safely. */
  subscribe(streamNames) {
    const names = Array.isArray(streamNames) ? streamNames : [streamNames];
    for (const n of names) {
      const count = this.refs.get(n) || 0;
      if (count === 0 && this.streams.size >= MAX_STREAMS_PER_CONNECTION) {
        // eslint-disable-next-line no-console
        console.warn('[BinanceWS] stream limit reached, ignoring', n);
        continue;
      }
      this.refs.set(n, count + 1);
      this.streams.add(n);
    }
    if (!this.ws) this.connect();
    else if (this.status === 'CONNECTED') this._syncSubscriptions();
  }

  unsubscribe(streamNames) {
    const names = Array.isArray(streamNames) ? streamNames : [streamNames];
    for (const n of names) {
      const count = (this.refs.get(n) || 0) - 1;
      if (count > 0) {
        this.refs.set(n, count);
        continue;
      }
      this.refs.delete(n);
      this.streams.delete(n);
      delete this.lastMessageAt[n];
      this.seenEventKeys.delete(n);
    }
    if (this.ws && this.status === 'CONNECTED') this._syncSubscriptions();
  }

  close() {
    this._manualClose = true;
    this.streams.clear();
    this.refs.clear();
    this._sent.clear();
    clearTimeout(this._reconnectTimer);
    this._stopWatchdog();
    this.ws?.close();
    this.ws = null;
    this.status = 'DISCONNECTED';
    this.emit('status', this.getStatus());
  }
}

// Singleton — one connection for the whole app.
export const binanceWs = typeof window !== 'undefined' ? new BinanceWebSocketManager() : null;

export function klineStream(symbol, interval) {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}
export function tradeStream(symbol) {
  return `${symbol.toLowerCase()}@trade`;
}
export function aggTradeStream(symbol) {
  return `${symbol.toLowerCase()}@aggTrade`;
}
export function depthStream(symbol, level = 20, speed = '100ms') {
  return `${symbol.toLowerCase()}@depth${level}@${speed}`;
}
export function tickerStream(symbol) {
  return `${symbol.toLowerCase()}@ticker`;
}
export function bookTickerStream(symbol) {
  return `${symbol.toLowerCase()}@bookTicker`;
}
