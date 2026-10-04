'use client';
import { useConfigStore } from '../runtime/configStore';

// Technical terms are kept in English next to the Arabic label, as requested.
const ar = {
  appName: 'Market Intelligence',
  'nav.home': 'الرئيسية', 'nav.market': 'السوق', 'nav.analyzer': 'المحلل', 'nav.signals': 'الإشارات', 'nav.more': 'المزيد',
  'nav.backtest': 'الاختبار الخلفي Backtest', 'nav.paper': 'التداول التجريبي Paper', 'nav.system': 'حالة النظام', 'nav.settings': 'الإعدادات',
  loading: 'جارٍ تحميل بيانات Binance الحقيقية…', dataError: 'DATA CONNECTION ERROR — تعذر الاتصال بـ Binance',
  source: 'المصدر', live: 'لحظي LIVE', historical: 'تاريخي HISTORICAL', lastUpdate: 'آخر تحديث',
  disclaimer: 'هذه الإشارات تحليلية وليست ضمانًا للربح ولا توصية مالية.',
  score: 'درجة التوافق', scoreNote: 'Signal Confluence Score — ليست نسبة نجاح',
  entry: 'الدخول Entry', stop: 'وقف الخسارة Stop Loss', tp: 'الهدف TP', rr: 'العائد/المخاطرة R:R',
  reasons: 'الأسباب', warnings: 'تحذيرات', failed: 'شروط لم تتحقق', trend: 'اتجاه السوق', structure: 'Market Structure',
  poc: 'منطقة التحكم POC', volume: 'الحجم', mtf: 'الأطر الزمنية MTF', rsi: 'RSI',
  'futures.heading': 'سياق الفيوتشر Futures Context', 'alerts.heading': 'التنبيهات الاحترافية',
  'state.LONG_CONFIRMED': 'شراء مؤكد', 'state.LONG_CANDIDATE': 'مرشح شراء', 'state.SHORT_CONFIRMED': 'بيع مؤكد', 'state.SHORT_CANDIDATE': 'مرشح بيع',
  'state.WATCH': 'مراقبة', 'state.WAIT': 'انتظار', 'state.NO_TRADE': 'لا تداول', 'state.INVALIDATED': 'ملغاة', 'state.EXPIRED': 'منتهية',
  BULLISH: 'صاعد', BEARISH: 'هابط', NEUTRAL: 'محايد', RANGE: 'عرضي', MIXED: 'متضارب', UNKNOWN: 'غير معروف',
  TREND_BULLISH: 'اتجاه صاعد', TREND_BEARISH: 'اتجاه هابط',
  'data.LIVE': 'لحظي', 'data.STALE': 'متأخر', 'data.DEGRADED': 'متدهور', 'data.DISCONNECTED': 'منقطع', 'data.DATA_ERROR': 'خطأ بيانات',
  mode: 'الوضع', 'mode.CONFIRMED': 'مؤكد (شمعة مغلقة)', 'mode.EARLY': 'مبكر EARLY', earlyWarn: 'الإشارة المبكرة قد تتغير قبل إغلاق الشمعة (Repaint).',
  'home.pulse': 'نبض السوق', 'home.best': 'أفضل الفرص الآن', 'home.movers': 'الأكثر حركة', 'home.volume': 'الأعلى سيولة', 'home.watch': 'قائمة المراقبة',
  'home.noSetups': 'لا توجد فرص مؤكدة حاليًا — وهذا قرار صحيح أحيانًا (NO TRADE).', 'home.scanning': 'يفحص السوق…',
  'market.search': 'ابحث عن رمز', 'market.watchOnly': 'المفضلة فقط', 'market.sort': 'ترتيب',
  'analyzer.symbol': 'الرمز', 'analyzer.tf': 'الإطار', 'analyzer.chart': 'الرسم', 'analyzer.signal': 'الإشارة', 'analyzer.levels': 'المستويات', 'analyzer.mtf': 'MTF',
  'layers.ema': 'EMA', 'layers.vp': 'Volume Profile', 'layers.swings': 'Swings', 'layers.structure': 'BOS/CHoCH', 'layers.levels': 'Entry/SL/TP',
  'signals.active': 'نشطة', 'signals.closed': 'منتهية', 'signals.events': 'سجل الأحداث', 'signals.empty': 'لا توجد إشارات مسجلة بعد.',
  'more.title': 'المزيد', 'more.lang': 'اللغة', 'more.about': 'تحليل فقط — لا ينفذ أي أوامر على Binance.',
  save: 'حفظ', saved: 'تم الحفظ', run: 'تشغيل', running: 'قيد التشغيل…',
};
const en = {
  appName: 'Market Intelligence',
  'nav.home': 'Home', 'nav.market': 'Market', 'nav.analyzer': 'Analyzer', 'nav.signals': 'Signals', 'nav.more': 'More',
  'nav.backtest': 'Backtest', 'nav.paper': 'Paper Trading', 'nav.system': 'System Health', 'nav.settings': 'Settings',
  loading: 'Loading real Binance data…', dataError: 'DATA CONNECTION ERROR — cannot reach Binance',
  source: 'Source', live: 'LIVE', historical: 'HISTORICAL', lastUpdate: 'Last update',
  disclaimer: 'Analytical signals only — not a profit guarantee and not financial advice.',
  score: 'Confluence score', scoreNote: 'Signal Confluence Score — not a win probability',
  entry: 'Entry', stop: 'Stop Loss', tp: 'Take Profit', rr: 'Risk/Reward',
  reasons: 'Reasons', warnings: 'Warnings', failed: 'Failed conditions', trend: 'Trend', structure: 'Market Structure',
  poc: 'POC', volume: 'Volume', mtf: 'Multi-timeframe', rsi: 'RSI',
  'futures.heading': 'Futures Context', 'alerts.heading': 'Professional Alerts',
  'state.LONG_CONFIRMED': 'LONG CONFIRMED', 'state.LONG_CANDIDATE': 'LONG CANDIDATE', 'state.SHORT_CONFIRMED': 'SHORT CONFIRMED', 'state.SHORT_CANDIDATE': 'SHORT CANDIDATE',
  'state.WATCH': 'WATCH', 'state.WAIT': 'WAIT', 'state.NO_TRADE': 'NO TRADE', 'state.INVALIDATED': 'INVALIDATED', 'state.EXPIRED': 'EXPIRED',
  BULLISH: 'Bullish', BEARISH: 'Bearish', NEUTRAL: 'Neutral', RANGE: 'Range', MIXED: 'Mixed', UNKNOWN: 'Unknown',
  TREND_BULLISH: 'Uptrend', TREND_BEARISH: 'Downtrend',
  'data.LIVE': 'Live', 'data.STALE': 'Stale', 'data.DEGRADED': 'Degraded', 'data.DISCONNECTED': 'Disconnected', 'data.DATA_ERROR': 'Data error',
  mode: 'Mode', 'mode.CONFIRMED': 'Confirmed (closed candle)', 'mode.EARLY': 'EARLY', earlyWarn: 'Early signal may repaint before the candle closes.',
  'home.pulse': 'Market pulse', 'home.best': 'Best setups now', 'home.movers': 'Top movers', 'home.volume': 'Top volume', 'home.watch': 'Watchlist',
  'home.noSetups': 'No confirmed setups right now — sometimes NO TRADE is the right call.', 'home.scanning': 'Scanning the market…',
  'market.search': 'Search symbol', 'market.watchOnly': 'Favorites only', 'market.sort': 'Sort',
  'analyzer.symbol': 'Symbol', 'analyzer.tf': 'Timeframe', 'analyzer.chart': 'Chart', 'analyzer.signal': 'Signal', 'analyzer.levels': 'Levels', 'analyzer.mtf': 'MTF',
  'layers.ema': 'EMA', 'layers.vp': 'Volume Profile', 'layers.swings': 'Swings', 'layers.structure': 'BOS/CHoCH', 'layers.levels': 'Entry/SL/TP',
  'signals.active': 'Active', 'signals.closed': 'Closed', 'signals.events': 'Event log', 'signals.empty': 'No signals recorded yet.',
  'more.title': 'More', 'more.lang': 'Language', 'more.about': 'Analysis only — never places orders on Binance.',
  save: 'Save', saved: 'Saved', run: 'Run', running: 'Running…',
};
const dict = { ar, en };

export function useT() {
  const lang = useConfigStore((s) => s.lang);
  const t = (k) => dict[lang][k] ?? dict.en[k] ?? k;
  return { t, lang, dir: lang === 'ar' ? 'rtl' : 'ltr' };
}
