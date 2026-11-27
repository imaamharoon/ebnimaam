import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../lib/rate-limit';
import { isCurrentCustomerSession } from '../../../lib/customer-sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const authBase = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');

async function customer(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  if (!cookie) return null;
  const response = await fetch(authBase + '/get-session', { headers: { cookie, origin: new URL(req.url).origin }, cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  const user = data?.user;
  if (!user?.id || !user?.email || user.emailVerified !== true) return null;
  if (!(await isCurrentCustomerSession(req, String(user.id)))) return null;
  return user as { id: string; email: string; name?: string; emailVerified?: boolean };
}
async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_product_reviews(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id TEXT NOT NULL REFERENCES public.ebnimaam_products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    fit_feedback TEXT NOT NULL CHECK(fit_feedback IN ('true_to_size','runs_small','runs_large')),
    comment TEXT NOT NULL DEFAULT '',
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(product_id,user_id)
  )`);
  await pool.query("ALTER TABLE public.ebnimaam_product_reviews ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'published'");
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_product_review_reports(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES public.ebnimaam_product_reviews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(review_id,user_id)
  )`);
}
export async function GET(req: Request) {
  try {
    await init();
    const productId = String(new URL(req.url).searchParams.get('productId') || '').trim().slice(0, 120);
    if (!productId) return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 });
    const [reviews, summary] = await Promise.all([
      pool.query("SELECT id,split_part(customer_name,' ',1) AS customer_name,rating,fit_feedback,comment,photo_url,created_at FROM public.ebnimaam_product_reviews WHERE product_id=$1 AND moderation_status='published' ORDER BY created_at DESC LIMIT 100", [productId]),
      pool.query("SELECT COUNT(*)::int AS count,COALESCE(AVG(rating),0)::numeric(3,1) AS average FROM public.ebnimaam_product_reviews WHERE product_id=$1 AND moderation_status='published'", [productId]),
    ]);
    return NextResponse.json({ reviews: reviews.rows, summary: summary.rows[0] || { count: 0, average: 0 } }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Reviews are temporarily unavailable.' }, { status: 503 });
  }
}
export async function POST(req: Request) {
  let allowed = false;
  try { allowed = await checkRateLimit(req, 'product-review-submit', 8, 15 * 60); }
  catch { return NextResponse.json({ error: 'Reviews are temporarily unavailable. Please try again shortly.' }, { status: 503 }); }
  if (!allowed) return NextResponse.json({ error: 'Too many review attempts. Please wait 15 minutes and try again.' }, { status: 429, headers: { 'retry-after': '900' } });
  try {
    const user = await customer(req);
    if (!user) return NextResponse.json({ error: 'Sign in with your verified account to leave a purchase-verified review.' }, { status: 401 });
    await init();
    const body = await req.json();
    const productId = String(body?.productId || '').trim().slice(0, 120);
    const rating = Number(body?.rating);
    const fit = String(body?.fit_feedback || '');
    const comment = String(body?.comment || '').trim().slice(0, 1000);
    const photo = String(body?.photo_url || '').trim().slice(0, 1500);
    if (!productId || !Number.isSafeInteger(rating) || rating < 1 || rating > 5 || !['true_to_size','runs_small','runs_large'].includes(fit)) {
      return NextResponse.json({ error: 'Please provide a product, rating and fit feedback.' }, { status: 400 });
    }
    if (photo) {
      let url: URL;
      try { url = new URL(photo); } catch { return NextResponse.json({ error: 'Customer photo must be a valid HTTPS image URL.' }, { status: 400 }); }
      if (url.protocol !== 'https:' || url.username || url.password) return NextResponse.json({ error: 'Customer photo must use HTTPS.' }, { status: 400 });
    }
    const purchased = await pool.query(
      `SELECT 1 FROM public.ebnimaam_orders o
       WHERE o.status='paid'
         AND (o.auth_user_id=$1 OR (o.auth_user_id IS NULL AND LOWER(o.customer_email)=LOWER($2)))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.items) AS line WHERE line->>'productId'=$3)
       LIMIT 1`,
      [user.id, user.email, productId],
    );
    if (!purchased.rowCount) return NextResponse.json({ error: 'A verified paid order for this item is required before reviewing it.' }, { status: 403 });
    const profile = await pool.query('SELECT full_name FROM public.ebnimaam_customer_profiles WHERE user_id=$1', [user.id]);
    const customerName = String(profile.rows[0]?.full_name || user.name || 'Verified buyer').trim().slice(0, 80);
    await pool.query(
      `INSERT INTO public.ebnimaam_product_reviews(product_id,user_id,customer_name,rating,fit_feedback,comment,photo_url)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(product_id,user_id) DO UPDATE SET customer_name=EXCLUDED.customer_name,rating=EXCLUDED.rating,
       fit_feedback=EXCLUDED.fit_feedback,comment=EXCLUDED.comment,photo_url=EXCLUDED.photo_url,moderation_status='published',created_at=NOW()`,
      [productId, user.id, customerName, rating, fit, comment, photo || null],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Your review could not be saved right now.' }, { status: 503 });
  }
}
