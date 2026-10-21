'use client';

import { useState } from 'react';
import { historicalDataEngine } from '../../lib/binance/historical';
import { backtestEngine, chooseHigherTimeframes } from '../../lib/backtest/backtestEngine';
import { useConfigStore } from '../../lib/runtime/configStore';
import { saveBacktest } from '../../lib/storage/db';

export default function BacktestPage() {
  const config = useConfigStore((s) => s.config);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval_] = useState('15m');
  const [candleCount, setCandleCount] = useState(3000);
  const [phase, setPhase] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [wf, setWf] = useState(null);
  const [mc, setMc] = useState(null);
  const [variants, setVariants] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setPhase('loading');
    setError(null);
    setResult(null);
    setWf(null);
    setMc(null);
    setVariants(null);
    try {
      const { candles } = await historicalDataEngine.load({ symbol, interval, count: candleCount });
      setPhase('precompute');
      const pre = await backtestEngine.precompute({ symbol, candles, execInterval: interval, config, onProgress: setProgress });
      setPhase('simulate');
      const sim = backtestEngine.simulate(candles, pre.signals, { minScore: config.minScore, minRR: config.minRR });
      setResult({ candles, pre, sim, buckets: backtestEngine.scoreBucketAnalysis(sim.trades) });
      await saveBacktest({ symbol, interval, candleCount, metrics: sim.metrics });
      setPhase('done');
    } catch (err) {
      setError(err.message);
      setPhase(null);
    }
  }

  async function runWalkForward() {
    if (!result) return;
    setPhase('walkforward');
    const bars = Math.floor(result.candles.length / 5);
    const out = backtestEngine.walkForward(result.candles, result.pre.signals, {
      trainBars: bars * 2,
      validationBars: bars,
      testBars: bars,
      base: {},
    });
    setWf(out);
    setPhase('done');
  }

  function runMonteCarlo() {
    if (!result) return;
    setMc(backtestEngine.monteCarlo(result.sim.trades, { iterations: 1000, seed: 42 }));
  }

  async function runVariants() {
    if (!result) return;
    setPhase('variants');
    const out = await backtestEngine.compareVariants({ symbol, candles: result.candles, execInterval: interval, config });
    setVariants(out);
    setPhase('done');
  }

  const [htf, mtf] = chooseHigherTimeframes(interval);

  return (
    <div className="space-y-4 px-3 py-4">
      <div className="card space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <TextField label="Symbol" value={symbol} onChange={setSymbol} />
          <TextField label="Interval" value={interval} onChange={setInterval_} />
          <NumField label="Candles" value={candleCount} onChange={setCandleCount} />
        </div>
        <button onClick={run} disabled={!!phase} className="w-full rounded-lg bg-accent-dim py-2.5 text-sm text-accent disabled:opacity-50">
          {phase === 'precompute' ? `Precomputing… ${progress ? Math.round((progress.index / progress.total) * 100) : 0}%` : phase === 'simulate' ? 'Simulating…' : phase === 'loading' ? 'Loading candles…' : 'Run Backtest'}
        </button>
        <p className="text-[10px] leading-relaxed text-base-500">
          Causal walk-forward over real historical Binance candles (HTF≈{htf}, MTF≈{mtf}, synthesized from {interval} via wall-clock resampling — see README). No look-ahead: signals at bar i only see candles[0..i].
        </p>
      </div>

      {error && <div className="rounded-lg border border-short/40 bg-short-dim/30 p-3 text-xs text-short">DATA CONNECTION ERROR: {error}</div>}

      {result && (
        <>
          <div className="card p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-base-500">Metrics ({result.sim.trades.length} trades)</div>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm">
              {Object.entries(result.sim.metrics).filter(([, v]) => typeof v !== 'object').map(([k, v]) => (
                <MetricRow key={k} label={k} value={v} />
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-base-500">Score Range Analysis</div>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-base-700 text-base-500"><th className="py-1 text-start">Score</th><th className="py-1 text-end">Trades</th><th className="py-1 text-end">Win%</th><th className="py-1 text-end">Net R</th></tr></thead>
              <tbody>
                {Object.entries(result.buckets).map(([range, s]) => (
                  <tr key={range} className="border-b border-base-800">
                    <td className="mono-num py-1">{range}</td>
                    <td className="mono-num py-1 text-end">{s.trades}</td>
                    <td className="mono-num py-1 text-end">{s.winRate != null ? (s.winRate * 100).toFixed(0) + '%' : '—'}</td>
                    <td className="mono-num py-1 text-end">{s.netR.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={runWalkForward} disabled={!!phase} className="flex-1 rounded-lg border border-base-600 py-2 text-xs text-base-300">Walk-Forward</button>
            <button onClick={runMonteCarlo} className="flex-1 rounded-lg border border-base-600 py-2 text-xs text-base-300">Monte Carlo</button>
            <button onClick={runVariants} disabled={!!phase} className="flex-1 rounded-lg border border-base-600 py-2 text-xs text-base-300">A/B/C/D</button>
          </div>

          {wf && (
            <div className="card p-4 text-xs">
              <div className="mb-2 text-[10px] uppercase tracking-wide text-base-500">Walk-Forward — Verdict: <span className={wf.verdict === 'HOLDS_OUT_OF_SAMPLE' ? 'text-long' : 'text-warn'}>{wf.verdict}</span></div>
              <Row label="Avg train expectancy (R)" value={wf.avgTrainExpectancyR?.toFixed(3)} />
              <Row label="Avg test expectancy (R)" value={wf.avgTestExpectancyR?.toFixed(3)} />
              <Row label="Degradation" value={wf.degradation?.toFixed(3)} />
              <Row label="Out-of-sample trades" value={wf.outOfSample.totalTrades} />
              <Row label="Out-of-sample win rate" value={(wf.outOfSample.winRate * 100).toFixed(1) + '%'} />
            </div>
          )}

          {mc && mc.ready && (
            <div className="card p-4 text-xs">
              <div className="mb-2 text-[10px] uppercase tracking-wide text-base-500">Monte Carlo (1000 reshuffles) — how much drawdown is just ordering luck</div>
              <Row label="Max Drawdown p50 / p95 / p99 (R)" value={`${mc.maxDrawdownR.p50?.toFixed(2)} / ${mc.maxDrawdownR.p95?.toFixed(2)} / ${mc.maxDrawdownR.p99?.toFixed(2)}`} />
              <Row label="Final R p5 / p50 / p95" value={`${mc.finalR.p5?.toFixed(2)} / ${mc.finalR.p50?.toFixed(2)} / ${mc.finalR.p95?.toFixed(2)}`} />
              <Row label="P(final R < 0)" value={(mc.probabilityNegative * 100).toFixed(1) + '%'} />
            </div>
          )}

          {variants && (
            <div className="card p-4 text-xs overflow-x-auto">
              <div className="mb-2 text-[10px] uppercase tracking-wide text-base-500">Strategy Variants — what each extra condition adds</div>
              <table className="w-full">
                <thead><tr className="border-b border-base-700 text-base-500"><th className="py-1 text-start">Variant</th><th className="py-1 text-end">Trades</th><th className="py-1 text-end">Win%</th><th className="py-1 text-end">Expectancy R</th><th className="py-1 text-end">Net R</th><th className="py-1 text-end">PF</th></tr></thead>
                <tbody>
                  {Object.entries(variants).map(([k, v]) => (
                    <tr key={k} className="border-b border-base-800">
                      <td className="py-1">{k}<div className="text-[9px] text-base-500">{v.label}</div></td>
                      <td className="mono-num py-1 text-end">{v.metrics.totalTrades}</td>
                      <td className="mono-num py-1 text-end">{(v.metrics.winRate * 100).toFixed(0)}%</td>
                      <td className="mono-num py-1 text-end">{v.metrics.expectancyR.toFixed(3)}</td>
                      <td className="mono-num py-1 text-end">{v.metrics.netR.toFixed(2)}</td>
                      <td className="mono-num py-1 text-end">{Number.isFinite(v.metrics.profitFactor) ? v.metrics.profitFactor.toFixed(2) : '∞'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricRow({ label, value }) {
  const display = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(3) : '∞') : String(value);
  return (
    <>
      <div className="text-base-400">{label}</div>
      <div className="mono-num text-end text-base-100">{display}</div>
    </>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-base-400">{label}</span>
      <span className="mono-num text-base-100">{value}</span>
    </div>
  );
}
function TextField({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] text-base-400">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="mono-num w-full rounded-lg border border-base-600 bg-base-800 px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
    </label>
  );
}
function NumField({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] text-base-400">{label}</div>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="mono-num w-full rounded-lg border border-base-600 bg-base-800 px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
    </label>
  );
}
