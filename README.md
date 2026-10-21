# Binance Market Intelligence Bot — v4

Real-time Binance **spot market** analysis and signal-confluence engine, with a mobile-app-style Arabic (RTL) UI, causal (no-look-ahead) backtesting with walk-forward and Monte Carlo, append-only signal lifecycle tracking, a Binance **Futures** context panel (funding, open interest, long/short ratio, live liquidations), real free-news/sentiment integration, and a professional alert pipeline — Telegram, webhook and native Web Push — that fires from the server, so it works even with every browser fully closed. 80 automated tests (`npm test`) run against known reference values and mocked network calls.

**Not a trade-execution bot.** It never places, modifies, or cancels an
order on Binance.

> ⚠️ Signals are analytical only — **not financial advice**, no
> guaranteed profit or accuracy.

---

## What changed in v2 (in response to real gaps found in v1)

v1 (the previous delivery) had the right skeleton but several real
correctness bugs and missing pieces. All of the following were fixed and
are now covered by automated tests. The suite was 36 tests when these v2 fixes landed, 66 after v3, and is 80 as of v4 (`npm test`, 80/80 passing — see "What changed in v3" and "What changed in v4"):

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

## What changed in v4 (a real bug, not a cosmetic one)

A detailed report flagged the most important bug this project has had:
**the "Entry" shown on every signal was effectively `Current Price`**, so it
kept drifting as the market moved instead of staying fixed at the moment a
signal fired. The root cause was in the engine, not the UI — `entryMode`
defaulted to `'CLOSE'`, which `SignalEngine#_entry()` resolved straight to
the live close. Fixed properly, end to end:

- **`SignalEngine#_entry()` was rewritten.** The default mode is now
  `AUTO`, which derives a real Entry Zone from structure/Volume-Profile/
  retest analysis (`EntryType`: `BREAKOUT_ENTRY`, `RETEST_ENTRY`,
  `POC_RETEST_ENTRY`, `VALUE_AREA_RETEST_ENTRY`, or an explicit
  `MARKET_ENTRY` only when that's genuinely what the analysis found) and
  returns a plain-language `rationale` for every case — never a silent
  "whatever the price is."
- **A new hard gate, `hard.entryReached`**, means a setup whose computed
  zone price hasn't been reached yet is a `*_CANDIDATE` (shown as
  🟡 WAITING FOR RETEST), never promoted to `*_CONFIRMED` just because its
  score was high.
- **`currentPrice` and `plan.entry` are now reported as two separate
  fields everywhere** — SignalCard, the Analyzer, Paper Trading, the
  Futures panel, Telegram/webhook/push alerts, and the saved signal
  record. The same bug (`entry: signal.price`) had also quietly leaked
  into the Paper Trading "open from signal" flow, the Futures liquidation
  panel, and the cron/background-alert path — all four are fixed the
  same way, not just the main card.
- **MACD was added as a real, scored component** (user's point 4's 8th
  confirmation factor was missing before), and the default score weights
  were rebalanced to the user's explicit scheme (Structure 20, Volume
  Profile 15, Volume 15, EMA 10, RSI 10, MACD 10, Breakout/Retest 10,
  Risk/Reward 10 — sums to 100). Multi-timeframe alignment moved from a
  partial score contributor to a hard pass/fail gate, on the reasoning
  that conflicting timeframes should block a trade outright.
- **Stop Loss and each Take Profit now carry a plain-language reason**
  (`plan.stopLossReason`, `plan.tp1Reason`, ...) — e.g. "Below the recent
  swing low at 84,700, plus an ATR volatility buffer" — shown directly
  under each number on the card, not just implied.
- **The backtester now respects pending Entry Zones too.** It used to
  fill every signal at the next candle's open regardless of what the
  Entry Zone said; now a pending (retest) entry is simulated as a real
  limit order that only fills once price actually trades into the zone
  within a bounded window, and produces no trade at all if price never
  comes back — otherwise backtested win rates would have been inflated
  by fills that couldn't have happened live.
- **State badges** (🟢 LONG CONFIRMED / 🟡 WAITING FOR RETEST / 🔵 BREAKOUT
  / 🔴 SHORT CONFIRMED / ⚪ NO TRADE) are now computed by one shared
  function (`lib/signals/displayState.js`) used by both the UI and every
  notification channel, so a Telegram alert always matches what the app
  shows.
- Per the user's explicit clarification, the score is still **labeled
  "Score," never "Confidence,"** anywhere in the UI or notifications —
  exactly to avoid implying it's a win probability (see "Understanding
  your Score" above, which already made this argument before this report
  arrived).
- 14 new tests (`tests/entry-zone.test.mjs` plus additions to
  `tests/system.test.mjs`) cover: Entry Zone \u2260 current price when price
  has run away from any logical level, a legitimate immediate breakout
  entry, POC/VAH retest anchoring, the SHORT mirror case, the manual
  override modes, MACD scoring in both directions, the `DATA_UNAVAILABLE`
  path, the CANDIDATE-never-auto-promotes-while-pending gate, the
  backtester's pending-zone fill/expiry behavior, and a project-wide
  `Math.random()` audit (allowlisting only the two documented retry/
  reconnect-jitter call sites — this is also explained inline in both
  files now, with the comment itself asserted by a test).

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

**Requires Node.js 22.3+** — not 18.x. This is a hard requirement, not a
suggestion: `npm test` uses `node:test`'s `mock.module()`, which Node
only shipped starting in **v22.3.0** (confirmed against Node's own
changelog) — it does not exist on 18.x or 20.x at all, flagged or not.
`package.json`'s `engines.node` is set to `>=22.3.0` accordingly. The
Next.js app itself (dev/build/start) would run fine on an older Node,
but since the test suite won't, there's no reason to pin the project to
two different minimums — just use 22+ for everything.

```bash
node -v             # confirm 22.3.0 or newer
npm install
npm run dev          # http://localhost:3000
npm test             # 80 unit tests — see "What changed in v3" and "What changed in v4" for what they cover
npm run build && npm run start   # production build
```

**Minimum to run locally: nothing.** No `.env` file or API key is needed
for the core app — it talks to Binance's public REST + WebSocket
endpoints directly from the browser. Everything below is additive:

| To use... | You also need |
|---|---|
| Nothing extra — core analysis, charting, backtesting | *(nothing)* |
| Synced storage across devices | 2 Supabase keys — see "Supabase setup" |
| Background alerts (Telegram/webhook) with the browser closed | `CRON_SECRET` + `CRON_SYMBOLS` + Telegram token/chat-id or a webhook URL — see "Alerts that work with the browser closed" |
| Native push notifications | the above, **+** Supabase, **+** 3 VAPID keys (`node scripts/generate-vapid-keys.mjs`) |
| Multi-user background alerts | the above, **+** `SUPABASE_SERVICE_ROLE_KEY` |

### Deploying to Vercel with the right Node version
Vercel's currently available runtimes are 24.x (default), 22.x, and
20.x — 18.x isn't offered at all anymore, and 20.x can't run `npm test`
for the reason above. Either leave `engines.node` as `>=22.3.0` in
`package.json` (Vercel reads this to pick a matching major version) or
explicitly set **Project Settings → Build and Deployment → Node.js
Version → 22.x**. Confirm with `node -v` in a build log if unsure.

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

**If you're not sure which to pick:**

| Your situation | Use |
|---|---|
| Just you, one or two symbols, comfortable with GitHub | GitHub Actions + the env-var fallback (§2) |
| Want the simplest possible setup, no GitHub repo involved | cron-job.org pointed at `/api/cron/scan` |
| Multiple people/browsers should each get their own alerts | GitHub Actions or cron-job.org + Supabase multi-user mode |
| Already paying for Vercel Pro anyway | Vercel Cron, tighten `vercel.json`'s schedule to per-minute |

`vercel.json` (already in this repo) wires the Vercel Cron option:
```json
{
  "crons": [{ "path": "/api/cron/scan", "schedule": "0 9 * * *" }]
}
```
That schedule (once daily, 09:00 UTC) is deliberately Hobby-plan-safe —
**a more frequent cron expression here fails `vercel deploy` outright on
Hobby**, it doesn't silently downgrade. If you're on Pro, tighten the
schedule yourself, e.g. `"*/5 * * * *"` for every 5 minutes.

### 1. Set the secret
Add `CRON_SECRET` (any long random string) to your environment (`.env.local`
and Vercel's Project → Environment Variables). Every call to
`/api/cron/scan` must present it as header `x-cron-secret: <value>` or
query `?secret=<value>` — except Vercel's own Cron invocations, which the
route trusts automatically via Vercel's `x-vercel-cron` header (only when
actually running on Vercel's infrastructure, checked server-side).

### Function duration vs. how many symbols/users one scan covers
`/api/cron/scan` sets `maxDuration = 120` (seconds). As of Vercel's own
current docs, **Hobby's function duration is 300s (default and max)**,
Pro/Enterprise default to the same 300s and can be configured higher —
so 120s leaves real headroom on every plan as of this writing (platform
limits do change over time; Vercel's dashboard is the source of truth if
something here is stale by the time you read it). `CRON_MAX_USERS` (25)
and `CRON_MAX_SYMBOLS_PER_USER` (8) in `.env.example` bound the work
regardless, so a scan degrades gracefully (fewer users/symbols per run)
rather than silently truncating mid-symbol if you ever are on a tighter
plan/limit — tune those two down first if you ever see a 504 in your
function logs, which is Vercel's standard "ran out of time" response.

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
This only prints three `KEY=value` lines to your terminal (uses Node's
built-in `crypto`, no network call, no file written) — it's on you to
copy them into `.env.local` / Vercel's env vars; nothing is saved
automatically. Each run generates a brand-new, unique key pair — don't
reuse one project's keys in another. Copy the three printed values, then
in the app:
**Settings → Notifications → Enable Push Notifications** (requires
Supabase — the subscription has to live somewhere the cron job running
with nobody's browser open can read it from). Click "Send Test Push"
right after enabling to confirm delivery; I could not test this against
a real push service in the sandbox that built it (no network access).

### Running your own 24/7 Node process instead
If you'd rather not depend on an external scheduler at all,
**`examples/watcher.mjs` is a real, runnable script** — not pseudo-code —
that imports the exact same `scanWatchlist()` the Next.js API route uses
and polls on an interval:
```bash
WATCH_SYMBOLS=BTCUSDT,ETHUSDT TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  node examples/watcher.mjs
```
Covers the single-tenant Telegram/webhook path only (no Supabase
multi-user mode, no Web Push — both are tied to the Next.js request
cycle); its header comment says so explicitly. `lib/` has no
browser-only globals except `lib/binance/ws.js` and `public/sw.js`
(both guarded by `typeof window`), so this runs in plain Node 22+ on any
always-on host (a VPS, Fly.io, Railway, a Raspberry Pi) — `fetch` is
global in Node 18+, nothing extra to install.

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

### Security: the service-role key (multi-user alerts only)

`SUPABASE_SERVICE_ROLE_KEY` is a different, far more powerful credential
than the anon key above — it bypasses Row Level Security entirely, so
whoever holds it can read or write **every** user's row in every table.
Only set it if you're using the Supabase multi-user alert path (see
"Alerts that work with the browser closed"); skip it entirely otherwise.
Ground rules this codebase follows, and that you should keep following
if you extend it:
- It is read **only** via `process.env.SUPABASE_SERVICE_ROLE_KEY` inside
  `lib/supabase/serverClient.js#getServiceRoleClient()` — grep the repo
  and that's the one place it's referenced.
  It is never imported from a `'use client'` file (which would bundle it
  into JavaScript shipped to every visitor's browser) and never appears
  in a `console.log`/`console.error` anywhere in this codebase (checked
  by hand while writing this).
- It must never be prefixed `NEXT_PUBLIC_` — that prefix is Next.js's own
  signal to include a variable in the browser bundle; a service-role key
  with that prefix is a public leak of full database access.
- `app/api/cron/status` reports *whether* it's configured (a boolean) and
  nothing else — no route in this app ever echoes the key's value back
  in a response, which is the other common way secrets leak (verbose
  error messages, debug endpoints).
- If you ever suspect it leaked, rotate it from Supabase's dashboard
  (Settings → API → service_role → Regenerate) — RLS means the anon key
  alone can't do equivalent damage, so this is the one credential in the
  whole project worth treating like a master password.

### Verifying it without a browser

`npm test` includes `tests/storage.test.mjs`, which exercises
`supabaseBackend.js` and the `db.js` switch-over against a fully mocked
Supabase client (`node:test`'s `mock.module`, Node 22.3+, see "Install") — candle
round-trips, settings/watchlist defaults, paper-position field mapping,
signal-record upsert-not-duplicate, and the fallback-on-error path are
all asserted for real, with no network involved.

## Futures Context & External Data

Everything below is free and key-free, and is kept deliberately SEPARATE
from the scored confluence (see "Understanding your Score" above) —
shown as its own panel, and folded into alert message text, never into
the 0–100 number.

**Data flow — who calls what, and why it's split this way:**
```
Browser (useFuturesContext hook)
   │
   ├─▶ GET /api/futures-context?symbol=BTCUSDT  ──▶ lib/binance/futures.js      ──▶ fapi.binance.com
   ├─▶ GET /api/news?asset=BTC                  ──▶ lib/external/news.js        ──▶ RSS feeds
   └─▶ GET /api/market-context                  ──▶ lib/external/marketContext.js ──▶ alternative.me, CoinGecko
```
`lib/external/news.js` and parts of `marketContext.js` talk to hosts that
don't send CORS headers — a direct browser `fetch()` to them would be
blocked by the browser itself. Every one of these Next.js API routes
(`app/api/*`) exists specifically to make that same request **from the
server instead**, same-origin from the browser's point of view, so no
CORS issue ever reaches the client. `lib/binance/futures.js` happens to
work with or without that hop (Binance does send CORS headers), but it's
routed the same way for one consistent pattern and so the background
cron job can reuse the identical code server-side.

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
examples/watcher.mjs          Real, runnable standalone 24/7 watcher (same scanWatchlist() as the API route)
vercel.json                   Vercel Cron entry (daily — Hobby-plan safe; tighten it if you're on Pro)
.github/workflows/scan.yml    Free alternative: triggers the scan every 5 minutes via GitHub Actions
.github/workflows/test.yml    Runs `npm test` on every push/PR (Vercel's own build does not)
tests/                       80 node:test unit tests: engines, mocked Supabase, Futures context, cron gating, Entry Zone logic (npm test)
docs/supabase-schema.sql     Full schema incl. push_subscriptions and signals.notified_at for cron dedupe
```

## License / disclaimer

Educational/research use. Not investment advice. You are responsible for
your own trading decisions.
