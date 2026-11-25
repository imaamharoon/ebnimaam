import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../lib/rate-limit';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export async function POST(req: Request) {
  let allowed = false;
  try {
    allowed = await checkRateLimit(req, 'order-track', 30, 15 * 60);
  } catch {
    return NextResponse.json({ error: 'Order tracking is temporarily unavailable. Please try again shortly.' }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: 'Too many order lookups. Please wait 15 minutes before trying again.' }, { status: 429, headers: { 'retry-after': '900' } });
  try {
    const body = await req.json();
    const reference = String(body?.reference || '').trim();
    const email = String(body?.email || '').trim();
    if (!reference || !email) return NextResponse.json({ error: 'Order reference and email are required.' }, { status: 400 });
    const result = await pool.query(
      `SELECT o.reference,o.customer_email,o.amount_kobo,o.currency,o.status,
              CASE WHEN LOWER(o.status)<>'paid' AND o.fulfilment_status IN ('picked','packed','shipped','delivered')
                   THEN 'awaiting_payment' ELSE o.fulfilment_status END AS fulfilment_status,
              o.created_at,o.paid_at,
              COALESCE((SELECT json_agg(json_build_object('status',h.status,'note',h.note,'created_at',h.created_at) ORDER BY h.created_at ASC)
                FROM public.ebnimaam_order_status_history h WHERE h.reference=o.reference),'[]'::json) AS history
       FROM public.ebnimaam_orders o WHERE o.reference=$1 AND LOWER(o.customer_email)=LOWER($2)`,
      [reference, email],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = result.rows[0];
    return NextResponse.json({
      order: {
        reference: order.reference, paymentStatus: order.status, fulfilmentStatus: order.fulfilment_status,
        total: Number(order.amount_kobo) / 100, currency: order.currency, createdAt: order.created_at,
        paidAt: order.paid_at, history: order.history,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to check order at this time.' }, { status: 500 });
  }
}
