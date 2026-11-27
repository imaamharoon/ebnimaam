import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { isAdminRequest } from '../../../lib/admin-auth';
import { recordAdminActivity } from '../../../lib/admin-audit';

export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_products(
    id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,
    description TEXT,image TEXT NOT NULL,tag TEXT,sizes JSONB,stock INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ DEFAULT NOW(),
    gallery JSONB NOT NULL DEFAULT '[]'::jsonb,size_stock JSONB NOT NULL DEFAULT '{}'::jsonb,
    product_details JSONB NOT NULL DEFAULT '{}'::jsonb)`);
  await pool.query('ALTER TABLE public.ebnimaam_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query("ALTER TABLE public.ebnimaam_products ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE public.ebnimaam_products ADD COLUMN IF NOT EXISTS size_stock JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE public.ebnimaam_products ADD COLUMN IF NOT EXISTS product_details JSONB NOT NULL DEFAULT '{}'::jsonb");
}
function safeImage(value: unknown) {
  const image = String(value || '').trim();
  return image.startsWith('https://') || image.startsWith('data:image/');
}
function normalizeDetails(input: unknown) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Product fit details must be a JSON object.');
  const source = input as Record<string, any>;
  const result: Record<string, any> = {};
  for (const key of ['modelHeight','modelSize','fit','fabric','care','sizeGuideNote']) {
    if (source[key] != null) result[key] = String(source[key]).trim().slice(0, 220);
  }
  if (source.colors != null) {
    if (!Array.isArray(source.colors) || source.colors.length > 12) throw new Error('Add up to 12 colour options.');
    result.colors = source.colors.map((color: any) => {
      const name = String(color?.name || '').trim().slice(0, 40);
      const hex = String(color?.hex || '').trim();
      if (!name || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Each colour needs a name and a six-digit hex colour.');
      return { name, hex };
    });
  }
  if (source.sizeChart != null) {
    if (!Array.isArray(source.sizeChart) || source.sizeChart.length > 12) throw new Error('Size chart must contain up to 12 rows.');
    result.sizeChart = source.sizeChart.map((row: any) => {
      const size = String(row?.size || '').trim().slice(0, 20);
      const chest = Number(row?.chest), length = Number(row?.length), shoulder = Number(row?.shoulder);
      if (!size || ![chest,length,shoulder].every(value => Number.isFinite(value) && value > 0 && value <= 300)) {
        throw new Error('Size chart rows need a size and positive chest, length and shoulder measurements in centimetres.');
      }
      return { size, chest, length, shoulder };
    });
  }
  return result;
}
export async function GET(req: Request) {
  try {
    await init();
    const admin = isAdminRequest(req);
    const columns = 'id,name,category,price,description,image,tag,sizes,stock,is_active,updated_at,gallery,size_stock,product_details';
    const result = admin
      ? await pool.query('SELECT ' + columns + ' FROM public.ebnimaam_products ORDER BY updated_at DESC')
      : await pool.query('SELECT ' + columns + ' FROM public.ebnimaam_products WHERE is_active=TRUE AND stock>0 ORDER BY updated_at DESC');
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
    if (image.length > 5000000 || !safeImage(image)) {
      return NextResponse.json({ error: 'Use an HTTPS image URL or a valid image upload under 5 MB.' }, { status: 400 });
    }
    const id = String(product.id || 'prod-' + randomUUID()).trim();
    const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes.slice(0, 20).map((value: any) => String(value).trim().slice(0, 40)).filter(Boolean) : ['One Size'];
    const active = product.is_active === true;
    const galleryInput = Array.isArray(product.gallery) ? product.gallery.slice(0, 8) : [];
    const gallery = galleryInput.map((value: any) => String(value || '').trim()).filter(Boolean);
    if (gallery.some((url: string) => url.length > 5000000 || !safeImage(url))) {
      return NextResponse.json({ error: 'Every additional product photo must be an HTTPS URL or a valid image upload.' }, { status: 400 });
    }
    const rawSizeStock = product.size_stock && typeof product.size_stock === 'object' && !Array.isArray(product.size_stock) ? product.size_stock : {};
    const sizeStock: Record<string, number> = {};
    for (const size of sizes) {
      if (rawSizeStock[size] == null || rawSizeStock[size] === '') continue;
      const amount = Number(rawSizeStock[size]);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000) {
        return NextResponse.json({ error: 'Each size stock value must be a whole number from 0 to 100,000.' }, { status: 400 });
      }
      sizeStock[size] = amount;
    }
    if (Object.values(sizeStock).reduce((sum, value) => sum + value, 0) > stock) {
      return NextResponse.json({ error: 'The total of per-size stock cannot exceed the overall product stock.' }, { status: 400 });
    }
    const details = normalizeDetails(product.product_details);
    await pool.query(
      `INSERT INTO public.ebnimaam_products(id,name,category,price,description,image,tag,sizes,stock,is_active,gallery,size_stock,product_details)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
       ON CONFLICT(id) DO UPDATE SET name=$2,category=$3,price=$4,description=$5,image=$6,tag=$7,
       sizes=$8::jsonb,stock=$9,is_active=$10,updated_at=NOW(),gallery=$11::jsonb,size_stock=$12::jsonb,product_details=$13::jsonb`,
      [id,name,category,price,description,image,String(product.tag || '').slice(0, 60),JSON.stringify(sizes),stock,active,JSON.stringify(gallery),JSON.stringify(sizeStock),JSON.stringify(details)],
    );
    await recordAdminActivity('product.saved', 'product', id, { name });
    return NextResponse.json({ ok: true, id, is_active: active });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Product save failed.' }, { status: 400 });
  }
}
export async function DELETE(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 });
    await pool.query('UPDATE public.ebnimaam_products SET is_active=FALSE,updated_at=NOW() WHERE id=$1', [String(id)]);
    await recordAdminActivity('product.archived', 'product', String(id));
    return NextResponse.json({ ok: true, archived: true });
  } catch {
    return NextResponse.json({ error: 'Product archive failed.' }, { status: 500 });
  }
}
