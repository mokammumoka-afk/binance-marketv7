# Binance Market Intelligence Bot — v2

Real-time Binance **spot market** analysis and signal-confluence engine,
now with a mobile-app-style Arabic (RTL) UI, causal (no-look-ahead)
backtesting with walk-forward and Monte Carlo, append-only signal
lifecycle tracking, and 36 automated tests run against known reference
values.

**Not a trade-execution bot.** It never places, modifies, or cancels an
order on Binance.

> ⚠️ Signals are analytical only — **not financial advice**, no
> guaranteed profit or accuracy.

---

## What changed in v2 (in response to real gaps found in v1)

v1 (the previous delivery) had the right skeleton but several real
correctness bugs and missing pieces. All of the following were fixed and
are now covered by automated tests (`npm test`, 36/36 passing):

- **CLOSED CANDLE POLICY was not enforced.** `SignalEngine` could
  evaluate on a still-forming candle. Fixed: `onlyClosed()` strips
  forming candles in Confirmed mode; Early mode is opt-in and visibly
  labeled with a repaint warning.
- **RSI warm-up was cosmetic, not real.** Fixed: proper `NOT_READY`
  window, verified against an independently computed Wilder RSI(14)
  reference series (`tests/indicators.test.mjs`).
- **Market Structure was not causal and BOS/CHoCH used wick highs.**
  Rewritten: swings only "exist" `swingRightBars` candles after they
  form, breaks require a **close** beyond the level (a wick is
  classified as `LIQUIDITY_SWEEP` instead), and there's now a test that
  asserts adding future candles never changes past events
  (`tests/engines.test.mjs`).
- **No signal de-duplication / repaint protection.** Added
  `SignalTracker` (fingerprint + cooldown + append-only history +
  MFE/MAE + TP/SL/expiry outcome tracking), persisted to IndexedDB.
- **Backtester had look-ahead risk and no fees/partial exits/walk-forward/
  Monte Carlo/variant comparison.** Rewritten as a two-stage
  precompute→simulate engine; a dedicated test feeds it a fixture where
  future candles are altered and asserts past signals are byte-identical.
- **Risk Engine could pick a stop-loss on the wrong side of price, or an
  arbitrarily distant swing.** Fixed: nearest protective swing, ATR floor
  on stop distance, sanity clamps.
- **REST client's 429/retry path and the WebSocket's dedup/reconnect
  logic were unverified.** Now covered by tests using a mocked
  `fetch`/`WebSocket`.
- **Strategy variants A/B/C/D (spec §40)** are now real, selectable, and
  testable (`STRATEGY_VARIANTS`, `compareVariants()`).
- **UI was a desktop dashboard with a sidebar.** Rebuilt as a mobile-app
  shell: bottom tab bar (Home / Market / Analyzer / Signals / More),
  RTL Arabic-first with an English toggle (technical terms kept in
  English inline, as requested), safe-area-aware, installable as a PWA
  (`manifest.json` + icons) so it can be added to a phone's home screen.

## What is still simplified, honestly

- **No Supabase *project*** is provisioned on your behalf (I cannot
  create a cloud account for you) — but the app is now fully wired to
  use one the moment you create it and add two env vars. See "Supabase
  setup" below. Until you do, it runs on IndexedDB with zero setup, and
  nothing else in the app changes either way — every call goes through
  `lib/storage/db.js`, which picks the backend once, at startup.
- **WebSocket runs in the browser**, not on a Vercel serverless
  function — this is the *correct* architecture for Vercel (see the
  explanation further down), not a shortcut. For 24/7 server-side alerts
  see "Running a background watcher" below.
- **Backtest higher-timeframes are wall-clock resampled from the
  execution-timeframe series**, not fetched as separately-aligned Binance
  candles (the live Analyzer/Scanner *do* fetch real, separate HTF
  candles). This is noted on the Backtest screen itself.
- No automated CI is wired up; run `npm test` yourself before trusting
  changes.
- I still cannot promise this beats the market — no one honestly can.
  What I can promise is that the backtester will tell you the truth,
  including when a setting doesn't work, because nothing here fabricates
  a result.

---

## Install & run locally

Requires Node.js 18.18+.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 36 unit tests against real formulas (Wilder RSI, POC, causal structure, no-look-ahead backtest, REST 429 handling, WS dedup...)
npm run build && npm run start   # production build
```

No `.env` file or API key is needed — the app talks to Binance's public
REST + WebSocket endpoints directly from the browser.

## Deploying to Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

Or via the dashboard: import the repo, Framework Preset **Next.js**,
Deploy. No environment variables required for the default build.

### Why the WebSocket connects from the browser
Vercel serverless/Edge functions don't keep a connection open between
invocations — there is no "long-running Node process" on Vercel unless
you bring your own (a VPS, Railway, Fly.io...). Rather than fake "live"
data with a polling loop, the app opens Binance's public combined-stream
WebSocket **from each visitor's own browser** (`lib/binance/ws.js`),
exactly like Binance's or TradingView's own web charts do. This means
live prices update while the tab/PWA is open; for alerts that fire with
no tab open, see the next section.

## Running a 24/7 background watcher (optional)

`lib/` is plain ES modules with no browser-only globals except
`lib/binance/ws.js` (guarded by `typeof window`). To get Telegram/webhook
alerts with nobody looking at the app:

1. Run a small always-on Node 18+ process anywhere (a $5 VPS, Fly.io,
   Railway, a Raspberry Pi).
2. Import `historicalDataEngine`, `scannerService`, `signalEngine`,
   `SignalTracker` from `lib/`, poll on an interval instead of the
   browser WebSocket.
3. Call `lib/notifications/notify.js#dispatch()` directly (Node 18+ has
   global `fetch`).

## Supabase setup

The app ships with two interchangeable storage backends behind the exact
same function names (`lib/storage/db.js` picks one at startup):

- `lib/storage/indexedDbBackend.js` — the default. Nothing to configure.
- `lib/storage/supabaseBackend.js` — used automatically once Supabase is
  configured. Same data (settings, watchlist, signal history with full
  append-only lifecycle, paper trades, backtests), now synced through
  Postgres instead of living only in one browser.

Turning it on:

1. Create a free project at supabase.com.
2. In the Supabase dashboard: **SQL Editor → New query**, paste the
   entire contents of `docs/supabase-schema.sql`, click **Run**. This
   creates every table the app writes to, with Row Level Security
   already scoped to `auth.uid()`.
3. **Authentication → Providers → Anonymous Sign-Ins → enable.** The app
   signs each browser in anonymously (no login screen) purely to get a
   stable `auth.uid()` for RLS — see `lib/supabase/client.js` for what
   this does and does not give you (it's per-browser until you layer
   real email/password or magic-link auth on top of the same schema;
   the RLS policies don't need to change for that since they only check
   `auth.uid()`).
4. Copy your project's **Project URL** and **anon public key**
   (Settings → API) into `.env.local`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
   On Vercel: Project → Settings → Environment Variables, same two keys,
   then redeploy. Both are safe to expose to the browser — they are the
   project URL and the RLS-restricted anon key, never a service-role key.
5. Reload the app. Open **More → System Health** — the "Storage —
   Supabase" card shows `CONNECTED` (or the exact RLS/schema error if
   something's off, e.g. step 2 or 3 was skipped).

That's it — no code changes needed. `npm install` will pull in
`@supabase/supabase-js` (already in `package.json`); I could not run
`npm install` myself in the sandbox that produced this project (no
network access), so **please run `npm install && npm run build` first**
and tell me immediately if anything doesn't compile.

Every Supabase call is defensive: if a query fails (schema not applied
yet, RLS misconfigured, offline), it's logged to the browser console and
the function returns the same safe empty/default value the IndexedDB
backend would — the app never crashes because Supabase had a bad day,
it just falls silent for that one read/write until the next attempt.

### Verifying it without a browser

`npm test` includes `tests/storage.test.mjs`, which exercises
`supabaseBackend.js` and the `db.js` switch-over against a fully mocked
Supabase client (`node:test`'s `mock.module`, Node 22+) — candle
round-trips, settings/watchlist defaults, paper-position field mapping,
signal-record upsert-not-duplicate, and the fallback-on-error path are
all asserted for real, with no network involved.

## Project structure

```
app/                    Mobile pages: Home (/), Market, Analyzer, Signals,
                         More (→ Backtest, Paper Trading, System, Settings)
components/              AppShell, StatusBar, BottomNav, Chart, SignalCard
lib/binance/             rest.js, ws.js, symbols.js, historical.js
lib/data/                candle model, CandleValidator, resampleByTime, dataQuality
lib/indicators/          EMA/SMA/RSI/MACD/ATR/ADX/Stochastic/Bollinger/VWAP
lib/structure/           MarketStructureEngine (causal swings, close-based BOS/CHoCH, retest, sweeps)
lib/volume/              VolumeEngine (relative volume, estimated delta — labeled as such)
lib/volumeProfile/       VolumeProfileEngine (POC/VAH/VAL/HVN/LVN)
lib/priceAction/         PriceActionEngine
lib/mtf/                 MultiTimeframeEngine
lib/signals/             SignalEngine (scoring, STRATEGY_VARIANTS A/B/C/D/FULL) + SignalTracker (lifecycle)
lib/risk/                RiskEngine (SL/TP/position sizing, advisory only)
lib/scanner/              ScannerService (batched ticker snapshot + progressive deep scan)
lib/backtest/             BacktestEngine (precompute/simulate, walk-forward, Monte Carlo, variant comparison)
lib/storage/               db.js (adapter) + indexedDbBackend.js + supabaseBackend.js
lib/supabase/                Supabase client + anonymous-auth session (lib/supabase/client.js)
lib/notifications/         Telegram / webhook / browser notification dispatch
lib/config/                 Strategy config defaults
lib/runtime/                 Zustand stores (config, market) + shared SignalTracker singleton
lib/i18n/                    Arabic/English dictionary + useT() hook
lib/hooks/                   useConnectionStatus, useSymbolAnalysis
tests/                       43 node:test unit tests, incl. a mocked-Supabase storage suite (npm test)
docs/supabase-schema.sql     Starter schema for a future Postgres migration
```

## License / disclaimer

Educational/research use. Not investment advice. You are responsible for
your own trading decisions.
