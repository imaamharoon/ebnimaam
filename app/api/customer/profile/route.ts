import { NextResponse } from 'next/server';
import { Pool } from 'pg';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const authBase = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');
async function customer(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  if (!cookie) return null;
  const response = await fetch(authBase + '/get-session', { headers: { cookie, origin: new URL(req.url).origin }, cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  const user = data?.user;
  if (!user?.id || !user?.email || user.emailVerified !== true) return null;
  return user as { id: string; email: string; name?: string; emailVerified?: boolean };
}
async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_profiles(
    user_id TEXT PRIMARY KEY,email TEXT NOT NULL,full_name TEXT,phone TEXT,
    addresses JSONB NOT NULL DEFAULT '[]'::jsonb,preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
export async function GET(req: Request) {
  try {
    const user = await customer(req);
    if (!user) return NextResponse.json({ error: 'Please verify your email and sign in to view your saved details.' }, { status: 401 });
    await init();
    const result = await pool.query('SELECT full_name,phone,addresses,preferences,updated_at FROM public.ebnimaam_customer_profiles WHERE user_id=$1', [user.id]);
    const profile = result.rows[0] || { full_name: user.name || '', phone: '', addresses: [], preferences: {} };
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
const orders = await pool.query(
      `SELECT o.reference,COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
              COALESCE((SELECT json_agg(json_build_object('status',h.status,'note',h.note,'created_at',h.created_at) ORDER BY h.created_at ASC)
                FROM public.ebnimaam_order_status_history h WHERE h.reference=o.reference),'[]'::json) AS history
       FROM public.ebnimaam_orders o
       WHERE o.auth_user_id=$1 OR (o.auth_user_id IS NULL AND LOWER(o.customer_email)=LOWER($2))
       ORDER BY o.created_at DESC LIMIT 100`,
      [user.id, user.email],
    );
    return NextResponse.json({ profile: { ...profile, email: user.email }, orders: orders.rows }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load your saved details.' }, { status: 500 });
  }
}
export async function PUT(req: Request) {
  try {
    const user = await customer(req);
    if (!user) return NextResponse.json({ error: 'Please verify your email and sign in before saving your details.' }, { status: 401 });
    const body = await req.json();
    const fullName = String(body.full_name || '').trim().slice(0, 120);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const addresses = Array.isArray(body.addresses) ? body.addresses.slice(0, 5).map((address: any) => ({
      label: String(address.label || 'Home').slice(0, 30),
      recipient: String(address.recipient || fullName).slice(0, 120),
      phone: String(address.phone || phone).slice(0, 40),
      line1: String(address.line1 || '').slice(0, 240),
      line2: String(address.line2 || '').slice(0, 240),
      city: String(address.city || '').slice(0, 100),
      state: String(address.state || '').slice(0, 100),
      country: String(address.country || 'Nigeria').slice(0, 80),
    })) : [];
    if (!fullName) return NextResponse.json({ error: 'Please enter your full name.' }, { status: 400 });
    if (addresses.some((address: any) => address.country !== 'Nigeria' || !address.line1 || !address.city || !address.state)) {
      return NextResponse.json({ error: 'Saved addresses must contain a street address, city and state in Nigeria.' }, { status: 400 });
    }
    await init();
    await pool.query(
      `INSERT INTO public.ebnimaam_customer_profiles(user_id,email,full_name,phone,addresses)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,
       addresses=EXCLUDED.addresses,updated_at=NOW()`,
      [user.id, user.email, fullName, phone, JSON.stringify(addresses)],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not save your details. Please try again.' }, { status: 500 });
  }
}
