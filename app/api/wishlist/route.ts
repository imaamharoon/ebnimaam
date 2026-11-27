import { NextResponse } from 'next/server';
import { loyaltyPool, getVerifiedCustomer } from '../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function init() {
  await loyaltyPool.query("CREATE TABLE IF NOT EXISTS public.ebnimaam_wishlist(user_id TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES public.ebnimaam_products(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,product_id))");
}
export async function GET(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return NextResponse.json({ error: 'Sign in to sync your saved products.' }, { status: 401 });
  try {
    await init();
    const rows = await loyaltyPool.query('SELECT product_id FROM public.ebnimaam_wishlist WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200', [user.id]);
    return NextResponse.json({ productIds: rows.rows.map((row: any) => String(row.product_id)) }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Saved products are temporarily unavailable.' }, { status: 503 });
  }
}
export async function PUT(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return NextResponse.json({ error: 'Sign in to sync your saved products.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body?.productIds) || body.productIds.length > 200) return NextResponse.json({ error: 'Provide up to 200 saved product IDs.' }, { status: 400 });
  const ids = Array.from(new Set(body.productIds.map((value: any) => String(value || '').trim().slice(0, 120)).filter(Boolean)));
  try {
    await init();
    if (ids.length) {
      const active = await loyaltyPool.query('SELECT id FROM public.ebnimaam_products WHERE id=ANY($1::text[]) AND is_active=TRUE', [ids]);
      if (active.rowCount !== ids.length) return NextResponse.json({ error: 'One or more saved products are no longer available.' }, { status: 409 });
    }
    const client = await loyaltyPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM public.ebnimaam_wishlist WHERE user_id=$1', [user.id]);
      if (ids.length) {
        await client.query('INSERT INTO public.ebnimaam_wishlist(user_id,product_id) SELECT $1, unnest($2::text[]) ON CONFLICT(user_id,product_id) DO NOTHING', [user.id, ids]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return NextResponse.json({ ok: true, count: ids.length });
  } catch {
    return NextResponse.json({ error: 'Saved products could not be synchronized.' }, { status: 503 });
  }
}
