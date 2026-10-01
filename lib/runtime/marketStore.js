'use client';
import { create } from 'zustand';

/** Shared, in-memory market state (never persisted, never invented). */
export const useMarketStore = create((set) => ({
  rows: [], // scanner rows built from real ticker + real analysis
  signals: {}, // symbol -> latest SignalEngine result
  scanning: false,
  lastScanAt: null,
  scanError: null,
  setRows: (rows) => set({ rows, lastScanAt: Date.now() }),
  setSignal: (symbol, signal) => set((s) => ({ signals: { ...s.signals, [symbol]: signal } })),
  setScanning: (scanning) => set({ scanning }),
  setScanError: (scanError) => set({ scanError }),
}));
