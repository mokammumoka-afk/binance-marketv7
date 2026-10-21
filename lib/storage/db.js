'use client';

import { supabaseEnabled } from '../supabase/client';
import * as local from './indexedDbBackend';
import * as remote from './supabaseBackend';

/**
 * Storage adapter — every other file in this app imports from HERE, never
 * directly from indexedDbBackend.js or supabaseBackend.js. Which backend is
 * live is decided once, by whether NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are set:
 *
 *   - set        -> every call goes to Supabase (lib/storage/supabaseBackend.js).
 *                    A failed Supabase call (bad schema, RLS misconfigured,
 *                    offline) is logged to the console and returns a safe
 *                    empty/default value — it never silently falls back to
 *                    IndexedDB, because mixing the two per-call would split
 *                    your data across two stores without you knowing.
 *   - not set     -> every call goes to IndexedDB (lib/storage/indexedDbBackend.js),
 *                    exactly as before. This is the zero-setup default.
 *
 * See README "Supabase setup" and docs/supabase-schema.sql to enable the
 * first path.
 */
const backend = supabaseEnabled ? remote : local;

export const isSupabaseActive = supabaseEnabled;
export const candleCache = backend.candleCache;
export const saveSignal = backend.saveSignal;
export const listSignals = backend.listSignals;
export const createPaperPosition = backend.createPaperPosition;
export const updatePaperPosition = backend.updatePaperPosition;
export const listPaperPositions = backend.listPaperPositions;
export const getSetting = backend.getSetting;
export const setSetting = backend.setSetting;
export const getWatchlist = backend.getWatchlist;
export const setWatchlist = backend.setWatchlist;
export const logSystemEvent = backend.logSystemEvent;
export const listSystemLogs = backend.listSystemLogs;
export const saveBacktest = backend.saveBacktest;
export const listBacktests = backend.listBacktests;
export const saveSignalRecord = backend.saveSignalRecord;
export const loadSignalRecords = backend.loadSignalRecords;
export const saveSignalEvent = backend.saveSignalEvent;
export const listSignalEvents = backend.listSignalEvents;
export const applyRetention = backend.applyRetention;
