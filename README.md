# Binance Market Intelligence Bot — v3

Real-time Binance **spot market** analysis and signal-confluence engine, with a mobile-app-style Arabic (RTL) UI, causal (no-look-ahead) backtesting with walk-forward and Monte Carlo, append-only signal lifecycle tracking, a Binance **Futures** context panel (funding, open interest, long/short ratio, live liquidations), real free-news/sentiment integration, and a professional alert pipeline — Telegram, webhook and native Web Push — that fires from the server, so it works even with every browser fully closed. 66 automated tests (`npm test`) run against known reference values and mocked network calls.

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

## What changed in v3 (in direct response to your last message)

1. **"The signal was a very bad miss, I think the analysis is wrong."**
   I can't diagnose a specific past trade without the symbol/time (tell me
   and I will look at exactly what the engine saw) — but the honest,
   general answer is in "Understanding your Score" below, and I used this
   round to add the context (funding, OI, liquidations, news, whole-market
   sentiment) that the engine previously couldn't see at all, which is the
   most likely real fix available.
2. **"I want the strongest possible 2026-grade algorithms."** I will not
   invent a marketing label for this — see "Understanding your Score".
   What I *did* add is real, additional, previously-missing data (Futures
   positioning + liquidations + news + macro sentiment), each turned into
   explainable reasons/warnings exactly like the existing engines, in
   `lib/futures/futuresContextEngine.js`.
3. **"Alert me, even with the browser closed, when there's a ≥80-score
   professional setup."** Built: `app/api/cron/scan` is a server route
   that re-runs the real `SignalEngine` (not a simplified copy) on your
   watchlist and sends Telegram / webhook / Web Push when a signal is
   `*_CONFIRMED` and its score clears `config.alerts.minScoreForAlert`
   (default 80) — entirely server-side, no tab required. See "Alerts that
   work with the browser closed" below for exactly how to trigger it on a
   schedule for free.
4. **"Find more free Binance links and other platforms — news, etc. —
   and integrate everything into the analysis."** Added, all free and
   key-free: Binance Futures funding rate / open interest / long-short
   ratio (`lib/binance/futures.js`), Binance's live liquidation stream
   (`lib/binance/liquidations.js`), free RSS news from CoinDesk /
   Cointelegraph / Decrypt / CryptoSlate (`lib/external/news.js`), and the
   Fear & Greed Index + CoinGecko global market data
   (`lib/external/marketContext.js`). See "Futures Context & External
   Data" below for why this is advisory, not folded into the score.
5. **"Clearer signals for entering Futures."** The Analyzer now shows a
   Futures Context panel under every signal with a direction: funding
   rate and what it means for *this* trade, open-interest trend, recent
   liquidation pressure, and leverage-aware estimated liquidation prices
   at 5x/10x/20x/25x next to your actual stop-loss — see `FuturesPanel.jsx`.

### Understanding your Score (please read this before trusting any alert)

The 0–100 confluence Score counts how many independent, real conditions
(structure, POC, volume, multi-timeframe alignment, price action, R:R...)
lined up — **it is not a win probability**, and the app has said so from
the first delivery (`scoreNote` in the UI, `disclaimer` on every signal).
An 80-score setup failing is not evidence of a bug by itself; markets have
genuine tail risk no confluence count can remove. The only honest way to
know this config's *actual* historical hit rate at a given score is
**Backtest → Score Range Analysis**, which is already built and now
linked directly from Settings → Alerts. Please run it on your exact
config/symbols before trusting the alert threshold — if a score bucket's
real win rate disappoints you there, that's the system telling you the
truth, and the fix is to raise `minScore`/`minRR` or add gates, not to
assume the scoring formula is broken. If you *do* find a concrete case
where the engine's stated reasons don't match what the chart actually
shows (e.g. it claimed "bullish structure" during a clear downtrend),
that's a real bug report — tell me the symbol, timeframe and approximate
time and I will trace it through the exact code path.

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
- **Web Push could not be tested against a real push service** in the
  sandbox that built this (no network access) — the code follows the
  standard Push API / `web-push` library exactly, but please click
  Settings → "Send Test Push" yourself right after deploying.
- **The news "heuristic" is keyword counting, not NLP sentiment** — it is
  labeled as exactly that everywhere it appears (`KEYWORD_HEURISTIC_NOT_NLP`)
  and is never used to gate or score a signal.
- **Futures funding/OI/liquidations/news are NOT part of the scored
  confluence and are not backtested** — the backtester only has
  historical candles, not historical funding or news, so mixing this in
  would produce a score that looks validated but isn't. It's shown as its
  own panel and included as extra context in alert messages instead.
- **Vercel Hobby's cron can only fire once a day**, sometime within the
  scheduled hour, not to the minute — confirmed from Vercel's own current
  docs while building this. For real-time-ish alerting on the free tier,
  use the included GitHub Actions workflow instead (every 5 minutes, free)
  — see "Alerts that work with the browser closed".
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
npm test           # 66 unit tests: real formulas (Wilder RSI, POC, causal structure), no-look-ahead backtest,
                   # REST 429 handling, WS dedup, mocked Supabase storage, cron alert gating, Futures context
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

## Alerts that work with the browser closed

`app/api/cron/scan` is a normal Next.js route handler that re-runs the
real `SignalEngine` on a watchlist and sends alerts — it has no browser
dependency at all. The only piece YOU need to provide is something
outside the browser that calls it on a schedule. Three free-or-cheap
options, pick one:

| Option | Frequency | Cost | Setup |
|---|---|---|---|
| **GitHub Actions** (included) | every 5 min | free | 2 repo secrets, see below |
| **cron-job.org** (or similar) | down to 1 min | free | point it at the URL + header |
| **Vercel Cron** (`vercel.json`, included) | once/day (Hobby) · per-minute (Pro, $20/mo) | free–$20/mo | already wired, just deploy |

### 1. Set the secret
Add `CRON_SECRET` (any long random string) to your environment (`.env.local`
and Vercel's Project → Environment Variables). Every call to
`/api/cron/scan` must present it as header `x-cron-secret: <value>` or
query `?secret=<value>` — except Vercel's own Cron invocations, which the
route trusts automatically via Vercel's `x-vercel-cron` header (only when
actually running on Vercel's infrastructure, checked server-side).

### 2. Pick what the scan alerts on
Two independent paths run on every invocation, so you can use either or
both:

- **Single-tenant env fallback** — zero Supabase needed. Set
  `CRON_SYMBOLS` (comma-separated), `CRON_MIN_SCORE`, and
  `CRON_TELEGRAM_BOT_TOKEN`/`CRON_TELEGRAM_CHAT_ID` and/or
  `CRON_WEBHOOK_URL` in `.env.example` / Vercel env vars. Simple, but
  duplicate alerts are possible across runs (no persistent dedupe without
  a database) until a signal's state changes.
- **Supabase multi-user mode** — set `SUPABASE_SERVICE_ROLE_KEY` (see
  below). The cron job then reads *every* opted-in user's saved
  watchlist, strategy config, Telegram/webhook settings, and Web Push
  subscriptions from Supabase (bypassing RLS with the service-role key,
  since there's no "calling browser" in a cron context), evaluates their
  watchlist, and properly dedupes using the `notified_at` column on the
  `signals` table — each qualifying setup notifies exactly once until it
  closes.

Check **More → System Health → "Background Alerts"** any time to see
which of these are actually configured, with no secrets displayed.

### 3. Trigger it for free every 5 minutes (GitHub Actions)
This repo includes `.github/workflows/scan.yml`, ready to go:
1. Push this repo to GitHub (if you haven't already).
2. Repo → **Settings → Secrets and variables → Actions** → add:
   - `APP_URL` = `https://your-app.vercel.app`
   - `CRON_SECRET` = the same value you set on Vercel
3. That's it — GitHub picks up the schedule from the committed file. Use
   the Actions tab → "Run workflow" to fire one immediately and confirm
   it reaches your deployment before trusting the schedule.

(GitHub's scheduled-workflow minimum is 5 minutes and is "best effort" —
fine for this, not for anything needing exact timing.)

### 4. Web Push (native OS notifications, optional, needs Supabase)
Telegram/webhook work with zero extra setup beyond §2. For an actual OS
push notification (no Telegram app required):
```bash
node scripts/generate-vapid-keys.mjs
```
Copy the three printed values into your env vars, then in the app:
**Settings → Notifications → Enable Push Notifications** (requires
Supabase — the subscription has to live somewhere the cron job running
with nobody's browser open can read it from). Click "Send Test Push"
right after enabling to confirm delivery; I could not test this against
a real push service in the sandbox that built it (no network access).

### Running your own 24/7 Node process instead
If you'd rather not depend on any of the above, `lib/` is plain ES
modules with no browser-only globals except `lib/binance/ws.js` (guarded
by `typeof window`) and `public/sw.js`. Run a small always-on Node 18+
process anywhere (a VPS, Fly.io, Railway, a Raspberry Pi) that imports
`historicalDataEngine`, `signalEngine`, `lib/cron/alertScan.js#scanWatchlist`,
and calls `lib/notifications/notify.js#dispatch()` on an interval — Node
18+ has global `fetch`, no extra dependency needed.

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

## Futures Context & External Data

Everything below is free and key-free, and is kept deliberately SEPARATE
from the scored confluence (see "Understanding your Score" above) —
shown as its own panel, and folded into alert message text, never into
the 0–100 number:

- **`lib/binance/futures.js`** — Binance USD-M Futures public endpoints
  (`fapi.binance.com`): funding rate + mark price (`/fapi/v1/premiumIndex`),
  open interest (current + history), global long/short account ratio,
  taker buy/sell volume ratio. No API key, no account/order endpoints.
- **`lib/binance/liquidations.js`** — Binance's own official all-market
  liquidation WebSocket (`wss://fstream.binance.com/ws/!forceOrder@arr`),
  a real-time feed of actual liquidation orders, not an estimate.
- **`lib/external/news.js`** — aggregates free public RSS feeds (CoinDesk,
  Cointelegraph, Decrypt, CryptoSlate), server-side (these feeds don't
  send CORS headers, so this can't run in the browser directly). The
  "bullish/bearish keyword" count shown next to headlines is a crude
  heuristic, explicitly labeled as such — not real NLP sentiment.
- **`lib/external/marketContext.js`** — Fear & Greed Index
  (`api.alternative.me`) and CoinGecko's free `/global` endpoint (BTC/ETH
  dominance, total market cap).
- **`lib/futures/futuresContextEngine.js`** — turns the raw numbers above
  into explainable reasons/warnings exactly like the rest of the app
  (e.g. "extremely positive funding — longs are crowded, long-squeeze
  risk" or "open interest falling — move may be short-covering, not fresh
  conviction"), plus leverage-aware estimated liquidation prices
  (`estimateLiquidation`, explicitly approximate/isolated/no-fees).
- **`components/FuturesPanel.jsx`** — renders all of the above under any
  signal with a direction, on the Analyzer page.

## Project structure

```
app/                    Mobile pages: Home (/), Market, Analyzer, Signals,
                         More (→ Backtest, Paper Trading, System, Settings)
app/api/cron/scan/       Background alert scan (Telegram/webhook/Web Push, works with no browser open)
app/api/cron/status/     No-secret config diagnostics (shown on System Health)
app/api/push/            subscribe/ (save a Web Push subscription), test/ (send yourself one)
app/api/market-context/  Fear & Greed + CoinGecko global (server-side, avoids CORS)
app/api/news/            Aggregated free RSS news, optionally filtered by asset
app/api/futures-context/ Binance Futures funding/OI/long-short snapshot for one symbol
components/              AppShell, StatusBar, BottomNav, Chart, SignalCard, FuturesPanel
lib/binance/             rest.js, ws.js, symbols.js, historical.js, futures.js, liquidations.js
lib/data/                candle model, CandleValidator, resampleByTime, dataQuality
lib/indicators/          EMA/SMA/RSI/MACD/ATR/ADX/Stochastic/Bollinger/VWAP
lib/structure/           MarketStructureEngine (causal swings, close-based BOS/CHoCH, retest, sweeps)
lib/volume/              VolumeEngine (relative volume, estimated delta — labeled as such)
lib/volumeProfile/       VolumeProfileEngine (POC/VAH/VAL/HVN/LVN)
lib/priceAction/         PriceActionEngine
lib/mtf/                 MultiTimeframeEngine
lib/signals/             SignalEngine (scoring, STRATEGY_VARIANTS A/B/C/D/FULL) + SignalTracker (lifecycle)
lib/risk/                RiskEngine (SL/TP/position sizing, advisory only)
lib/futures/             FuturesContextEngine (funding/OI/long-short/liquidations → explainable, NOT scored)
lib/external/            news.js (free RSS aggregation), marketContext.js (Fear&Greed, CoinGecko)
lib/scanner/              ScannerService (batched ticker snapshot + progressive deep scan)
lib/backtest/             BacktestEngine (precompute/simulate, walk-forward, Monte Carlo, variant comparison)
lib/cron/                 alertScan.js — the testable core of the background scan (DI'd candle loading)
lib/storage/               db.js (adapter) + indexedDbBackend.js + supabaseBackend.js
lib/supabase/                client.js (browser, anonymous auth) + serverClient.js (RLS-scoped + service-role)
lib/notifications/         notify.js (Telegram/webhook/browser + alert gating), webPush.js (server-only), registerPush.js (client)
lib/config/                 Strategy config defaults, incl. config.alerts
lib/runtime/                 Zustand stores (config, market) + shared SignalTracker singleton
lib/i18n/                    Arabic/English dictionary + useT() hook
lib/hooks/                   useConnectionStatus, useSymbolAnalysis, useFuturesContext, useSupabaseStatus
public/sw.js                  Service worker — shows a Web Push notification even with no tab open
scripts/generate-vapid-keys.mjs  One-time VAPID key pair generator (no extra dependency)
vercel.json                   Vercel Cron entry (daily — Hobby-plan safe; tighten it if you're on Pro)
.github/workflows/scan.yml    Free alternative: triggers the scan every 5 minutes via GitHub Actions
tests/                       66 node:test unit tests: engines, mocked Supabase, Futures context, cron gating (npm test)
docs/supabase-schema.sql     Full schema incl. push_subscriptions and signals.notified_at for cron dedupe
```

## License / disclaimer

Educational/research use. Not investment advice. You are responsible for
your own trading decisions.
