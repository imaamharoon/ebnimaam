import { NextResponse } from 'next/server';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { createAdminSession, isAdminRequest, ADMIN_SESSION_MAX_AGE } from '../../../lib/admin-auth';
import { checkRateLimit } from '../../../lib/rate-limit';
import { getRecentAdminActivity, recordAdminActivity } from '../../../lib/admin-audit';
import { ensureOrderEmailEventsTable, isOrderEmailConfigured, sendOrderStatusEmail } from '../../../lib/order-notifications';
import { notifyOrder } from '../../../lib/push-notifications';

export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const secret = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.ADMIN_PASSWORD || process.env.AUTH_SECRET || '';

async function ensureAdminCredentialSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_admin_credentials(
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
function sameSecret(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return 'scryptexport async function POST(req: Request) {
  try {
    if (!(await checkRateLimit(req, 'admin-signin', 8, 15 * 60))) return NextResponse.json({ error: 'Too many administrator sign-in attempts. Please wait 15 minutes.' }, { status: 429, headers: { 'retry-after': '900' } });
    const { password } = await req.json();
    if (!secret || !sessionSecret) return NextResponse.json({ error: 'Administrator sign-in is not configured.' }, { status: 503 });
    if (typeof password !== 'string' || password.length > 256 || !(await verifyAdminPassword(password))) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }
    await recordAdminActivity('admin.login.success', 'admin_session', null, { method: 'password' });
    const response = NextResponse.json({ ok: true });
    response.cookies.set('ebn_admin', createAdminSession(sessionSecret), {
      httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'strict',
      path: '/', maxAge: ADMIN_SESSION_MAX_AGE,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Request failed.' }, { status: 400 });
  }
}

export async function GET(req: Request) {
  if (!isAdminRequest(req, sessionSecret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureOrderEmailEventsTable();
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
      const [result, customerResult, activity, rewardsResult] = await Promise.all([
      pool.query(
        `SELECT o.reference,o.auth_user_id,o.customer_email,o.customer_name,o.customer_phone,o.address,
                COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
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
                COALESCE(SUM(COALESCE(order_total_kobo,amount_kobo)) FILTER (WHERE status='paid'),0)::bigint AS paid_total_kobo,
                MAX(created_at) AS last_order_at
         FROM public.ebnimaam_orders WHERE customer_email IS NOT NULL AND customer_email<>''
         GROUP BY LOWER(customer_email) ORDER BY last_order_at DESC LIMIT 500`,
      ),
      getRecentAdminActivity(40),
      pool.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS rewards_paid_kobo FROM public.ebnimaam_wallet_ledger WHERE direction='credit' AND entry_type IN ('referral_reward','game_reward','referral_welcome')").catch(()=>({rows:[{rewards_paid_kobo:0}]})),
    ]);
    return NextResponse.json({ orders: result.rows, customers: customerResult.rows, activity, rewards_paid_kobo: rewardsResult.rows[0]?.rewards_paid_kobo || 0, email_configured: isOrderEmailConfigured() }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Orders unavailable.' }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body?.action === 'change_admin_password') {
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');
    if (!currentPassword || !await verifyAdminPassword(currentPassword, false)) return NextResponse.json({error:'Your current administrator password is incorrect.'},{status:401});
    if (newPassword.length < 14 || newPassword.length > 256 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return NextResponse.json({error:'Use at least 14 characters with uppercase, lowercase, a number and a symbol.'},{status:400});
    }
    if (sameSecret(currentPassword,newPassword)) return NextResponse.json({error:'Choose a new password that is different from the current password.'},{status:400});
    await ensureAdminCredentialSchema();
    await pool.query('INSERT INTO public.ebnimaam_admin_credentials(id,password_hash) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash,updated_at=NOW()',[hashAdminPassword(newPassword)]);
    await recordAdminActivity('admin.password.changed','admin_security',null,{method:'owner_password_change'});
    const response=NextResponse.json({ok:true,message:'Administrator password updated. Sign in again with the new password.'});
    response.cookies.set('ebn_admin','',{httpOnly:true,secure:new URL(req.url).protocol==='https:',sameSite:'strict',path:'/',maxAge:0});
    return response;
  }
  const reference = String(body?.reference || '').trim();
  if (!reference || reference.length > 160) {
    return NextResponse.json({ error: 'A valid order reference is required.' }, { status: 400 });
  }

  if (body?.tracking_update === true) {
    const carrier = String(body?.trackingCarrier || '').trim().slice(0, 100);
    const trackingCode = String(body?.trackingCode || '').trim().slice(0, 120);
    const trackingUrlInput = String(body?.trackingUrl || '').trim().slice(0, 2000);
    let trackingUrl: string | null = null;
    if (trackingUrlInput) {
      try {
        const parsed = new URL(trackingUrlInput);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
        trackingUrl = parsed.toString();
      } catch {
        return NextResponse.json({ error: 'Enter a valid HTTPS courier tracking link.' }, { status: 400 });
      }
    }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          "UPDATE public.ebnimaam_orders SET address=COALESCE(address,'{}'::jsonb) || $1::jsonb,updated_at=NOW() WHERE reference=$2 RETURNING fulfilment_status",
          [JSON.stringify({ tracking_carrier: carrier, tracking_code: trackingCode, tracking_url: trackingUrl || '' }), reference],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
        }
        await client.query(
          'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
          [reference, 'tracking_updated', 'Courier tracking information updated.', 'admin'],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await recordAdminActivity('order.tracking.updated', 'order', reference, { carrier: carrier || null, hasTrackingUrl: Boolean(trackingUrl), hasTrackingCode: Boolean(trackingCode) });
      return NextResponse.json({ ok: true, trackingCarrier: carrier, trackingCode, trackingUrl });
    } catch {
      return NextResponse.json({ error: 'Courier tracking details could not be saved.' }, { status: 500 });
    }
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
      const pushMessage = fulfilmentStatus === 'shipped' ? 'Your order has been dispatched.'
        : fulfilmentStatus === 'delivered' ? 'Your order has been marked delivered.'
        : fulfilmentStatus === 'ready_for_pickup' ? 'Your order is ready for collection.'
        : fulfilmentStatus === 'collected' ? 'Your collection is complete.'
        : fulfilmentStatus === 'cancelled' ? 'Your order status has changed to cancelled.'
        : 'Your order has moved to ' + fulfilmentStatus.replace(/_/g,' ') + '.';
      await notifyOrder(reference,'Ebnimaam · Order update',pushMessage).catch(()=>{});
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
 + salt + 'export async function POST(req: Request) {
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
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
      const [result, customerResult, activity] = await Promise.all([
      pool.query(
        `SELECT o.reference,o.auth_user_id,o.customer_email,o.customer_name,o.customer_phone,o.address,
                COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
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
                COALESCE(SUM(COALESCE(order_total_kobo,amount_kobo)) FILTER (WHERE status='paid'),0)::bigint AS paid_total_kobo,
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

  if (body?.tracking_update === true) {
    const carrier = String(body?.trackingCarrier || '').trim().slice(0, 100);
    const trackingCode = String(body?.trackingCode || '').trim().slice(0, 120);
    const trackingUrlInput = String(body?.trackingUrl || '').trim().slice(0, 2000);
    let trackingUrl: string | null = null;
    if (trackingUrlInput) {
      try {
        const parsed = new URL(trackingUrlInput);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
        trackingUrl = parsed.toString();
      } catch {
        return NextResponse.json({ error: 'Enter a valid HTTPS courier tracking link.' }, { status: 400 });
      }
    }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          "UPDATE public.ebnimaam_orders SET address=COALESCE(address,'{}'::jsonb) || $1::jsonb,updated_at=NOW() WHERE reference=$2 RETURNING fulfilment_status",
          [JSON.stringify({ tracking_carrier: carrier, tracking_code: trackingCode, tracking_url: trackingUrl || '' }), reference],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
        }
        await client.query(
          'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
          [reference, 'tracking_updated', 'Courier tracking information updated.', 'admin'],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await recordAdminActivity('order.tracking.updated', 'order', reference, { carrier: carrier || null, hasTrackingUrl: Boolean(trackingUrl), hasTrackingCode: Boolean(trackingCode) });
      return NextResponse.json({ ok: true, trackingCarrier: carrier, trackingCode, trackingUrl });
    } catch {
      return NextResponse.json({ error: 'Courier tracking details could not be saved.' }, { status: 500 });
    }
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
 + scryptSync(password, salt, 64).toString('hex');
}
function verifyAdminPasswordHash(password: string, stored: string) {
  try {
    const [scheme,salt,hash] = stored.split('export async function POST(req: Request) {
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
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
      const [result, customerResult, activity] = await Promise.all([
      pool.query(
        `SELECT o.reference,o.auth_user_id,o.customer_email,o.customer_name,o.customer_phone,o.address,
                COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
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
                COALESCE(SUM(COALESCE(order_total_kobo,amount_kobo)) FILTER (WHERE status='paid'),0)::bigint AS paid_total_kobo,
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

  if (body?.tracking_update === true) {
    const carrier = String(body?.trackingCarrier || '').trim().slice(0, 100);
    const trackingCode = String(body?.trackingCode || '').trim().slice(0, 120);
    const trackingUrlInput = String(body?.trackingUrl || '').trim().slice(0, 2000);
    let trackingUrl: string | null = null;
    if (trackingUrlInput) {
      try {
        const parsed = new URL(trackingUrlInput);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
        trackingUrl = parsed.toString();
      } catch {
        return NextResponse.json({ error: 'Enter a valid HTTPS courier tracking link.' }, { status: 400 });
      }
    }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          "UPDATE public.ebnimaam_orders SET address=COALESCE(address,'{}'::jsonb) || $1::jsonb,updated_at=NOW() WHERE reference=$2 RETURNING fulfilment_status",
          [JSON.stringify({ tracking_carrier: carrier, tracking_code: trackingCode, tracking_url: trackingUrl || '' }), reference],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
        }
        await client.query(
          'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
          [reference, 'tracking_updated', 'Courier tracking information updated.', 'admin'],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await recordAdminActivity('order.tracking.updated', 'order', reference, { carrier: carrier || null, hasTrackingUrl: Boolean(trackingUrl), hasTrackingCode: Boolean(trackingCode) });
      return NextResponse.json({ ok: true, trackingCarrier: carrier, trackingCode, trackingUrl });
    } catch {
      return NextResponse.json({ error: 'Courier tracking details could not be saved.' }, { status: 500 });
    }
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
);
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash,'hex');
    const actual = scryptSync(password,salt,64);
    return expected.length === actual.length && timingSafeEqual(expected,actual);
  } catch { return false; }
}
async function verifyAdminPassword(password: string, bootstrap = true) {
  await ensureAdminCredentialSchema();
  const stored = await pool.query('SELECT password_hash FROM public.ebnimaam_admin_credentials WHERE id=1');
  if (stored.rowCount) return verifyAdminPasswordHash(password,String(stored.rows[0].password_hash));
  if (!secret || !sameSecret(password,secret)) return false;
  if (bootstrap) await pool.query(
    'INSERT INTO public.ebnimaam_admin_credentials(id,password_hash) VALUES(1,$1) ON CONFLICT(id) DO NOTHING',
    [hashAdminPassword(secret)],
  );
  return true;
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
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
      const [result, customerResult, activity] = await Promise.all([
      pool.query(
        `SELECT o.reference,o.auth_user_id,o.customer_email,o.customer_name,o.customer_phone,o.address,
                COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,
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
                COALESCE(SUM(COALESCE(order_total_kobo,amount_kobo)) FILTER (WHERE status='paid'),0)::bigint AS paid_total_kobo,
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

  if (body?.tracking_update === true) {
    const carrier = String(body?.trackingCarrier || '').trim().slice(0, 100);
    const trackingCode = String(body?.trackingCode || '').trim().slice(0, 120);
    const trackingUrlInput = String(body?.trackingUrl || '').trim().slice(0, 2000);
    let trackingUrl: string | null = null;
    if (trackingUrlInput) {
      try {
        const parsed = new URL(trackingUrlInput);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
        trackingUrl = parsed.toString();
      } catch {
        return NextResponse.json({ error: 'Enter a valid HTTPS courier tracking link.' }, { status: 400 });
      }
    }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          "UPDATE public.ebnimaam_orders SET address=COALESCE(address,'{}'::jsonb) || $1::jsonb,updated_at=NOW() WHERE reference=$2 RETURNING fulfilment_status",
          [JSON.stringify({ tracking_carrier: carrier, tracking_code: trackingCode, tracking_url: trackingUrl || '' }), reference],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
        }
        await client.query(
          'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
          [reference, 'tracking_updated', 'Courier tracking information updated.', 'admin'],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await recordAdminActivity('order.tracking.updated', 'order', reference, { carrier: carrier || null, hasTrackingUrl: Boolean(trackingUrl), hasTrackingCode: Boolean(trackingCode) });
      return NextResponse.json({ ok: true, trackingCarrier: carrier, trackingCode, trackingUrl });
    } catch {
      return NextResponse.json({ error: 'Courier tracking details could not be saved.' }, { status: 500 });
    }
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
