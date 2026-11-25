import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { isAdminRequest } from '../../../lib/admin-auth';

export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_products(
    id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,
    description TEXT,image TEXT NOT NULL,tag TEXT,sizes JSONB,stock INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query('ALTER TABLE public.ebnimaam_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE');
}
export async function GET(req: Request) {
  try {
    await init();
    const admin = isAdminRequest(req);
    const result = admin
      ? await pool.query('SELECT id,name,category,price,description,image,tag,sizes,stock,is_active,updated_at FROM public.ebnimaam_products ORDER BY updated_at DESC')
      : await pool.query('SELECT id,name,category,price,description,image,tag,sizes,stock,is_active,updated_at FROM public.ebnimaam_products WHERE is_active=TRUE AND stock>0 ORDER BY updated_at DESC');
    return NextResponse.json({ products: result.rows }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Product catalogue is temporarily unavailable.', products: [] }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await init();
    const product = await req.json();
    const name = String(product.name || '').trim().slice(0, 160);
    const category = String(product.category || '').trim().slice(0, 80);
    const description = String(product.description || '').trim().slice(0, 3000);
    const image = String(product.image || '').trim();
    const price = Number(product.price);
    const stock = Number(product.stock);
    if (!name || !category || !Number.isSafeInteger(price) || price <= 0 || !image) {
      return NextResponse.json({ error: 'Name, category, whole-naira price and product image are required.' }, { status: 400 });
    }
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 100000) {
      return NextResponse.json({ error: 'Stock must be a whole number from 0 to 100,000.' }, { status: 400 });
    }
    if (image.length > 5_000_000 || (!image.startsWith('https://') && !image.startsWith('data:image/'))) {
      return NextResponse.json({ error: 'Use an HTTPS image URL or a valid image upload under 5 MB.' }, { status: 400 });
    }
    const id = String(product.id || 'prod-' + randomUUID()).trim();
    const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes.slice(0, 20).map((v: any) => String(v).slice(0, 40)) : ['One Size'];
    const active = product.is_active === true;
    await pool.query(
      `INSERT INTO public.ebnimaam_products(id,name,category,price,description,image,tag,sizes,stock,is_active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       ON CONFLICT(id) DO UPDATE SET name=$2,category=$3,price=$4,description=$5,image=$6,tag=$7,
       sizes=$8::jsonb,stock=$9,is_active=$10,updated_at=NOW()`,
      [id,name,category,price,description,image,String(product.tag || '').slice(0, 60),JSON.stringify(sizes),stock,active],
    );
    return NextResponse.json({ ok: true, id, is_active: active });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Product save failed.' }, { status: 500 });
  }
}
export async function DELETE(req: Request) {
  if (!valid(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 });
    await pool.query('UPDATE public.ebnimaam_products SET is_active=FALSE,updated_at=NOW() WHERE id=$1', [String(id)]);
    return NextResponse.json({ ok: true, archived: true });
  } catch {
    return NextResponse.json({ error: 'Product archive failed.' }, { status: 500 });
  }
}
