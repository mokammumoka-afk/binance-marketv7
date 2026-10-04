import { NextResponse } from 'next/server';
import { fetchAggregatedNews, assetKeywordsFor } from '../../../lib/external/news';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get('asset');
  const limit = Number(searchParams.get('limit') || 30);
  const keywords = asset ? assetKeywordsFor(asset) : [];
  const data = await fetchAggregatedNews({ limit, assetKeywords: keywords });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
