import { NextResponse } from 'next/server';
import { Pool } from 'pg';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const reference = String(body?.reference || '').trim();
    const email = String(body?.email || '').trim();
    if (!reference || !email) return NextResponse.json({ error: 'Order reference and email are required.' }, { status: 400 });
    const result = await pool.query(
      `SELECT o.reference,o.customer_email,o.amount_kobo,o.currency,o.status,o.fulfilment_status,o.created_at,o.paid_at,
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
