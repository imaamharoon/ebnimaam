import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
import { verifyAndReconcilePaystack } from '../../../lib/paystack-reconciliation';
import { getVerifiedCustomer } from '../../../lib/loyalty';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

export async function POST(req: Request) {
  let allowed = false;
  try {
    allowed = await checkRateLimit(req, 'verify-payment', 12, 15 * 60);
  } catch {
    return NextResponse.json({ paid: false, error: 'Payment verification is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (!allowed) {
    return NextResponse.json(
      { paid: false, error: 'Too many payment verification attempts. Please wait 15 minutes and try again.' },
      { status: 429, headers: { 'retry-after': '900', 'cache-control': 'no-store' } },
    );
  }

  try {
    const declaredSize = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(declaredSize) && declaredSize > 2048) {
      return NextResponse.json({ paid: false, error: 'Invalid payment verification request.' }, { status: 413, headers: { 'cache-control': 'no-store' } });
    }
    const body = await req.json();
    const user = await getVerifiedCustomer(req);
    if (!user) return NextResponse.json({ paid: false, error: 'Please sign in to your verified Ebnimaam account to confirm your order.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    const reference = String(body?.reference || '').trim();
    if (!reference || reference.length > 160) {
      return NextResponse.json({ paid: false, error: 'A valid payment reference is required.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
    const owned = await pool.query(
      "SELECT 1 FROM public.ebnimaam_orders WHERE reference=$1 AND (auth_user_id=$2 OR (auth_user_id IS NULL AND LOWER(customer_email)=LOWER($3))) LIMIT 1",
      [reference, user.id, user.email],
    );
    if (!owned.rowCount) return NextResponse.json({ paid: false, error: 'That payment reference is not linked to your account.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    const result = await verifyAndReconcilePaystack(reference);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    const message = String(error?.message || 'Payment verification is temporarily unavailable.');
    const status = message.includes('not found') ? 404 : message.includes('not configured') ? 503 : 400;
    return NextResponse.json({ paid: false, error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
