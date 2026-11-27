import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../lib/rate-limit';
import { verifyOrderTrackingToken } from '../../../lib/order-notifications';

export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function POST(req: Request) {
  let allowed = false;
  try {
    allowed = await checkRateLimit(req, 'order-track', 30, 15 * 60);
  } catch {
    return NextResponse.json({ error: 'Order tracking is temporarily unavailable. Please try again shortly.' }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Too many order lookups. Please wait 15 minutes before trying again.' }, { status: 429, headers: { 'retry-after': '900' } });
  }

  try {
    const body = await req.json();
    const token = String(body?.token || '').trim();
    const tokenReference = token ? verifyOrderTrackingToken(token) : null;
    if (token && !tokenReference) {
      return NextResponse.json({ error: 'This private tracking link is invalid or has expired. Enter your order reference and email to continue.' }, { status: 404 });
    }
    const reference = String(tokenReference || body?.reference || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!reference || reference.length > 160 || (!tokenReference && !email)) {
      return NextResponse.json({ error: 'Order reference and email are required.' }, { status: 400 });
    }

    const result = await pool.query(
      'SELECT o.reference,o.customer_email,o.amount_kobo,o.currency,o.status,o.fulfilment_status,o.created_at,o.paid_at,o.address,s.settings,COALESCE((SELECT json_agg(json_build_object(''status'',h.status,''note'',h.note,''created_at'',h.created_at) ORDER BY h.created_at ASC) FROM public.ebnimaam_order_status_history h WHERE h.reference=o.reference),''[]''::json) AS history FROM public.ebnimaam_orders o LEFT JOIN public.ebnimaam_store_settings s ON s.id=1 WHERE o.reference=$1 AND ($2::text IS NULL OR LOWER(o.customer_email)=LOWER($2))',
      [reference, tokenReference ? null : email],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    const row = result.rows[0];
    const address = row.address && typeof row.address === 'object' ? row.address : {};
    const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
    const pickup = String(address.fulfilment_method || 'delivery') === 'pickup';
    let trackingUrl = String(address.tracking_url || '').trim();
    try {
      const parsed = new URL(trackingUrl);
      trackingUrl = parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : '';
    } catch { trackingUrl = ''; }

    return NextResponse.json({
      order: {
        reference: row.reference,
        paymentStatus: row.status,
        fulfilmentStatus: row.fulfilment_status,
        fulfilmentMethod: pickup ? 'pickup' : 'delivery',
        deliveryFee: Number(address.delivery_fee || 0),
        pickupAddress: pickup ? String(address.pickup_address || settings.pickupAddress || '') : '',
        pickupHours: pickup ? String(address.pickup_hours || settings.pickupHours || '') : '',
        trackingCarrier: String(address.tracking_carrier || ''),
        trackingCode: String(address.tracking_code || ''),
        trackingUrl,
        total: Number(row.amount_kobo) / 100,
        currency: row.currency,
        createdAt: row.created_at,
        paidAt: row.paid_at,
        history: row.history,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to check order at this time.' }, { status: 500 });
  }
}