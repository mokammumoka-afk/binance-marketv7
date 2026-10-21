import { NextResponse } from 'next/server';
import { fetchMarketContext } from '../../../lib/external/marketContext';

export const revalidate = 0; // always fetch fresh; Fear&Greed itself only updates ~daily

export async function GET() {
  const data = await fetchMarketContext();
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
