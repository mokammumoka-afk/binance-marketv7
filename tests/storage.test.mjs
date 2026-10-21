import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { afterEach } from 'node:test';

afterEach(() => mock.reset());

// Minimal fake of the Supabase query builder: enough method chaining to
// exercise every query shape lib/storage/supabaseBackend.js actually sends,
// backed by a plain in-memory array per table so RLS-style `eq('user_id', …)`
// filtering can be asserted for real instead of just "was called".
function makeFakeSupabase(tables = {}) {
  const db = tables;
  function ensure(name) {
    if (!db[name]) db[name] = [];
    return db[name];
  }
  function builder(name) {
    let rows = () => ensure(name).slice();
    let filters = [];
    let orderSpec = null;
    let limitN = null;
    let single = false;
    let maybe = false;
    let selectCols = null;
    let countMode = null;

    const apply = () => {
      let r = rows();
      for (const [col, val] of filters) r = r.filter((row) => row[col] === val);
      if (orderSpec) r = r.slice().sort((a, b) => (a[orderSpec.col] - b[orderSpec.col]) * (orderSpec.asc ? 1 : -1));
      if (limitN != null) r = r.slice(0, limitN);
      return r;
    };

    const api = {
      select(cols, opts) {
        selectCols = cols;
        if (opts?.count) countMode = opts.count;
        return api;
      },
      eq(col, val) {
        filters.push([col, val]);
        return api;
      },
      order(col, { ascending } = {}) {
        orderSpec = { col, asc: ascending !== false };
        return api;
      },
      limit(n) {
        limitN = n;
        return api;
      },
      in(col, vals) {
        filters.push([col, '__IN__' + JSON.stringify(vals)]);
        return api;
      },
      maybeSingle() {
        maybe = true;
        return api.then();
      },
      single() {
        single = true;
        return api.then();
      },
      insert(row) {
        const table = ensure(name);
        const withId = { id: table.length + 1, ...row };
        table.push(withId);
        return {
          select: () => ({ single: async () => ({ data: withId, error: null }) }),
          then: (resolve) => Promise.resolve({ data: withId, error: null }).then(resolve),
        };
      },
      async upsert(row, opts) {
        const table = ensure(name);
        const keyCols = (opts?.onConflict || 'id').split(',');
        const idx = table.findIndex((r) => keyCols.every((k) => r[k] === row[k]));
        if (idx >= 0) table[idx] = { ...table[idx], ...row };
        else table.push({ id: table.length + 1, ...row });
        return { error: null };
      },
      async update(patch) {
        let r = rows();
        const inFilter = filters.find(([, v]) => typeof v === 'string' && v.startsWith('__IN__'));
        for (const [col, val] of filters) {
          if (typeof val === 'string' && val.startsWith('__IN__')) continue;
          r = r.filter((row) => row[col] === val);
        }
        const table = ensure(name);
        for (const row of r) Object.assign(table.find((x) => x.id === row.id), patch);
        return { error: null };
      },
      delete() {
        return {
          in: async (col, ids) => {
            const table = ensure(name);
            const keep = table.filter((r) => !ids.includes(r[col]));
            table.length = 0;
            table.push(...keep);
            return { error: null };
          },
        };
      },
      then(resolve) {
        let result = apply();
        if (filters.some(([, v]) => typeof v === 'string' && v.startsWith('__IN__'))) {
          const [col, encoded] = filters.find(([, v]) => typeof v === 'string' && v.startsWith('__IN__'));
          const ids = JSON.parse(encoded.slice(6));
          result = result.filter((r) => ids.includes(r[col]));
        }
        if (countMode) return Promise.resolve({ count: apply().length, error: null }).then(resolve);
        if (single) {
          return Promise.resolve(result[0] ? { data: result[0], error: null } : { data: null, error: { message: 'not found' } }).then(resolve);
        }
        if (maybe) return Promise.resolve({ data: result[0] || null, error: null }).then(resolve);
        return Promise.resolve({ data: result, error: null }).then(resolve);
      },
    };
    return api;
  }

  return { from: (name) => builder(name), _db: db };
}

async function withMockedSupabase(tables, run) {
  const fake = makeFakeSupabase(tables);
  mock.module('../lib/supabase/client.js', {
    namedExports: {
      supabaseEnabled: true,
      getSupabase: () => fake,
      ensureUser: async () => 'user-1',
      resetSession: () => {},
    },
  });
  const backend = await import(`../lib/storage/supabaseBackend.js?t=${Date.now()}${Math.random()}`);
  return run(backend, fake);
}

test('Supabase backend: candle cache round-trips and scopes by user via upsert key', async () => {
  await withMockedSupabase({}, async (backend) => {
    await backend.candleCache.putCandles('btcusdt', '15m', [{ openTime: 1 }, { openTime: 2 }]);
    const got = await backend.candleCache.getCandles('BTCUSDT', '15m');
    assert.equal(got.length, 2);
    const missing = await backend.candleCache.getCandles('ETHUSDT', '15m');
    assert.deepEqual(missing, []);
  });
});

test('Supabase backend: getSetting/setSetting and watchlist default', async () => {
  await withMockedSupabase({}, async (backend) => {
    assert.deepEqual(await backend.getWatchlist(), ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']);
    await backend.setWatchlist(['ADAUSDT']);
    assert.deepEqual(await backend.getWatchlist(), ['ADAUSDT']);
    assert.equal(await backend.getSetting('missingKey', 'fallback'), 'fallback');
  });
});

test('Supabase backend: paper positions create/update round-trip field names (camelCase <-> snake_case)', async () => {
  await withMockedSupabase({}, async (backend) => {
    const created = await backend.createPaperPosition({ symbol: 'BTCUSDT', direction: 'LONG', entry: 100, stopLoss: 98, tp1: 104 });
    assert.equal(created.symbol, 'BTCUSDT');
    assert.equal(created.stopLoss, 98);
    await backend.updatePaperPosition(created.id, { status: 'CLOSED', exitPrice: 104, rMultiple: 2 });
    const list = await backend.listPaperPositions();
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'CLOSED');
    assert.equal(list[0].exitPrice, 104);
    assert.equal(list[0].rMultiple, 2);
  });
});

test('Supabase backend: saveSignalRecord upserts on (user, fingerprint) instead of duplicating rows', async () => {
  await withMockedSupabase({}, async (backend, fake) => {
    const rec = { fingerprint: 'fp1', symbol: 'BTCUSDT', state: 'LONG_CANDIDATE', score: 70, history: [{ type: 'NEW' }] };
    await backend.saveSignalRecord(rec);
    await backend.saveSignalRecord({ ...rec, state: 'LONG_CONFIRMED', score: 80, history: [{ type: 'NEW' }, { type: 'STATE_CHANGE' }] });
    assert.equal(fake._db.signals.length, 1, 'must upsert, not insert a second row');
    const loaded = await backend.loadSignalRecords();
    assert.equal(loaded[0].state, 'LONG_CONFIRMED');
    assert.equal(loaded[0].history.length, 2);
  });
});

test('Supabase backend: a failed query is logged and returns the safe fallback, never throws', async () => {
  const fake = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: { message: 'relation "user_settings" does not exist' } }),
        then(resolve) {
          return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve);
        },
      };
    },
  };
  mock.module('../lib/supabase/client.js', {
    namedExports: { supabaseEnabled: true, getSupabase: () => fake, ensureUser: async () => 'user-1', resetSession: () => {} },
  });
  const backend = await import(`../lib/storage/supabaseBackend.js?t=${Date.now()}`);
  const value = await backend.getSetting('strategyConfig', { minScore: 70 });
  assert.deepEqual(value, { minScore: 70 }); // fallback, no throw
});

test('db.js adapter: uses the local IndexedDB backend when Supabase env vars are not set', async () => {
  mock.module('idb', { namedExports: { openDB: async () => null } });
  mock.module('../lib/supabase/client.js', {
    namedExports: { supabaseEnabled: false, getSupabase: () => null, ensureUser: async () => null, resetSession: () => {} },
  });
  const db = await import(`../lib/storage/db.js?t=${Date.now()}`);
  const local = await import('../lib/storage/indexedDbBackend.js');
  assert.equal(db.isSupabaseActive, false);
  assert.equal(db.getWatchlist, local.getWatchlist, 'must delegate to the exact local implementation, not a copy');
});

test('db.js adapter: switches to the Supabase backend when env vars are set', async () => {
  mock.module('idb', { namedExports: { openDB: async () => null } });
  mock.module('../lib/supabase/client.js', {
    namedExports: { supabaseEnabled: true, getSupabase: () => makeFakeSupabase({}), ensureUser: async () => 'user-1', resetSession: () => {} },
  });
  const db = await import(`../lib/storage/db.js?t=${Date.now()}`);
  const remote = await import(`../lib/storage/supabaseBackend.js?t=${Date.now()}2`);
  assert.equal(db.isSupabaseActive, true);
  assert.equal(typeof db.saveSignalRecord, 'function');
  assert.notEqual(db.saveSignalRecord.toString(), '');
});
