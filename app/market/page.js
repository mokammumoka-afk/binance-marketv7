'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { scannerService } from '../../lib/scanner/scanner';
import { getWatchlist, setWatchlist as persistWatchlist } from '../../lib/storage/db';
import { useT } from '../../lib/i18n';

export default function MarketPage() {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [watchlist, setWl] = useState([]);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [sortKey, setSortKey] = useState('volume24h');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    let mounted = true;
    async function run() {
      try {
        const wl = await getWatchlist();
        if (mounted) setWl(wl);
        const snap = await scannerService.snapshot({ watchlist: wl, limit: 150 });
        if (mounted) {
          setRows(snap);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    run();
    const interval = setInterval(run, 20_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    let out = rows;
    if (search) out = out.filter((r) => r.symbol.includes(search.toUpperCase()));
    if (onlyWatch) out = out.filter((r) => watchlist.includes(r.symbol));
    return [...out].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [rows, search, onlyWatch, watchlist, sortKey, sortDir]);

  async function toggleFav(symbol) {
    const next = watchlist.includes(symbol) ? watchlist.filter((s) => s !== symbol) : [...watchlist, symbol];
    setWl(next);
    await persistWatchlist(next);
  }

  function sortBy(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  return (
    <div className="space-y-3 px-3 py-4">
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('market.search')}
          className="mono-num flex-1 rounded-lg border border-base-600 bg-base-800 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => setOnlyWatch((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-xs ${onlyWatch ? 'border-accent bg-accent-dim text-accent' : 'border-base-600 text-base-300'}`}
        >
          ★
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto text-[11px]">
        {[
          ['volume24h', t('home.volume')],
          ['change24h', '24h %'],
          ['price', t('entry')],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => sortBy(k)}
            className={`shrink-0 rounded-full border px-3 py-1 ${sortKey === k ? 'border-accent text-accent' : 'border-base-700 text-base-400'}`}
          >
            {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-short/40 bg-short-dim/30 p-3 text-xs text-short">{t('dataError')}</div>}
      {loading && <div className="p-6 text-center text-xs text-base-400">{t('loading')}</div>}

      <div className="card divide-y divide-base-800">
        {filtered.map((r) => (
          <div key={r.symbol} className="tap-row flex items-center gap-2 px-3 py-2.5 active:bg-base-800">
            <button onClick={() => toggleFav(r.symbol)} className="w-5 text-sm">
              {watchlist.includes(r.symbol) ? '★' : '☆'}
            </button>
            <Link href={`/analyzer?symbol=${r.symbol}`} className="flex flex-1 items-center justify-between">
              <span className="mono-num text-sm text-base-100">{r.symbol}</span>
              <div className="text-end">
                <div className="mono-num text-sm text-base-200">{r.price?.toLocaleString('en-US', { maximumFractionDigits: r.price >= 100 ? 2 : 6 })}</div>
                <div className={`mono-num text-[11px] ${r.change24h >= 0 ? 'text-long' : 'text-short'}`}>
                  {r.change24h >= 0 ? '+' : ''}
                  {r.change24h?.toFixed(2)}%
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
