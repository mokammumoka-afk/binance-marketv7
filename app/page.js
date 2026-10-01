'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { scannerService } from '../lib/scanner/scanner';
import { getWatchlist } from '../lib/storage/db';
import { useConfigStore } from '../lib/runtime/configStore';
import { useT } from '../lib/i18n';
import { getTracker } from '../lib/runtime/tracker';
import SignalCard from '../components/SignalCard';

function ChangePill({ pct }) {
  if (pct === null || pct === undefined) return <span className="text-base-500">—</span>;
  const up = pct >= 0;
  return <span className={`mono-num ${up ? 'text-long' : 'text-short'}`}>{up ? '+' : ''}{pct.toFixed(2)}%</span>;
}

export default function HomePage() {
  const { t } = useT();
  const config = useConfigStore((s) => s.config);
  const loaded = useConfigStore((s) => s.loaded);
  const [rows, setRows] = useState([]);
  const [deep, setDeep] = useState({});
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState(null);
  const [watchlist, setWatchlist] = useState([]);

  const refresh = useCallback(async () => {
    if (!loaded) return;
    try {
      const wl = await getWatchlist();
      setWatchlist(wl);
      const snap = await scannerService.snapshot({ watchlist: wl, limit: 100 });
      setRows(snap);
      setScanning(true);
      const tracker = getTracker(config.signalCooldownMs);
      const candidates = [...snap.filter((r) => r.isWatchlisted), ...snap.filter((r) => !r.isWatchlisted)].slice(0, 12);
      await scannerService.deepScan(candidates, config, {
        max: 12,
        tracker,
        onRow: (row) => setDeep((d) => ({ ...d, [row.symbol]: row })),
      });
      setScanning(false);
    } catch (err) {
      setError(err.message);
      setScanning(false);
    }
  }, [config, loaded]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 45_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const deepRows = Object.values(deep);
  const bestLong = deepRows.filter((r) => r.state === 'LONG_CONFIRMED' || r.state === 'LONG_CANDIDATE').sort((a, b) => b.score - a.score);
  const bestShort = deepRows.filter((r) => r.state === 'SHORT_CONFIRMED' || r.state === 'SHORT_CANDIDATE').sort((a, b) => b.score - a.score);
  const topMovers = [...rows].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 6);
  const topVolume = [...rows].sort((a, b) => b.volume24h - a.volume24h).slice(0, 6);

  return (
    <div className="space-y-5 px-3 py-4">
      {error && <div className="rounded-lg border border-short/40 bg-short-dim/30 p-3 text-xs text-short">{t('dataError')}: {error}</div>}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wide text-base-400">{t('home.best')}</h2>
          {scanning && <span className="text-[10px] text-base-500">{t('home.scanning')}</span>}
        </div>
        {bestLong.length === 0 && bestShort.length === 0 ? (
          <div className="card p-4 text-xs text-base-400">{scanning ? t('loading') : t('home.noSetups')}</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {[...bestLong.slice(0, 3), ...bestShort.slice(0, 3)].map((r) => (
              <Link key={r.symbol} href={`/analyzer?symbol=${r.symbol}`} className="block w-64 shrink-0">
                <SignalCard signal={r.signal} compact />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wide text-base-400">{t('home.movers')}</h2>
        <div className="card divide-y divide-base-800">
          {rows.length === 0 && <div className="p-4 text-xs text-base-400">{t('loading')}</div>}
          {topMovers.map((r) => (
            <Link key={r.symbol} href={`/analyzer?symbol=${r.symbol}`} className="tap-row flex items-center justify-between px-4 py-2.5 text-sm active:bg-base-800">
              <span className="mono-num text-base-100">{r.symbol}</span>
              <span className="mono-num text-base-300">{fmtPrice(r.price)}</span>
              <ChangePill pct={r.change24h} />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wide text-base-400">{t('home.volume')}</h2>
        <div className="card divide-y divide-base-800">
          {topVolume.map((r) => (
            <Link key={r.symbol} href={`/analyzer?symbol=${r.symbol}`} className="tap-row flex items-center justify-between px-4 py-2.5 text-sm active:bg-base-800">
              <span className="mono-num text-base-100">{r.symbol}</span>
              <span className="mono-num text-base-300">{(r.volume24h / 1_000_000).toFixed(1)}M USDT</span>
              <ChangePill pct={r.change24h} />
            </Link>
          ))}
        </div>
      </section>

      {watchlist.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-base-400">{t('home.watch')}</h2>
          <div className="card divide-y divide-base-800">
            {watchlist.map((s) => {
              const row = rows.find((r) => r.symbol === s);
              return (
                <Link key={s} href={`/analyzer?symbol=${s}`} className="tap-row flex items-center justify-between px-4 py-2.5 text-sm active:bg-base-800">
                  <span className="mono-num text-base-100">{s}</span>
                  <span className="mono-num text-base-300">{row ? fmtPrice(row.price) : '—'}</span>
                  <ChangePill pct={row?.change24h} />
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function fmtPrice(n) {
  if (n == null) return '—';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}
