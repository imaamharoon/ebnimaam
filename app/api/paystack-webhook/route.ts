import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { verifyAndReconcilePaystack } from '@/lib/paystack-reconciliation';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: 'Webhook verification is not configured.' }, { status: 503 });

  const rawBody = await req.text();
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

  if (event?.event !== 'charge.success') {
    return NextResponse.json({ received: true, ignored: true });
  }

  const reference = String(event?.data?.reference || '').trim();
  if (!reference) return NextResponse.json({ error: 'Webhook transaction reference is missing.' }, { status: 400 });
  try {
    const result = await verifyAndReconcilePaystack(reference, { event: event.event });
    return NextResponse.json({ received: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ received: false, error: error?.message || 'Could not reconcile transaction.' }, { status: 503 });
  }
}
