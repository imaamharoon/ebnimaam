import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../lib/rate-limit';
import { sendOrderStatusEmail } from '../../../lib/order-notifications';
import { isCurrentCustomerSession } from '../../../lib/customer-sessions';
import { ensureLoyaltySchema, walletAvailable } from '../../../lib/loyalty';
import { ensureCouponsSchema, reserveCoupon } from '../../../lib/coupons';

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
          if (user?.id && user?.email && user.emailVerified === true && await isCurrentCustomerSession(req, String(user.id))) {
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

    const promoCode = String(body?.promoCode || '').trim().toUpperCase();
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
    const subtotalKobo = subtotal * 100;
    if (!Number.isSafeInteger(subtotalKobo) || subtotalKobo <= 0) throw new Error('The checkout subtotal is invalid.');
    const deliveryFeeKobo = deliveryFee * 100;
    reference = 'EBN-' + randomUUID();

    await ensureLoyaltySchema(pool);
    await ensureCouponsSchema(pool);
    await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
  
    let discountKobo = 0;
    let walletCreditKobo = 0;
    let amountDueKobo = 0;
    let orderTotalKobo = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[verifiedUser.id]);
      const coupon = await reserveCoupon(client,{code:promoCode,userId:verifiedUser.id,orderReference:reference,subtotalKobo});
      discountKobo = coupon.discountKobo;
      orderTotalKobo = subtotalKobo - discountKobo + deliveryFeeKobo;
      if (!Number.isSafeInteger(orderTotalKobo) || orderTotalKobo <= 0) throw new Error('The checkout total is invalid.');
      const useWallet = body?.useWallet === true;
      if (useWallet) {
        const available = await walletAvailable(client,verifiedUser.id);
        walletCreditKobo = Math.min(available,Math.max(0,orderTotalKobo-100));
        if (walletCreditKobo < 0) walletCreditKobo = 0;
      }
      amountDueKobo = orderTotalKobo - walletCreditKobo;
      if (!Number.isSafeInteger(amountDueKobo) || amountDueKobo < 100) throw new Error('The remaining payment amount must be at least ₦1.');
      const addressSnapshot = fulfilmentMethod === 'pickup'
        ? { country:'Nigeria',fulfilment_method:'pickup',pickup_address:pickupAddress,pickup_hours:String(storeSettings.pickupHours||''),delivery_fee:0,subtotal,discount_kobo:discountKobo,promo_code:discountKobo?promoCode:null,wallet_credit_kobo:walletCreditKobo,order_total_kobo:orderTotalKobo }
        : { country:'Nigeria',fulfilment_method:'delivery',state,city,street,postal:String(address.postal||'').slice(0,30),delivery_fee:deliveryFee,subtotal,discount_kobo:discountKobo,promo_code:discountKobo?promoCode:null,wallet_credit_kobo:walletCreditKobo,order_total_kobo:orderTotalKobo };
      await client.query(
        `INSERT INTO public.ebnimaam_orders
         (reference,auth_user_id,customer_email,customer_name,customer_phone,address,amount_kobo,order_total_kobo,currency,status,fulfilment_status,items,payment_provider,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'NGN','pending','processing',$9::jsonb,'paystack',NOW(),NOW())`,
        [reference,verifiedUser.id,customerEmail,customerName,customerPhone,JSON.stringify(addressSnapshot),amountDueKobo,orderTotalKobo,JSON.stringify(items)],
      );
      if (walletCreditKobo > 0) {
        await client.query(
          `INSERT INTO public.ebnimaam_wallet_reservations(reference,user_id,amount_kobo,status)
           VALUES($1,$2,$3,'reserved')`,
          [reference,verifiedUser.id,walletCreditKobo],
        );
      }
      await client.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [reference,'pending','Order created by a verified customer; awaiting Paystack confirmation.',verifiedUser.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally {
      client.release();
    }

    const discount = discountKobo / 100;
    const paymentResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: customerEmail,
        amount: amountDueKobo,
        reference,
        metadata: { order_reference: reference, delivery_fee: deliveryFee, fulfilment_method: fulfilmentMethod, subtotal, discount, wallet_credit_kobo:walletCreditKobo, order_total_kobo:orderTotalKobo, customer_type: 'account' },
        callback_url: new URL('/payment-return.html', req.url).toString(),
      }),
      cache: 'no-store',
    });
    const paymentData = await paymentResponse.json().catch(() => null);
    if (!paymentResponse.ok || !paymentData?.status || !paymentData?.data?.authorization_url) {
      const message = String(paymentData?.message || 'Paystack could not initialize this payment.');
      await pool.query('UPDATE public.ebnimaam_orders SET status=$1,updated_at=NOW() WHERE reference=$2', ['initialization_failed', reference]);
      await pool.query("UPDATE public.ebnimaam_wallet_reservations SET status='released',updated_at=NOW() WHERE reference=$1 AND status='reserved'",[reference]);
      await pool.query("UPDATE public.ebnimaam_coupon_redemptions SET status='released' WHERE order_reference=$1 AND status='pending'",[reference]);
      await pool.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [reference,'initialization_failed',message.slice(0,500),'paystack'],
      );
      return NextResponse.json({ error: message }, { status: 502 });
    }
    await sendOrderStatusEmail(reference, 'pending', new URL(req.url).origin).catch(() => ({ deliveryStatus: 'failed' }));
    return NextResponse.json({ authorization_url: paymentData.data.authorization_url, reference, fulfilmentMethod, deliveryFee, walletCreditKobo, amountDueKobo, orderTotalKobo });
  } catch (error: any) {
    // A network error after a Paystack initialization request is ambiguous. Keep any wallet/coupon reservations until payment status can be verified.
    return NextResponse.json({ error: error?.message || 'Payment initialization failed. Any reserved wallet credit remains pending until payment status is checked.' }, { status: reference ? 502 : 400 });
  }
}
