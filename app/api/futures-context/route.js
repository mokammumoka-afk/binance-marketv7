import { NextResponse } from 'next/server';
import { fetchFuturesSnapshot } from '../../../lib/binance/futures';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  const data = await fetchFuturesSnapshot(symbol);
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=30' } });
}
