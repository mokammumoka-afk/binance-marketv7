/**
 * Maps a signal's real state + entry-zone info to the emoji/label badges
 * the user asked for (🟢 LONG CONFIRMED, 🟡 WAITING FOR RETEST, 🔵 BREAKOUT,
 * 🔴 SHORT CONFIRMED, ⚪ NO TRADE). This is purely presentational — it reads
 * `state`/`entryType`/`entryPending` that SignalEngine/SignalTracker already
 * computed from real analysis; it never invents a state of its own. Shared
 * between the UI (SignalCard) and notification text (notify.js#formatEvent)
 * so what a Telegram alert says always matches what the app shows.
 *
 * @param {{direction: string|null, state: string, entryType?: string, entryPending?: boolean}} s
 */
export function getDisplayBadge(s) {
  const direction = s?.direction;
  const state = s?.state;

  if (!direction || state === 'NO_TRADE') return { emoji: '⚪', labelEn: 'NO TRADE', labelAr: 'لا تداول' };
  if (state === 'WAIT') return { emoji: '⚪', labelEn: 'WAIT', labelAr: 'انتظار' };
  if (state === 'EXPIRED') return { emoji: '⚪', labelEn: 'EXPIRED', labelAr: 'منتهية' };
  if (state === 'INVALIDATED') return { emoji: '⚪', labelEn: 'INVALIDATED', labelAr: 'ملغاة' };

  const isLong = direction === 'LONG';
  const confirmed = state === 'LONG_CONFIRMED' || state === 'SHORT_CONFIRMED';
  const isBreakout = s.entryType === 'BREAKOUT_ENTRY';

  if (!confirmed) {
    // WATCH, or a *_CANDIDATE that hasn't cleared every hard gate yet.
    if (s.entryPending) return { emoji: '🟡', labelEn: 'WAITING FOR RETEST', labelAr: 'بانتظار إعادة الاختبار' };
    if (isBreakout) return { emoji: '🔵', labelEn: 'BREAKOUT', labelAr: 'اختراق' };
    return {
      emoji: '🟡',
      labelEn: state === 'WATCH' ? 'WATCH' : `${direction} CANDIDATE`,
      labelAr: state === 'WATCH' ? 'مراقبة' : isLong ? 'مرشح شراء' : 'مرشح بيع',
    };
  }

  if (isBreakout) {
    return {
      emoji: '🔵',
      labelEn: `${direction} BREAKOUT CONFIRMED`,
      labelAr: isLong ? 'اختراق مؤكد — شراء' : 'اختراق مؤكد — بيع',
    };
  }
  return isLong
    ? { emoji: '🟢', labelEn: 'LONG CONFIRMED', labelAr: 'شراء مؤكد' }
    : { emoji: '🔴', labelEn: 'SHORT CONFIRMED', labelAr: 'بيع مؤكد' };
}
