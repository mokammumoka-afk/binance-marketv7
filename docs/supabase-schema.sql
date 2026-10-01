-- =============================================================================
-- Binance Market Intelligence Bot — Supabase schema
-- =============================================================================
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor →
-- New query → paste → Run). It creates every table lib/storage/supabaseBackend.js
-- talks to, with Row Level Security so each browser only ever sees its own
-- data, scoped to auth.uid().
--
-- AUTH MODEL: the app signs each visitor in with Supabase ANONYMOUS auth (no
-- email/password screen). That gives every browser a stable auth.uid() to
-- scope rows to. Before this schema is useful you MUST also enable:
--   Supabase Dashboard → Authentication → Providers → Anonymous Sign-Ins → ON
-- Anonymous identities are per-browser (stored in localStorage), not an
-- account you can log into from another device — see README "Supabase setup"
-- if you want real multi-device accounts (email/password or magic link) on
-- top of the same schema; RLS policies below need no change for that, since
-- they only ever check auth.uid().
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- candles: one row per (user, symbol, interval); candles stored as jsonb
-- ---------------------------------------------------------------------------
create table if not exists candles (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  interval text not null,
  candles jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, symbol, interval)
);
alter table candles enable row level security;
create policy "candles_owner" on candles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- signals: append-only lifecycle records, one row per SignalTracker fingerprint
-- ---------------------------------------------------------------------------
create table if not exists signals (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  symbol text not null,
  timeframe text,
  direction text,
  state text,
  status text default 'ACTIVE',
  score integer,
  entry numeric,
  stop_loss numeric,
  tp1 numeric,
  tp2 numeric,
  tp3 numeric,
  risk_reward numeric,
  reasons jsonb,
  warnings jsonb,
  failed_conditions jsonb,
  score_breakdown jsonb,
  indicators jsonb,
  structure jsonb,
  poc numeric,
  mtf text,
  mode text,
  strategy_version text,
  strategy_variant text,
  candle_open_time bigint,
  data_used_until bigint,
  first_seen bigint,
  expires_at bigint,
  mfe_r numeric default 0,
  mae_r numeric default 0,
  hits jsonb,
  result text,
  suppressed_notification boolean default false,
  history jsonb default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);
create index if not exists idx_signals_user_symbol on signals (user_id, symbol);
alter table signals enable row level security;
create policy "signals_owner" on signals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- signal_events: one row per SignalTracker history entry (NEW/STATE_CHANGE/
-- TP1/TP2/TP3/SL/EXPIRED, ...) — this is what repaint-protection replays.
-- ---------------------------------------------------------------------------
create table if not exists signal_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text,
  symbol text,
  ts bigint not null,
  type text not null,
  note text,
  state text,
  score integer,
  candle bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_signal_events_user_ts on signal_events (user_id, ts desc);
alter table signal_events enable row level security;
create policy "signal_events_owner" on signal_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- paper_positions: simulated positions only — never a real Binance order
-- ---------------------------------------------------------------------------
create table if not exists paper_positions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  direction text not null,
  entry numeric not null,
  stop_loss numeric,
  tp1 numeric,
  tp2 numeric,
  tp3 numeric,
  score integer,
  strategy_version text,
  status text default 'OPEN',
  exit_price numeric,
  result text,
  r_multiple numeric,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table paper_positions enable row level security;
create policy "paper_positions_owner" on paper_positions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- backtests / backtest_trades
-- ---------------------------------------------------------------------------
create table if not exists backtests (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  interval text not null,
  candle_count integer,
  metrics jsonb,
  created_at timestamptz not null default now()
);
alter table backtests enable row level security;
create policy "backtests_owner" on backtests for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists backtest_trades (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  backtest_id bigint references backtests(id) on delete cascade,
  direction text,
  entry_price numeric,
  exit_price numeric,
  result text,
  r numeric,
  score integer
);
alter table backtest_trades enable row level security;
create policy "backtest_trades_owner" on backtest_trades for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_settings: strategy config, language, watchlist — one row per key
-- ---------------------------------------------------------------------------
create table if not exists user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table user_settings enable row level security;
create policy "user_settings_owner" on user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- system_logs
-- ---------------------------------------------------------------------------
create table if not exists system_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  level text default 'info',
  message text,
  payload jsonb,
  timestamp bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_system_logs_user_ts on system_logs (user_id, id desc);
alter table system_logs enable row level security;
create policy "system_logs_owner" on system_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- Sanity check: after running this, Settings → System (in the app) should show
-- "Supabase: CONNECTED" once NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are set and
-- Anonymous Sign-Ins are enabled.
-- =============================================================================
