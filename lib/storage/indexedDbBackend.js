import { openDB } from 'idb';

/**
 * Local persistence layer (IndexedDB via `idb`).
 * -----------------------------------------------------------------------
 * This is the FALLBACK backend, used automatically when Supabase is not
 * configured (no NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY set). It implements
 * the exact same function surface as lib/storage/supabaseBackend.js so
 * lib/storage/db.js can switch between them without any other file
 * knowing which one is active. Data here lives only in this browser.
 */

const DB_NAME = 'bmib_db';
const DB_VERSION = 2;

const STORES = [
  'candles',
  'signals',
  'signal_events',
  'paper_positions',
  'backtests',
  'backtest_trades',
  'strategy_configs',
  'scanner_results',
  'system_logs',
  'watchlist',
  'settings',
];

function getDb() {
  if (typeof window === 'undefined') return null;
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      // v2: signals are keyed by fingerprint (append-only lifecycle records)
      if (oldVersion < 2 && db.objectStoreNames.contains('signals')) {
        const os = tx.objectStore('signals');
        if (!os.indexNames.contains('byFingerprint')) os.createIndex('byFingerprint', 'fingerprint');
      }
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
          if (store === 'candles') {
            os.createIndex('bySymbolInterval', 'symbolInterval');
          }
          if (store === 'signals') {
            os.createIndex('byFingerprint', 'fingerprint');
            os.createIndex('bySymbol', 'symbol');
            os.createIndex('byTimestamp', 'timestamp');
          }
          if (store === 'settings') {
            // settings uses fixed string keys, not autoincrement ids
          }
        }
      }
    },
  });
}

export class CandleCache {
  async getCandles(symbol, interval) {
    const db = await getDb();
    if (!db) return [];
    const key = `${symbol.toUpperCase()}:${interval}`;
    const tx = db.transaction('candles', 'readonly');
    const idx = tx.store.index('bySymbolInterval');
    const record = await idx.get(key);
    return record?.candles || [];
  }

  async putCandles(symbol, interval, candles) {
    const db = await getDb();
    if (!db) return;
    const key = `${symbol.toUpperCase()}:${interval}`;
    const tx = db.transaction('candles', 'readwrite');
    const idx = tx.store.index('bySymbolInterval');
    const existing = await idx.get(key);
    const record = { symbolInterval: key, symbol, interval, candles, updatedAt: Date.now() };
    if (existing) record.id = existing.id;
    await tx.store.put(record);
    await tx.done;
  }
}

export const candleCache = new CandleCache();

// ---- Signal Journal ------------------------------------------------------
export async function saveSignal(signal) {
  const db = await getDb();
  if (!db) return;
  await db.add('signals', { ...signal, savedAt: Date.now() });
}

export async function listSignals({ limit = 200, symbol = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let all = await db.getAllFromIndex('signals', 'byTimestamp');
  all = all.reverse();
  if (symbol) all = all.filter((s) => s.symbol === symbol);
  return all.slice(0, limit);
}

// ---- Paper Trading ---------------------------------------------------
export async function createPaperPosition(position) {
  const db = await getDb();
  if (!db) return;
  return db.add('paper_positions', { ...position, createdAt: Date.now(), status: 'OPEN' });
}

export async function updatePaperPosition(id, updates) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.get('paper_positions', id);
  if (!existing) return;
  await db.put('paper_positions', { ...existing, ...updates });
}

export async function listPaperPositions() {
  const db = await getDb();
  if (!db) return [];
  return db.getAll('paper_positions');
}

// ---- Settings / Strategy Config --------------------------------------
export async function getSetting(key, fallback = null) {
  const db = await getDb();
  if (!db) return fallback;
  const record = await db.get('settings', key).catch(() => null);
  return record ? record.value : fallback;
}

export async function setSetting(key, value) {
  const db = await getDb();
  if (!db) return;
  await db.put('settings', { id: key, value, updatedAt: Date.now() });
}

// ---- Watchlist ----------------------------------------------------------
export async function getWatchlist() {
  const db = await getDb();
  if (!db) return [];
  const record = await db.get('settings', 'watchlist').catch(() => null);
  return record?.value || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
}

export async function setWatchlist(symbols) {
  return setSetting('watchlist', symbols);
}

// ---- System Logs ----------------------------------------------------------
export async function logSystemEvent(event) {
  const db = await getDb();
  if (!db) return;
  await db.add('system_logs', { ...event, timestamp: Date.now() });
  // trim to last 500
  const all = await db.getAll('system_logs');
  if (all.length > 500) {
    const excess = all.slice(0, all.length - 500);
    const tx = db.transaction('system_logs', 'readwrite');
    for (const e of excess) await tx.store.delete(e.id);
    await tx.done;
  }
}

export async function listSystemLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  const all = await db.getAll('system_logs');
  return all.slice(-limit).reverse();
}

// ---- Backtests ----------------------------------------------------------
export async function saveBacktest(result) {
  const db = await getDb();
  if (!db) return;
  return db.add('backtests', { ...result, createdAt: Date.now() });
}

export async function listBacktests() {
  const db = await getDb();
  if (!db) return [];
  return db.getAll('backtests');
}


// ---- Signal lifecycle records (fingerprint-keyed, append-only history) ----
export async function saveSignalRecord(record) {
  const db = await getDb();
  if (!db) return;
  const clean = JSON.parse(JSON.stringify(record));
  const existing = await db.getFromIndex('signals', 'byFingerprint', record.fingerprint);
  if (existing) clean.id = existing.id;
  clean.timestamp = record.firstSeen;
  await db.put('signals', clean);
}

export async function loadSignalRecords() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.getAll('signals');
  return all.filter((r) => r.fingerprint);
}

export async function saveSignalEvent(event) {
  const db = await getDb();
  if (!db) return;
  await db.add('signal_events', JSON.parse(JSON.stringify(event)));
}

export async function listSignalEvents(limit = 300) {
  const db = await getDb();
  if (!db) return [];
  const all = await db.getAll('signal_events');
  return all.slice(-limit).reverse();
}

// ---- Retention policy (spec section 45) -------------------------------------
export async function applyRetention({ maxCandleSets = 60, maxLogs = 500, maxEvents = 5000 } = {}) {
  const db = await getDb();
  if (!db) return;
  const candles = await db.getAll('candles');
  if (candles.length > maxCandleSets) {
    candles.sort((a, b) => a.updatedAt - b.updatedAt);
    const tx = db.transaction('candles', 'readwrite');
    for (const c of candles.slice(0, candles.length - maxCandleSets)) await tx.store.delete(c.id);
    await tx.done;
  }
  const events = await db.getAll('signal_events');
  if (events.length > maxEvents) {
    const tx = db.transaction('signal_events', 'readwrite');
    for (const e of events.slice(0, events.length - maxEvents)) await tx.store.delete(e.id);
    await tx.done;
  }
  // signals and backtests are kept indefinitely; logs rotate in logSystemEvent
}
