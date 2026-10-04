/**
 * Free, key-free crypto news aggregation — SERVER-SIDE ONLY (these RSS
 * feeds do not send CORS headers, so a browser fetch would be blocked;
 * this module is only ever imported from a Next.js route handler).
 *
 * Sources (each is the publisher's own public RSS feed, no API key):
 *   - CoinDesk:       https://www.coindesk.com/arc/outboundfeeds/rss/
 *   - Cointelegraph:  https://cointelegraph.com/rss
 *   - Decrypt:        https://decrypt.co/feed
 *   - CryptoSlate:    https://cryptoslate.com/feed/
 *
 * IMPORTANT HONESTY NOTE: this module does NOT run real NLP sentiment
 * analysis — that would require a model this codebase doesn't have. The
 * "keyword heuristic" below counts rough bullish/bearish keyword hits in
 * headlines and is labeled exactly as what it is everywhere it's shown:
 * a crude heuristic for "is there a lot of charged language right now",
 * never presented as a calibrated sentiment score.
 */

const FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
];

const BULLISH_WORDS = ['surge', 'rally', 'soar', 'breakout', 'approval', 'adoption', 'bullish', 'record high', 'all-time high', 'inflow', 'upgrade'];
const BEARISH_WORDS = ['crash', 'plunge', 'hack', 'exploit', 'lawsuit', 'ban', 'bearish', 'sell-off', 'selloff', 'liquidation', 'outflow', 'fraud', 'collapse', 'delist'];

function stripCdata(s = '') {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}
function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeEntities(stripCdata(m[1])).trim() : '';
}

/** Minimal, dependency-free RSS 2.0 <item> extractor — good enough for
 * title/link/pubDate/description, which is all these feeds are used for. */
function parseRss(xml, sourceName) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = tag(block, 'title');
    const link = tag(block, 'link') || (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const pubDateRaw = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'dc:date');
    const publishedAt = pubDateRaw ? Date.parse(pubDateRaw) : null;
    if (!title) continue;
    items.push({ title, link, source: sourceName, publishedAt: Number.isFinite(publishedAt) ? publishedAt : null });
  }
  return items;
}

async function fetchFeed(feed, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketIntelligenceBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return { feed: feed.name, items: parseRss(xml, feed.name), error: null };
  } catch (err) {
    return { feed: feed.name, items: [], error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function keywordHeuristic(items) {
  let bull = 0;
  let bear = 0;
  for (const it of items) {
    const t = it.title.toLowerCase();
    if (BULLISH_WORDS.some((w) => t.includes(w))) bull++;
    if (BEARISH_WORDS.some((w) => t.includes(w))) bear++;
  }
  return { bullishKeywordHits: bull, bearishKeywordHits: bear, totalHeadlines: items.length, methodology: 'KEYWORD_HEURISTIC_NOT_NLP' };
}

/**
 * Fetches all feeds in parallel, merges, sorts newest-first, dedupes near-
 * identical titles (same story on multiple outlets), and optionally
 * filters to headlines mentioning the given asset name/symbol.
 */
export async function fetchAggregatedNews({ limit = 40, assetKeywords = [] } = {}) {
  const results = await Promise.all(FEEDS.map((f) => fetchFeed(f)));
  const errors = results.filter((r) => r.error).map((r) => ({ feed: r.feed, error: r.error }));
  let items = results.flatMap((r) => r.items);

  items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  const seen = new Set();
  items = items.filter((it) => {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let relevant = items;
  if (assetKeywords.length) {
    const kws = assetKeywords.map((k) => k.toLowerCase());
    relevant = items.filter((it) => kws.some((k) => it.title.toLowerCase().includes(k)));
  }

  const slice = (relevant.length ? relevant : items).slice(0, limit);
  return {
    items: slice,
    heuristic: keywordHeuristic(slice),
    sourcesOk: results.filter((r) => !r.error).map((r) => r.feed),
    errors: errors.length ? errors : null,
    fetchedAt: Date.now(),
  };
}

/** Maps a Binance base asset ticker to search keywords for the RSS filter. */
export function assetKeywordsFor(baseAsset) {
  const MAP = {
    BTC: ['bitcoin', 'btc'],
    ETH: ['ethereum', 'eth', 'ether'],
    SOL: ['solana', 'sol'],
    BNB: ['bnb', 'binance coin'],
    XRP: ['xrp', 'ripple'],
    DOGE: ['dogecoin', 'doge'],
    ADA: ['cardano', 'ada'],
  };
  return MAP[baseAsset?.toUpperCase()] || [baseAsset?.toLowerCase()].filter(Boolean);
}
