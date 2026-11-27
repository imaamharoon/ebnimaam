import type { Pool, PoolClient } from 'pg';

export async function ensureCouponsSchema(pool: Pool | PoolClient) {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_coupons(
    code TEXT PRIMARY KEY,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),
    value INTEGER NOT NULL CHECK(value>0),
    min_spend_kobo BIGINT NOT NULL DEFAULT 0 CHECK(min_spend_kobo>=0),
    max_redemptions INTEGER,
    redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK(redeemed_count>=0),
    valid_until TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(max_redemptions IS NULL OR max_redemptions>0),
    CHECK(discount_type<>'percent' OR value<=100)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_coupon_redemptions(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL REFERENCES public.ebnimaam_coupons(code),
    user_id TEXT NOT NULL,
    order_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','redeemed','released')),
    discount_kobo BIGINT NOT NULL CHECK(discount_kobo>=0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    redeemed_at TIMESTAMPTZ,
    UNIQUE(code,user_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_coupon_redemptions_code_status_idx ON public.ebnimaam_coupon_redemptions(code,status)');
}

export async function reserveCoupon(
  client: PoolClient,
  input: { code: string; userId: string; orderReference: string; subtotalKobo: number },
) {
  const code = String(input.code || '').trim().toUpperCase();
  if (!code) return { code: '', discountKobo: 0 };
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) throw new Error('Enter a valid promotional code.');
  const result = await client.query(
    'SELECT code,discount_type,value,min_spend_kobo,max_redemptions,redeemed_count,valid_until,active FROM public.ebnimaam_coupons WHERE code=$1 FOR UPDATE',
    [code],
  );
  if (!result.rowCount) throw new Error('That promotional code is not available.');
  const coupon = result.rows[0];
  if (!coupon.active || (coupon.valid_until && new Date(coupon.valid_until).getTime()<=Date.now())) {
    throw new Error('That promotional code has expired or is inactive.');
  }
  if (input.subtotalKobo < Number(coupon.min_spend_kobo || 0)) {
    throw new Error('This promotion requires a higher product subtotal.');
  }
  const existing = await client.query(
    "SELECT status FROM public.ebnimaam_coupon_redemptions WHERE code=$1 AND user_id=$2 FOR UPDATE",
    [code,input.userId],
  );
  if (existing.rowCount) {
    if (existing.rows[0].status === 'pending') throw new Error('This promotional code is already reserved for another pending payment.');
    if (existing.rows[0].status === 'redeemed') throw new Error('This promotional code has already been used on your account.');
    await client.query('DELETE FROM public.ebnimaam_coupon_redemptions WHERE code=$1 AND user_id=$2 AND status=\'released\'', [code,input.userId]);
  }
  if (coupon.max_redemptions != null) {
    const activeUses = await client.query(
      "SELECT COUNT(*)::int AS count FROM public.ebnimaam_coupon_redemptions WHERE code=$1 AND status IN ('pending','redeemed')",
      [code],
    );
    if (Number(activeUses.rows[0]?.count || 0) >= Number(coupon.max_redemptions)) {
      throw new Error('This promotional code has reached its redemption limit.');
    }
  }
  let discountKobo = coupon.discount_type === 'percent'
    ? Math.floor(input.subtotalKobo * Number(coupon.value) / 100)
    : Number(coupon.value) * 100;
  discountKobo = Math.max(0,Math.min(input.subtotalKobo,discountKobo));
  if (!Number.isSafeInteger(discountKobo) || discountKobo <= 0) throw new Error('This promotional code does not apply to your cart.');
  await client.query(
    `INSERT INTO public.ebnimaam_coupon_redemptions(code,user_id,order_reference,status,discount_kobo)
     VALUES($1,$2,$3,'pending',$4)`,
    [code,input.userId,input.orderReference,discountKobo],
  );
  return { code, discountKobo };
}

export async function finalizeCouponRedemption(client: PoolClient, orderReference: string, paid: boolean) {
  const redemption = await client.query(
    'SELECT code,status FROM public.ebnimaam_coupon_redemptions WHERE order_reference=$1 FOR UPDATE',
    [orderReference],
  );
  if (!redemption.rowCount || redemption.rows[0].status !== 'pending') return;
  const { code } = redemption.rows[0];
  if (paid) {
    const changed = await client.query(
      "UPDATE public.ebnimaam_coupon_redemptions SET status='redeemed',redeemed_at=NOW() WHERE order_reference=$1 AND status='pending' RETURNING code",
      [orderReference],
    );
    if (changed.rowCount) await client.query('UPDATE public.ebnimaam_coupons SET redeemed_count=redeemed_count+1 WHERE code=$1',[code]);
  } else {
    await client.query("UPDATE public.ebnimaam_coupon_redemptions SET status='released' WHERE order_reference=$1 AND status='pending'",[orderReference]);
  }
}
