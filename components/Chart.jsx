'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

export default function Chart({ candles, structure, volumeProfile, plan, direction }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#121722' }, textColor: '#B7C2CF' },
      grid: { vertLines: { color: '#1F2733' }, horzLines: { color: '#1F2733' } },
      rightPriceScale: { borderColor: '#2A3441' },
      timeScale: { borderColor: '#2A3441', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      height: 480,
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#3FB68B',
      downColor: '#D65D6B',
      borderVisible: false,
      wickUpColor: '#3FB68B',
      wickDownColor: '#D65D6B',
    });
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      color: '#3D4A5C',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resize = () => chart.applyOptions({ width: containerRef.current.clientWidth });
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !candles?.length) return;
    const data = candles.map((c) => ({
      time: Math.floor(c.openTime / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    seriesRef.current.setData(data);

    const volData = candles.map((c) => ({
      time: Math.floor(c.openTime / 1000),
      value: c.volume,
      color: c.close >= c.open ? 'rgba(63,182,139,0.4)' : 'rgba(214,93,107,0.4)',
    }));
    volumeSeriesRef.current.setData(volData);

    // Price lines: POC / VAH / VAL / Entry / SL / TP
    const series = seriesRef.current;
    (series.__priceLines || []).forEach((pl) => series.removePriceLine(pl));
    const lines = [];

    if (volumeProfile?.ready) {
      lines.push(
        series.createPriceLine({ price: volumeProfile.poc.price, color: '#C9963A', lineWidth: 2, lineStyle: 0, title: 'POC' })
      );
      if (volumeProfile.vah) {
        lines.push(series.createPriceLine({ price: volumeProfile.vah, color: '#5B6B80', lineWidth: 1, lineStyle: 2, title: 'VAH' }));
      }
      if (volumeProfile.val) {
        lines.push(series.createPriceLine({ price: volumeProfile.val, color: '#5B6B80', lineWidth: 1, lineStyle: 2, title: 'VAL' }));
      }
    }

    if (plan && direction) {
      lines.push(series.createPriceLine({ price: plan.stopLoss, color: '#D65D6B', lineWidth: 1, lineStyle: 3, title: 'SL' }));
      if (plan.tp1) lines.push(series.createPriceLine({ price: plan.tp1, color: '#3FB68B', lineWidth: 1, lineStyle: 3, title: 'TP1' }));
      if (plan.tp2) lines.push(series.createPriceLine({ price: plan.tp2, color: '#3FB68B', lineWidth: 1, lineStyle: 2, title: 'TP2' }));
      if (plan.tp3) lines.push(series.createPriceLine({ price: plan.tp3, color: '#3FB68B', lineWidth: 1, lineStyle: 1, title: 'TP3' }));
    }

    series.__priceLines = lines;

    // Swing markers from structure engine
    if (structure?.ready) {
      const markers = [
        ...structure.highs.map((h) => ({
          time: Math.floor(candles[h.index]?.openTime / 1000),
          position: 'aboveBar',
          color: '#8493A6',
          shape: 'arrowDown',
          text: h.label,
        })),
        ...structure.lows.map((l) => ({
          time: Math.floor(candles[l.index]?.openTime / 1000),
          position: 'belowBar',
          color: '#8493A6',
          shape: 'arrowUp',
          text: l.label,
        })),
      ].filter((m) => m.time);
      markers.sort((a, b) => a.time - b.time);
      series.setMarkers(markers);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, structure, volumeProfile, plan, direction]);

  return <div ref={containerRef} className="w-full" />;
}
