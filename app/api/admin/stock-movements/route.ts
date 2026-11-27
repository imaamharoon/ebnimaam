import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { recordAdminActivity } from '../../../../lib/admin-audit';
import { checkRateLimit } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_stock_movements(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    variant TEXT,
    old_qty INTEGER NOT NULL,
    new_qty INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_stock_movements_created_idx ON public.ebnimaam_stock_movements(created_at DESC)');
}

function parseSizeStock(value: unknown): Record<string, number> {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const amount = Number(raw);
    if (key && Number.isSafeInteger(amount) && amount >= 0) result[key] = amount;
  }
  return result;
}

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureSchema();
    const url = new URL(req.url);
    const productId = String(url.searchParams.get('productId') || '').trim().slice(0, 120);
    const result = productId
      ? await pool.query(
          'SELECT id,product_id,product_name,variant,old_qty,new_qty,delta,reason,actor,created_at FROM public.ebnimaam_stock_movements WHERE product_id=$1 ORDER BY created_at DESC LIMIT 300',
          [productId],
        )
      : await pool.query(
          'SELECT id,product_id,product_name,variant,old_qty,new_qty,delta,reason,actor,created_at FROM public.ebnimaam_stock_movements ORDER BY created_at DESC LIMIT 300',
        );
    return NextResponse.json({ movements: result.rows }, { headers: { 'cache-control': 'private, no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Stock movement history is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let allowed = false;
  try { allowed = await checkRateLimit(req, 'admin-stock-adjustment', 40, 60 * 60); }
  catch { return NextResponse.json({ error: 'Stock adjustments are temporarily unavailable.' }, { status: 503 }); }
  if (!allowed) return NextResponse.json({ error: 'Too many stock adjustments. Please try again later.' }, { status: 429, headers: { 'retry-after': '3600' } });
  const declaredSize = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declaredSize) && declaredSize > 8192) return NextResponse.json({ error: 'Invalid stock adjustment request.' }, { status: 413 });
  const body = await req.json().catch(() => ({}));
  const productId = String(body?.productId || '').trim().slice(0, 120);
  const variant = String(body?.variant || '').trim().slice(0, 40);
  const delta = Number(body?.delta);
  const reason = String(body?.reason || '').replace(/\u0000/g, '').trim().slice(0, 300);
  if (!productId || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100000 || reason.length < 4) {
    return NextResponse.json({ error: 'Choose a product, enter a non-zero whole-number adjustment (up to 100,000 units), and provide a reason of at least 4 characters.' }, { status: 400 });
  }

  try {
    await ensureSchema();
    const client = await pool.connect();
    let movement: any = null;
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        'SELECT id,name,stock,size_stock FROM public.ebnimaam_products WHERE id=$1 FOR UPDATE',
        [productId],
      );
      if (!selected.rowCount) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
      }
      const product = selected.rows[0];
      const oldTotal = Number(product.stock);
      const newTotal = oldTotal + delta;
      if (!Number.isSafeInteger(oldTotal) || !Number.isSafeInteger(newTotal) || newTotal < 0 || newTotal > 100000) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'This adjustment would take total stock outside the allowed range.' }, { status: 409 });
      }
      const sizeStock = parseSizeStock(product.size_stock);
      const sizeNames = Object.keys(sizeStock);
      if (variant) {
        if (!Object.prototype.hasOwnProperty.call(sizeStock, variant)) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'This variant has no separately recorded stock. Update product variants first.' }, { status: 409 });
        }
        const oldVariant = sizeStock[variant];
        const newVariant = oldVariant + delta;
        if (!Number.isSafeInteger(newVariant) || newVariant < 0 || newVariant > 100000) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'This adjustment would take variant stock outside the allowed range.' }, { status: 409 });
        }
        const newSizeStock = { ...sizeStock, [variant]: newVariant };
        const allocated = Object.values(newSizeStock).reduce((sum, value) => sum + value, 0);
        if (allocated > newTotal) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Variant stock cannot exceed the product total stock.' }, { status: 409 });
        }
        await client.query(
          'UPDATE public.ebnimaam_products SET stock=$2,size_stock=$3::jsonb,updated_at=NOW() WHERE id=$1',
          [productId,newTotal,JSON.stringify(newSizeStock)],
        );
        movement = { productId, productName: product.name, variant, oldQty: oldVariant, newQty: newVariant, delta, reason };
      } else {
        if (sizeNames.length) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'This product has variant-level stock. Select a specific variant for the adjustment.' }, { status: 409 });
        }
        await client.query(
          'UPDATE public.ebnimaam_products SET stock=$2,updated_at=NOW() WHERE id=$1',
          [productId,newTotal],
        );
        movement = { productId, productName: product.name, variant: null, oldQty: oldTotal, newQty: newTotal, delta, reason };
      }
      await client.query(
        'INSERT INTO public.ebnimaam_stock_movements(product_id,product_name,variant,old_qty,new_qty,delta,reason,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [movement.productId,movement.productName,movement.variant,movement.oldQty,movement.newQty,movement.delta,movement.reason,'admin'],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await recordAdminActivity('inventory.stock_adjusted', 'product', productId, { variant: movement.variant, delta, reason });
    return NextResponse.json({ ok: true, movement }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The stock adjustment could not be saved.' }, { status: 503 });
  }
}
