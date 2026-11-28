import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { verifyAndReconcilePaystack } from '../../../lib/paystack-reconciliation';
import { notifyOrder } from '../../../lib/push-notifications';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'Webhook verification is not configured.' }, { status: 503 });

  const declaredSize = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declaredSize) && declaredSize > 256_000) {
    return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, 'utf8') > 256_000) {
    return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
  }
  const signature = req.headers.get('x-paystack-signature') || '';
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const supplied = Buffer.from(signature, 'utf8');
  const calculated = Buffer.from(expected, 'utf8');
  if (!signature || supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
    return NextResponse.json({ error: 'Invalid Paystack webhook signature.' }, { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: 'Invalid webhook body.' }, { status: 400 });
  }

  if (!['charge.success', 'charge.failed'].includes(String(event?.event || ''))) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const reference = String(event?.data?.reference || '').trim();
  if (!reference) return NextResponse.json({ error: 'Webhook transaction reference is missing.' }, { status: 400 });
  try {
    const result = await verifyAndReconcilePaystack(reference, { event: event.event });
    if (event.event === 'charge.success' && result.paid && !result.alreadyProcessed) {
      const message = result.fulfilmentStatus === 'stock_issue'
        ? 'A payment was verified, but its stock needs owner review.'
        : 'A customer payment was confirmed. Open Orders to review the new order.';
      await notifyOrder(reference,'Ebnimaam · New paid order',message).catch(()=>{});
    }
    return NextResponse.json({ received: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ received: false, error: error?.message || 'Could not reconcile transaction.' }, { status: 503 });
  }
}
