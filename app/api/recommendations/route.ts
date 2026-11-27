import { NextResponse } from 'next/server';
import { loyaltyPool } from '../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const id = String(new URL(req.url).searchParams.get('productId') || '').trim().slice(0, 120);
  if (!id) return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 });
  try {
    const source = await loyaltyPool.query('SELECT id,category,tag FROM public.ebnimaam_products WHERE id=$1 AND is_active=TRUE AND stock>0 LIMIT 1', [id]);
    if (!source.rowCount) return NextResponse.json({ products: [] });
    const item = source.rows[0];
    const result = await loyaltyPool.query(
      "SELECT id,name,category,price,image,tag,stock FROM public.ebnimaam_products WHERE is_active=TRUE AND stock>0 AND id<>$1 ORDER BY CASE WHEN category=$2 THEN 0 WHEN tag IS NOT NULL AND tag=$3 THEN 1 ELSE 2 END,updated_at DESC LIMIT 4",
      [id, item.category, item.tag]
    );
    return NextResponse.json({ products: result.rows }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Recommendations are temporarily unavailable.' }, { status: 503 });
  }
}
