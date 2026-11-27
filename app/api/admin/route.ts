import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { createAdminSession, isAdminRequest, ADMIN_SESSION_MAX_AGE } from '../../../lib/admin-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { getRecentAdminActivity, recordAdminActivity } from '../../../lib/admin-audit';
import { ensureOrderEmailEventsTable, isOrderEmailConfigured, sendOrderStatusEmail } from '../../../lib/order-notifications';

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
    await recordAdminActivity('admin.login.success', 'admin_session', null, { method: 'password' });
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
    await ensureOrderEmailEventsTable();
    const [result, customerResult, activity] = await Promise.all([
      pool.query(
        `SELECT o.reference,o.auth_user_id,o.customer_email,o.customer_name,o.customer_phone,o.address,
                o.amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
                o.payment_provider,o.provider_transaction_id,o.updated_at,
                COALESCE(o.address->>'fulfilment_method','delivery') AS fulfilment_method,
                COALESCE((SELECT json_agg(json_build_object('status',h.status,'note',h.note,'created_at',h.created_at)
                  ORDER BY h.created_at ASC) FROM public.ebnimaam_order_status_history h WHERE h.reference=o.reference),'[]'::json) AS history,
                COALESCE((SELECT json_agg(json_build_object('status',e.status_key,'delivery_status',e.delivery_status,'sent_at',e.sent_at,'last_error',e.last_error)
                  ORDER BY e.created_at DESC) FROM public.ebnimaam_order_email_events e WHERE e.reference=o.reference),'[]'::json) AS email_events
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
      getRecentAdminActivity(40),
    ]);
    return NextResponse.json({ orders: result.rows, customers: customerResult.rows, activity, email_configured: isOrderEmailConfigured() }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Orders unavailable.' }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const reference = String(body?.reference || '').trim();
  if (!reference || reference.length > 160) {
    return NextResponse.json({ error: 'A valid order reference is required.' }, { status: 400 });
  }

  if (body?.resend_notification === true) {
    try {
      const found = await pool.query('SELECT status,fulfilment_status FROM public.ebnimaam_orders WHERE reference=$1', [reference]);
      if (!found.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
      const paymentStatus = String(found.rows[0].status || 'pending').toLowerCase();
      const fulfilmentStatus = String(found.rows[0].fulfilment_status || 'processing').toLowerCase();
      const statusToSend = fulfilmentStatus === 'cancelled'
        ? 'cancelled'
        : paymentStatus === 'paid'
          ? fulfilmentStatus
          : 'pending';
      const result = await sendOrderStatusEmail(reference, statusToSend, new URL(req.url).origin, String(body?.note || ''), true);
      return NextResponse.json({ ok: true, email_delivery_status: result.deliveryStatus, email_reason: result.reason || null });
    } catch {
      return NextResponse.json({ error: 'The customer notification could not be retried.' }, { status: 503 });
    }
  }

  const fulfilmentStatus = String(body?.fulfilment_status || '').trim().toLowerCase();
  const allowed = ['processing', 'picked', 'packed', 'shipped', 'delivered', 'cancelled', 'ready_for_pickup', 'collected'];
  if (!allowed.includes(fulfilmentStatus)) {
    return NextResponse.json({ error: 'Invalid order reference or fulfilment status.' }, { status: 400 });
  }

  const client = await pool.connect();
  let previous = '';
  let changed = false;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT fulfilment_status,status,address FROM public.ebnimaam_orders WHERE reference=$1 FOR UPDATE', [reference]);
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    previous = String(found.rows[0].fulfilment_status || 'processing');
    const paymentStatus = String(found.rows[0].status || 'pending').toLowerCase();
    let address = found.rows[0].address;
    if (typeof address === 'string') { try { address = JSON.parse(address); } catch { address = {}; } }
    const pickup = String(address?.fulfilment_method || 'delivery') === 'pickup';
    if ((['ready_for_pickup', 'collected'].includes(fulfilmentStatus) && !pickup)
      || (['shipped', 'delivered'].includes(fulfilmentStatus) && pickup)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: pickup
        ? 'Use Ready for pickup or Collected for a self-pickup order.'
        : 'Shipped and Delivered are only available for home-delivery orders.' }, { status: 409 });
    }
    if (paymentStatus !== 'paid' && ['picked', 'packed', 'shipped', 'delivered', 'ready_for_pickup', 'collected'].includes(fulfilmentStatus)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Payment must be verified before fulfilment can proceed.' }, { status: 409 });
    }

    if (previous !== fulfilmentStatus) {
      await client.query('UPDATE public.ebnimaam_orders SET fulfilment_status=$1,updated_at=NOW() WHERE reference=$2', [fulfilmentStatus, reference]);
      await client.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [reference, fulfilmentStatus, String(body?.note || ('Fulfilment moved from ' + previous + ' to ' + fulfilmentStatus)).slice(0, 500), 'admin'],
      );
      changed = true;
    }
    await client.query('COMMIT');

    if (changed) {
      await recordAdminActivity('order.fulfilment.updated', 'order', reference, { from: previous, to: fulfilmentStatus });
    }
    let emailResult: { deliveryStatus: string; reason?: string } = { deliveryStatus: 'not_requested' };
    if (changed && ['picked', 'shipped', 'delivered', 'cancelled', 'ready_for_pickup', 'collected'].includes(fulfilmentStatus)) {
      emailResult = await sendOrderStatusEmail(reference, fulfilmentStatus, new URL(req.url).origin, String(body?.note || ''))
        .catch(() => ({ deliveryStatus: 'failed', reason: 'Notification could not be sent.' }));
    }
    return NextResponse.json({
      ok: true,
      fulfilment_status: fulfilmentStatus,
      email_delivery_status: emailResult.deliveryStatus,
      email_reason: emailResult.reason || null,
    });
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
