/**
 * Free, key-free whole-market context. Server-side (consistent with
 * news.js — some of these also lack permissive CORS for browser fetch,
 * and centralizing on the server lets the cron job reuse the same code).
 *
 *  - Fear & Greed Index: https://api.alternative.me/fng/  (updates ~daily)
 *  - CoinGecko global:   https://api.coingecko.com/api/v3/global (free tier, no key)
 */

export async function fetchFearGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketIntelligenceBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const entry = data?.data?.[0];
    if (!entry) throw new Error('empty response');
    return {
      value: Number(entry.value),
      classification: entry.value_classification,
      timestamp: Number(entry.timestamp) * 1000,
      error: null,
    };
  } catch (err) {
    return { value: null, classification: null, timestamp: null, error: err.message };
  }
}

export async function fetchGlobalMarket() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketIntelligenceBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    return {
      totalMarketCapUsd: data?.total_market_cap?.usd ?? null,
      totalVolumeUsd: data?.total_volume?.usd ?? null,
      btcDominance: data?.market_cap_percentage?.btc ?? null,
      ethDominance: data?.market_cap_percentage?.eth ?? null,
      marketCapChange24hPct: data?.market_cap_change_percentage_24h_usd ?? null,
      error: null,
    };
  } catch (err) {
    return { totalMarketCapUsd: null, totalVolumeUsd: null, btcDominance: null, ethDominance: null, marketCapChange24hPct: null, error: err.message };
  }
}

export async function fetchMarketContext() {
  const [fearGreed, global] = await Promise.all([fetchFearGreed(), fetchGlobalMarket()]);
  return { fearGreed, global, fetchedAt: Date.now() };
}
