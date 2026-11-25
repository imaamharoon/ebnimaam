import { NextResponse } from 'next/server';
import { verifyAndReconcilePaystack } from '@/lib/paystack-reconciliation';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const reference = String(body?.reference || '').trim();
    if (!reference) return NextResponse.json({ error: 'A payment reference is required.' }, { status: 400 });
    const result = await verifyAndReconcilePaystack(reference);
    return NextResponse.json(result);
  } catch (error: any) {
    const message = String(error?.message || 'Payment verification is temporarily unavailable.');
    const status = message.includes('not found') ? 404 : message.includes('not configured') ? 503 : 400;
    return NextResponse.json({ paid: false, error: message }, { status });
  }
}
