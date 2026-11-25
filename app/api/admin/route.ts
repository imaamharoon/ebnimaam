import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { createAdminSession, isAdminRequest, ADMIN_SESSION_MAX_AGE } from '../../../lib/admin-auth';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const secret = process.env.ADMIN_PASSWORD || '';

function sameSecret(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function POST(req: Request) {
  try {
    if (!(await checkRateLimit(req, 'admin-signin', 8, 15 * 60))) return NextResponse.json({ error: 'Too many administrator sign-in attempts. Please wait 15 minutes.' }, { status: 429, headers: { 'retry-after': '900' } });
    const { password } = await req.json();
    if (!secret) return NextResponse.json({ error: 'Admin password is not configured.' }, { status: 503 });
    if (typeof password !== 'string' || !sameSecret(password, secret)) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set('ebn_admin', createAdminSession(secret), {
      httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'strict',
      path: '/', maxAge: ADMIN_SESSION_MAX_AGE,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Request failed.' }, { status: 400 });
  }
}

export async function GET(req: Request) {
  if (!isAdminRequest(req, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const [result, customerResult] = await Promise.all([
      pool.query(
        `SELECT o.reference,o.auth_user_id,o.customer_email,o.customer_name,o.customer_phone,o.address,
                o.amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
                o.payment_provider,o.provider_transaction_id,o.updated_at,
                COALESCE((SELECT json_agg(json_build_object('status',h.status,'note',h.note,'created_at',h.created_at)
                  ORDER BY h.created_at ASC) FROM public.ebnimaam_order_status_history h WHERE h.reference=o.reference),'[]'::json) AS history
         FROM public.ebnimaam_orders o ORDER BY o.created_at DESC LIMIT 200`,
      ),
      pool.query(
        `SELECT LOWER(customer_email) AS email,MAX(customer_name) AS name,MAX(customer_phone) AS phone,
                COUNT(*)::int AS order_count,
                COUNT(*) FILTER (WHERE status='paid')::int AS paid_order_count,
                COALESCE(SUM(amount_kobo) FILTER (WHERE status='paid'),0)::bigint AS paid_total_kobo,
                MAX(created_at) AS last_order_at
         FROM public.ebnimaam_orders WHERE customer_email IS NOT NULL AND customer_email<>''
         GROUP BY LOWER(customer_email) ORDER BY last_order_at DESC LIMIT 500`,
      ),
    ]);
    return NextResponse.json({ orders: result.rows, customers: customerResult.rows }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Orders unavailable.' }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const client = await pool.connect();
  try {
    const { reference, fulfilment_status, note } = await req.json();
    const allowed = ['processing', 'picked', 'packed', 'shipped', 'delivered', 'cancelled'];
    if (!reference || !allowed.includes(fulfilment_status)) {
      return NextResponse.json({ error: 'Invalid order reference or fulfilment status.' }, { status: 400 });
    }
    await client.query('BEGIN');
    const found = await client.query('SELECT fulfilment_status FROM public.ebnimaam_orders WHERE reference=$1 FOR UPDATE', [String(reference)]);
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    const previous = String(found.rows[0].fulfilment_status || 'processing');
    if (previous !== fulfilment_status) {
      await client.query(
        'UPDATE public.ebnimaam_orders SET fulfilment_status=$1,updated_at=NOW() WHERE reference=$2',
        [fulfilment_status, String(reference)],
      );
      await client.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [String(reference), fulfilment_status, String(note || ('Fulfilment moved from ' + previous + ' to ' + fulfilment_status)).slice(0, 500), 'admin'],
      );
    }
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, fulfilment_status });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json({ error: 'Order update failed.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('ebn_admin', '', {
    httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'strict',
    path: '/', maxAge: 0,
  });
  return response;
}
