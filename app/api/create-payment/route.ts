import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../lib/rate-limit';
import { sendOrderStatusEmail } from '../../../lib/order-notifications';
import { ensureLoyaltyTables } from '../../../lib/loyalty';

export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const authBase = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');

const deliveryFees: Record<string, number> = {
  Plateau: 1500,
  'FCT - Abuja': 3500, Kano: 3500, Kaduna: 3500, Nasarawa: 3500, Bauchi: 3500,
  Lagos: 4500, Ogun: 4500, Oyo: 4500, Rivers: 4500,
};
const states = new Set([
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi',
  'Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi',
  'Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'
]);
function fallbackDelivery(state: string) { return deliveryFees[state] ?? 5000; }

export async function POST(req: Request) {
  let reference = '';
  let couponReservationCreated = false;
  let walletReservationCreated = false;
  let walletAppliedKobo = 0;
  const declaredSize = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declaredSize) && declaredSize > 32_768) {
    return NextResponse.json({ error: 'Your checkout request is too large. Please review your cart and try again.' }, { status: 413 });
  }
  try {
    if (!process.env.PAYSTACK_SECRET_KEY || !process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'Checkout is temporarily unavailable.' }, { status: 503 });
    }

    let checkoutAllowed = false;
    try {
      checkoutAllowed = await checkRateLimit(req, 'customer-checkout', 20, 15 * 60);
    } catch {
      return NextResponse.json({ error: 'Checkout is temporarily unavailable. Please try again shortly.' }, { status: 503 });
    }
    if (!checkoutAllowed) return NextResponse.json({ error: 'Too many checkout attempts. Please wait 15 minutes before trying again.' }, { status: 429, headers: { 'retry-after': '900' } });

    const body = await req.json();
    const cookie = req.headers.get('cookie') || '';
    let verifiedUser: { id: string; email: string; name?: string } | null = null;
    if (cookie) {
      try {
        const session = await fetch(authBase + '/get-session', {
          headers: { cookie, origin: new URL(req.url).origin },
          cache: 'no-store',
        });
        if (session.ok) {
          const sessionData = await session.json();
          const user = sessionData?.user;
          if (user?.id && user?.email && user.emailVerified === true) {
            verifiedUser = { id: String(user.id), email: String(user.email), name: String(user.name || '') };
          }
        }
      } catch {
        // Fail closed: checkout requires a verified account session.
      }
    }

    if (!verifiedUser) {
      return NextResponse.json({ error: 'Please sign in to your Ebnimaam account before checkout.' }, { status: 401 });
    }
    await ensureLoyaltyTables();
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS paystack_amount_kobo BIGINT');
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS wallet_amount_kobo BIGINT NOT NULL DEFAULT 0');

    const customerNameInput = String(body?.customer?.name || '').trim().slice(0, 120);
    const customerPhone = String(body?.customer?.phone || '').trim().slice(0, 40);
    const customerName = (customerNameInput || verifiedUser.name || '').trim().slice(0, 120);
    const customerEmail = verifiedUser.email.trim().toLowerCase();
    if (customerName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || customerPhone.replace(/\D/g, '').length < 7) {
      return NextResponse.json({ error: 'Enter your full name, a valid email address and a reachable phone number to continue.' }, { status: 400 });
    }

    const fulfilmentMethod = String(body?.fulfilmentMethod || 'delivery').trim().toLowerCase();
    if (!['delivery', 'pickup'].includes(fulfilmentMethod)) {
      return NextResponse.json({ error: 'Choose home delivery or self-pickup to continue.' }, { status: 400 });
    }
    const address = body?.address || {};
    const country = String(address.country || 'Nigeria').trim();
    const state = String(address.state || '').trim();
    const city = String(address.city || '').trim().slice(0, 100);
    const street = String(address.street || '').trim().slice(0, 240);
    if (country !== 'Nigeria' || (fulfilmentMethod === 'delivery' && (!states.has(state) || !city || !street))) {
      return NextResponse.json({ error: 'A complete Nigerian delivery address is required for home delivery. International orders are not available.' }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
      return NextResponse.json({ error: 'Your cart is empty or contains too many items.' }, { status: 400 });
    }

    const requested = body.items.map((item: any) => ({
      productId: String(item?.productId || '').trim(),
      size: String(item?.size || 'One Size').trim().slice(0, 40),
      color: String(item?.color || '').trim().slice(0, 40),
      qty: Number(item?.qty),
    }));
    if (requested.some((item: any) => !item.productId || !item.size || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 10)) {
      return NextResponse.json({ error: 'Please check the quantities and sizes in your cart.' }, { status: 400 });
    }
    if (new Set(requested.map((item: any) => item.productId + '|' + item.size + '|' + item.color)).size !== requested.length) {
      return NextResponse.json({ error: 'Remove duplicate product, size and colour lines and try again.' }, { status: 400 });
    }

    const productIds = Array.from(new Set(requested.map((item: any) => item.productId)));
    const live = await pool.query(
      'SELECT id,name,price,stock,sizes,size_stock,product_details FROM public.ebnimaam_products WHERE id = ANY($1::text[]) AND is_active = TRUE',
      [productIds],
    );
    const catalog = new Map(live.rows.map((row: any) => [String(row.id), row]));
    if (catalog.size !== productIds.length) {
      return NextResponse.json({ error: 'One or more products are no longer available. Refresh the shop and try again.' }, { status: 409 });
    }

    const productQuantities = new Map<string, number>();
    const sizeQuantities = new Map<string, number>();
    for (const item of requested) {
      const product: any = catalog.get(item.productId);
      if (!product || Number(product.price) <= 0) throw new Error('A cart product has an invalid price.');
      const availableSizes = Array.isArray(product.sizes) ? product.sizes.map((value: any) => String(value)) : [];
      if (availableSizes.length && !availableSizes.includes(item.size)) throw new Error('The selected size for ' + String(product.name) + ' is no longer available.');
      const sizeKey = JSON.stringify([item.productId, item.size]);
      productQuantities.set(item.productId, (productQuantities.get(item.productId) || 0) + item.qty);
      sizeQuantities.set(sizeKey, (sizeQuantities.get(sizeKey) || 0) + item.qty);
      const colors = Array.isArray(product.product_details?.colors) ? product.product_details.colors.map((color: any) => String(color.name)) : [];
      if (item.color && colors.length && !colors.includes(item.color)) throw new Error('The selected colour for ' + String(product.name) + ' is no longer available.');
    }
    for (const [productId, quantity] of Array.from(productQuantities.entries())) {
      const product: any = catalog.get(productId);
      if (quantity > Number(product?.stock || 0)) throw new Error('There is not enough overall stock for ' + String(product?.name || 'this item') + '.');
    }
    for (const [sizeKey, quantity] of Array.from(sizeQuantities.entries())) {
      const [productId, size] = JSON.parse(sizeKey) as [string, string];
      const product: any = catalog.get(productId);
      const perSizeStock = product?.size_stock && Object.prototype.hasOwnProperty.call(product.size_stock, size)
        ? Number(product.size_stock[size])
        : Number(product?.stock || 0);
      if (quantity > perSizeStock) throw new Error('There is not enough stock for ' + String(product?.name || 'this item') + ' in size ' + size + '.');
    }
    let subtotal = 0;
    const items = requested.map((item: any) => {
      const product: any = catalog.get(item.productId);
      subtotal += Number(product.price) * item.qty;
      return { productId: item.productId, name: String(product.name), size: item.size, color: item.color || null, qty: item.qty, price: Number(product.price) };
    });

    const promoCode = String(body?.promoCode || '').trim().toUpperCase().slice(0, 24);
    let discount = 0;
    let coupon: any = null;
    if (promoCode) {
      const couponResult = await pool.query("SELECT code,discount_type,discount_value,minimum_subtotal_kobo,max_redemptions,per_user_limit,starts_at,ends_at,is_active FROM public.ebnimaam_coupons WHERE code=$1", [promoCode]);
      if (!couponResult.rowCount) return NextResponse.json({ error: 'That coupon code is not valid.' }, { status: 400 });
      coupon = couponResult.rows[0];
      const now = Date.now();
      if (!coupon.is_active || (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) || (coupon.ends_at && new Date(coupon.ends_at).getTime() <= now)) {
        return NextResponse.json({ error: 'That coupon is not active at this time.' }, { status: 400 });
      }
      if (subtotal * 100 < Number(coupon.minimum_subtotal_kobo || 0)) return NextResponse.json({ error: 'Your basket does not meet the minimum subtotal for this coupon.' }, { status: 400 });
      discount = coupon.discount_type === 'percent'
        ? Math.floor(subtotal * Number(coupon.discount_value) / 100)
        : Math.floor(Math.min(subtotal * 100, Number(coupon.discount_value)) / 100);
      if (!Number.isSafeInteger(discount) || discount <= 0 || discount >= subtotal) return NextResponse.json({ error: 'This coupon cannot be applied to the current basket.' }, { status: 400 });
    }
    const settingsResult = await pool.query('SELECT settings FROM public.ebnimaam_store_settings WHERE id=1');
    const storeSettings = settingsResult.rows[0]?.settings || {};
    const configuredFees = storeSettings.deliveryFeesByState || {};
    const pickupAddress = String(storeSettings.pickupAddress || 'Terminus Main Market, near the bus stop').trim();
    if (fulfilmentMethod === 'pickup' && !pickupAddress) {
      return NextResponse.json({ error: 'Self-pickup is not available yet. Please contact Ebnimaam or choose home delivery.' }, { status: 409 });
    }
    const deliveryFee = fulfilmentMethod === 'pickup'
      ? 0
      : Number(configuredFees[state] ?? configuredFees.default ?? fallbackDelivery(state));
    if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0 || deliveryFee > 50000) throw new Error('Delivery fee configuration is invalid. Please contact the store.');
    const amountNaira = subtotal - discount + deliveryFee;
    if (!Number.isSafeInteger(amountNaira) || amountNaira <= 0) throw new Error('The checkout total is invalid.');
    const amountKobo = amountNaira * 100;
    if (!Number.isSafeInteger(amountKobo)) throw new Error('The checkout total is too large.');

    reference = 'EBN-' + randomUUID();


    if (coupon) {
      const couponClient = await pool.connect();
      try {
        await couponClient.query('BEGIN');
        const lockedCoupon = await couponClient.query('SELECT * FROM public.ebnimaam_coupons WHERE code=$1 FOR UPDATE', [promoCode]);
        if (!lockedCoupon.rowCount || !lockedCoupon.rows[0].is_active
          || (lockedCoupon.rows[0].starts_at && new Date(lockedCoupon.rows[0].starts_at).getTime() > Date.now())
          || (lockedCoupon.rows[0].ends_at && new Date(lockedCoupon.rows[0].ends_at).getTime() <= Date.now())) {
          await couponClient.query('ROLLBACK');
          return NextResponse.json({ error: 'This coupon is no longer active.' }, { status: 409 });
        }
        const currentCoupon = lockedCoupon.rows[0];
        if (subtotal * 100 < Number(currentCoupon.minimum_subtotal_kobo || 0)) { await couponClient.query('ROLLBACK'); return NextResponse.json({ error: 'Your basket no longer meets the minimum order for this coupon.' }, { status: 409 }); }
        if (String(currentCoupon.discount_type) !== String(coupon.discount_type) || Number(currentCoupon.discount_value) !== Number(coupon.discount_value)) {
          await couponClient.query('ROLLBACK');
          return NextResponse.json({ error: 'This coupon changed while checkout was open. Please refresh and try again.' }, { status: 409 });
        }
        const uses = await couponClient.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE user_id=$2)::int AS customer_uses FROM public.ebnimaam_coupon_redemptions WHERE code=$1 AND status IN ('pending','paid')", [promoCode, verifiedUser.id]);
        if (currentCoupon.max_redemptions && Number(uses.rows[0]?.total || 0) >= Number(currentCoupon.max_redemptions)) {
          await couponClient.query('ROLLBACK');
          return NextResponse.json({ error: 'This coupon has reached its use limit.' }, { status: 409 });
        }
        if (Number(uses.rows[0]?.customer_uses || 0) >= Number(currentCoupon.per_user_limit || 1)) {
          await couponClient.query('ROLLBACK');
          return NextResponse.json({ error: 'You have already used this coupon the maximum number of times.' }, { status: 409 });
        }
        await couponClient.query(
          "INSERT INTO public.ebnimaam_coupon_redemptions(code,user_id,reference,discount_kobo,status) VALUES($1,$2,$3,$4,'pending')",
          [promoCode, verifiedUser.id, reference, discount * 100]
        );
        await couponClient.query('COMMIT');
        couponReservationCreated = true;
      } catch (error) {
        await couponClient.query('ROLLBACK');
        throw error;
      } finally { couponClient.release(); }
    }

    if (body?.useWalletBalance === true && amountKobo > 10000) {
      const walletClient = await pool.connect();
      try {
        await walletClient.query('BEGIN');
        await walletClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [verifiedUser.id]);
        const balance = await walletClient.query("SELECT COALESCE(SUM(amount_kobo),0)::bigint AS available FROM public.ebnimaam_wallet_ledger WHERE user_id=$1 AND status<>'rejected'", [verifiedUser.id]);
        const available = Math.max(0, Number(balance.rows[0]?.available || 0));
        walletAppliedKobo = Math.min(available, Math.max(0, amountKobo - 10000));
        if (walletAppliedKobo > 0) {
          await walletClient.query("INSERT INTO public.ebnimaam_wallet_ledger(user_id,entry_type,amount_kobo,status,source_key,description) VALUES($1,'wallet_spend',$2,'pending',$3,$4)", [verifiedUser.id, -walletAppliedKobo, 'wallet-checkout:' + reference, 'Ebnimaam balance reserved for checkout']);
          walletReservationCreated = true;
        }
        await walletClient.query('COMMIT');
      } catch (error) {
        await walletClient.query('ROLLBACK');
        throw error;
      } finally { walletClient.release(); }
    }
    const paystackAmountKobo = amountKobo - walletAppliedKobo;

    await pool.query(
      `INSERT INTO public.ebnimaam_orders
       (reference,auth_user_id,customer_email,customer_name,customer_phone,address,amount_kobo,paystack_amount_kobo,wallet_amount_kobo,currency,status,fulfilment_status,items,payment_provider,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'NGN','pending','processing',$10::jsonb,'paystack',NOW(),NOW())`,
      [
        reference, verifiedUser.id, customerEmail, customerName, customerPhone,
        JSON.stringify(fulfilmentMethod === 'pickup'
          ? { country: 'Nigeria', fulfilment_method: 'pickup', pickup_address: pickupAddress, pickup_hours: String(storeSettings.pickupHours || ''), delivery_fee: 0, subtotal, discount, promo_code: discount ? promoCode : null }
          : { country: 'Nigeria', fulfilment_method: 'delivery', state, city, street, postal: String(address.postal || '').slice(0, 30), delivery_fee: deliveryFee, subtotal, discount, promo_code: discount ? promoCode : null }),
        amountKobo, paystackAmountKobo, walletAppliedKobo, JSON.stringify(items),
      ],
    );
    await pool.query(
      'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
      [reference, 'pending', 'Order created by a verified customer; awaiting Paystack confirmation.', verifiedUser.id],
    );

    const paymentResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: customerEmail,
        amount: paystackAmountKobo,
        reference,
        metadata: { order_reference: reference, delivery_fee: deliveryFee, fulfilment_method: fulfilmentMethod, subtotal, discount, wallet_amount_kobo: walletAppliedKobo, customer_type: 'account' },
        callback_url: new URL('/payment-return.html', req.url).toString(),
      }),
      cache: 'no-store',
    });
    const paymentData = await paymentResponse.json().catch(() => null);
    if (!paymentResponse.ok || !paymentData?.status || !paymentData?.data?.authorization_url) {
      const message = String(paymentData?.message || 'Paystack could not initialize this payment.');
      await pool.query('UPDATE public.ebnimaam_orders SET status=$1,updated_at=NOW() WHERE reference=$2', ['initialization_failed', reference]);
      await pool.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [reference, 'initialization_failed', message.slice(0, 500), 'paystack'],
      );
      if (couponReservationCreated) await pool.query("UPDATE public.ebnimaam_coupon_redemptions SET status='released',updated_at=NOW() WHERE reference=$1 AND status='pending'", [reference]).catch(() => {});
      if (walletReservationCreated) await pool.query("UPDATE public.ebnimaam_wallet_ledger SET status='rejected',updated_at=NOW() WHERE source_key=$1 AND status='pending'", ['wallet-checkout:' + reference]).catch(() => {});
      return NextResponse.json({ error: message }, { status: 502 });
    }
    await sendOrderStatusEmail(reference, 'pending', new URL(req.url).origin).catch(() => ({ deliveryStatus: 'failed' }));
    return NextResponse.json({ authorization_url: paymentData.data.authorization_url, reference, fulfilmentMethod, deliveryFee, walletAppliedKobo, paystackAmountKobo });
  } catch (error: any) {
    if (reference && couponReservationCreated) await pool.query("UPDATE public.ebnimaam_coupon_redemptions SET status='released',updated_at=NOW() WHERE reference=$1 AND status='pending'", [reference]).catch(() => {});
    if (reference && walletReservationCreated) await pool.query("UPDATE public.ebnimaam_wallet_ledger SET status='rejected',updated_at=NOW() WHERE source_key=$1 AND status='pending'", ['wallet-checkout:' + reference]).catch(() => {});
    return NextResponse.json({ error: error?.message || 'Payment initialization failed.' }, { status: reference ? 502 : 400 });
  }
}
