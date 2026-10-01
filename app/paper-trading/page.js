'use client';

import { useEffect, useState } from 'react';
import {
  listPaperPositions,
  createPaperPosition,
  updatePaperPosition,
} from '../../lib/storage/db';
import { useSymbolAnalysis } from '../../lib/hooks/useSymbolAnalysis';

export default function PaperTradingPage() {
  const [positions, setPositions] = useState([]);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const { signal } = useSymbolAnalysis(symbol);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const rows = await listPaperPositions();
    setPositions(rows.sort((a, b) => b.createdAt - a.createdAt));
  }

  async function openFromSignal() {
    if (!signal || signal.state === 'NO_TRADE' || !signal.direction) return;
    await createPaperPosition({
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.price,
      stopLoss: signal.plan?.stopLoss,
      tp1: signal.plan?.tp1,
      tp2: signal.plan?.tp2,
      tp3: signal.plan?.tp3,
      score: signal.score,
      strategyVersion: signal.strategyVersion,
    });
    refresh();
  }

  async function closePosition(pos, result) {
    const exitPrice =
      result === 'SL' ? pos.stopLoss : result === 'TP1' ? pos.tp1 : result === 'TP2' ? pos.tp2 : pos.tp3;
    const risk = Math.abs(pos.entry - pos.stopLoss);
    const reward = pos.direction === 'LONG' ? exitPrice - pos.entry : pos.entry - exitPrice;
    const rMultiple = risk ? reward / risk : 0;
    await updatePaperPosition(pos.id, {
      status: 'CLOSED',
      exitPrice,
      result,
      rMultiple,
      closedAt: Date.now(),
    });
    refresh();
  }

  const open = positions.filter((p) => p.status === 'OPEN');
  const closed = positions.filter((p) => p.status === 'CLOSED');
  const netR = closed.reduce((a, p) => a + (p.rMultiple || 0), 0);
  const winRate = closed.length ? closed.filter((p) => (p.rMultiple || 0) > 0).length / closed.length : null;

  return (
    <div className="space-y-4 px-3 py-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          className="bg-base-800 border border-base-600 rounded px-2 py-1.5 text-sm mono-num w-40"
        />
        {signal && (
          <span className="text-xs text-base-400">
            {signal.state} · Score {signal.score}
          </span>
        )}
        <button
          onClick={openFromSignal}
          disabled={!signal || signal.state === 'NO_TRADE'}
          className="px-3 py-1.5 text-xs bg-long-dim text-long-bright rounded hover:bg-long-dim/70 disabled:opacity-40"
        >
          Open Virtual Position From Current Signal
        </button>
        <p className="text-[11px] text-base-500 w-full mt-1">
          Simulated positions only — no order is ever sent to Binance.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Open Positions" value={open.length} />
        <StatCard label="Closed Positions" value={closed.length} />
        <StatCard label="Net R" value={netR.toFixed(2)} tone={netR >= 0 ? 'long' : 'short'} />
      </div>

      <div className="card p-4">
        <div className="text-xs uppercase tracking-wide text-base-500 mb-3">Open Positions</div>
        {open.length === 0 && <div className="text-xs text-base-400">No open virtual positions.</div>}
        <div className="space-y-2">
          {open.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-base-800 pb-2 text-sm">
              <div>
                <span className={`mono-num ${p.direction === 'LONG' ? 'text-long' : 'text-short'}`}>{p.direction}</span>{' '}
                <span className="mono-num text-base-100">{p.symbol}</span>{' '}
                <span className="text-base-500 text-xs">entry {p.entry?.toFixed(4)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => closePosition(p, 'TP1')} className="text-xs text-long hover:underline">
                  Hit TP1
                </button>
                <button onClick={() => closePosition(p, 'SL')} className="text-xs text-short hover:underline">
                  Hit SL
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4 overflow-x-auto">
        <div className="text-xs uppercase tracking-wide text-base-500 mb-3">
          Closed Positions {winRate !== null && `· Win Rate ${(winRate * 100).toFixed(1)}%`}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-base-500 border-b border-base-700">
              <th className="text-left py-1">Symbol</th>
              <th className="text-left py-1">Direction</th>
              <th className="text-right py-1">Entry</th>
              <th className="text-right py-1">Exit</th>
              <th className="text-right py-1">Result</th>
              <th className="text-right py-1">R</th>
            </tr>
          </thead>
          <tbody>
            {closed.map((p) => (
              <tr key={p.id} className="border-b border-base-800">
                <td className="py-1 mono-num">{p.symbol}</td>
                <td className={`py-1 ${p.direction === 'LONG' ? 'text-long' : 'text-short'}`}>{p.direction}</td>
                <td className="py-1 text-right mono-num">{p.entry?.toFixed(4)}</td>
                <td className="py-1 text-right mono-num">{p.exitPrice?.toFixed(4)}</td>
                <td className="py-1 text-right">{p.result}</td>
                <td className={`py-1 text-right mono-num ${(p.rMultiple || 0) >= 0 ? 'text-long' : 'text-short'}`}>
                  {p.rMultiple?.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-base-100';
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wide text-base-500">{label}</div>
      <div className={`text-xl font-semibold mono-num mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}
