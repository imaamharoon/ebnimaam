import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { getVerifiedCustomer } from '../../../../lib/loyalty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

async function ensureCustomerProfileTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_profiles(
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function parsePreferences(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value) || value.length > 30) throw new Error('A saved bag can contain up to 30 different lines.');
  const items = value.map((item: any) => {
    const productId = String(item?.productId || '').trim().slice(0, 120);
    const size = String(item?.size || 'One Size').trim().slice(0, 40);
    const color = String(item?.color || '').trim().slice(0, 60);
    const qty = Number(item?.qty);
    if (!productId || !size || !Number.isSafeInteger(qty) || qty < 1 || qty > 10) {
      throw new Error('A saved bag contains an invalid product, option or quantity.');
    }
    return { productId, size, color, qty };
  });
  const keys = new Set<string>();
  for (const item of items) {
    const key = JSON.stringify([item.productId, item.size, item.color]);
    if (keys.has(key)) throw new Error('Duplicate product options must be combined into one bag line.');
    keys.add(key);
  }
  return items;
}

async function validateAgainstCurrentStock(items: ReturnType<typeof normalizeItems>) {
  if (!items.length) return;
  const totalsByProduct = new Map<string, number>();
  const totalsBySize = new Map<string, number>();
  for (const item of items) {
    totalsByProduct.set(item.productId, (totalsByProduct.get(item.productId) || 0) + item.qty);
    const key = JSON.stringify([item.productId, item.size]);
    totalsBySize.set(key, (totalsBySize.get(key) || 0) + item.qty);
  }
  const ids = Array.from(totalsByProduct.keys());
  const result = await pool.query(
    'SELECT id,stock,size_stock,is_active FROM public.ebnimaam_products WHERE id=ANY($1::text[])',
    [ids],
  );
  const products = new Map<string, any>();
  for (const row of result.rows) products.set(String(row.id), row);
  if (products.size !== ids.length) throw new Error('A saved product is no longer available. Refresh your bag and try again.');

  for (const [id, quantity] of Array.from(totalsByProduct.entries())) {
    const product = products.get(id);
    const stock = Number(product?.stock);
    if (product?.is_active === false || !Number.isSafeInteger(stock) || stock < quantity) {
      throw new Error('A saved product no longer has enough available stock. Refresh your bag before checkout.');
    }
  }
  for (const [key, quantity] of Array.from(totalsBySize.entries())) {
    const [id, size] = JSON.parse(key) as [string, string];
    let sizes = products.get(id)?.size_stock;
    if (typeof sizes === 'string') {
      try { sizes = JSON.parse(sizes); } catch { sizes = {}; }
    }
    if (sizes && typeof sizes === 'object' && !Array.isArray(sizes) && Object.prototype.hasOwnProperty.call(sizes, size)) {
      const available = Number(sizes[size]);
      if (!Number.isSafeInteger(available) || available < quantity) {
        throw new Error('A saved size or option no longer has enough stock. Refresh your bag before checkout.');
      }
    }
  }
}

export async function GET(req: Request) {
  try {
    const user = await getVerifiedCustomer(req);
    if (!user) return NextResponse.json({ error: 'Sign in with your verified account to sync your bag.' }, { status: 401 });
    await ensureCustomerProfileTable();
    const result = await pool.query(
      'SELECT preferences FROM public.ebnimaam_customer_profiles WHERE user_id=$1',
      [user.id],
    );
    const preferences = parsePreferences(result.rows[0]?.preferences);
    const items = Array.isArray(preferences.cart) ? preferences.cart : [];
    return NextResponse.json({ userId: user.id, items }, { headers: { 'cache-control': 'private, no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Your saved bag is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getVerifiedCustomer(req);
    if (!user) return NextResponse.json({ error: 'Sign in with your verified account to save your bag across devices.' }, { status: 401 });
    let allowed = false;
    try { allowed = await checkRateLimit(req, 'customer-cart-sync', 120, 15 * 60); }
    catch { return NextResponse.json({ error: 'Bag sync is temporarily unavailable.' }, { status: 503 }); }
    if (!allowed) return NextResponse.json({ error: 'Your bag was updated many times. Please try again shortly.' }, { status: 429, headers: { 'retry-after': '900' } });
    const declaredSize = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(declaredSize) && declaredSize > 16_384) return NextResponse.json({ error: 'The saved bag is too large.' }, { status: 413 });
    const body = await req.json().catch(() => ({}));
    const items = normalizeItems(body?.items);
    await ensureCustomerProfileTable();
    await validateAgainstCurrentStock(items);
    await pool.query(
      `INSERT INTO public.ebnimaam_customer_profiles(user_id,email,preferences)
       VALUES($1,$2,jsonb_build_object('cart',$3::jsonb))
       ON CONFLICT(user_id) DO UPDATE SET
         email=EXCLUDED.email,
         preferences=COALESCE(public.ebnimaam_customer_profiles.preferences,'{}'::jsonb)
           || jsonb_build_object('cart',$3::jsonb),
         updated_at=NOW()`,
      [user.id, user.email, JSON.stringify(items)],
    );
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('saved bag') || message.includes('saved product') || message.includes('saved size') || message.includes('Duplicate product')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Your saved bag could not be synchronized right now.' }, { status: 503 });
  }
}
