import { Pool } from 'pg';
import { sendOrderStatusEmail } from './order-notifications';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
type ReconcileResult =
  | { paid: true; reference: string; alreadyProcessed: boolean; fulfilmentStatus: string }
  | { paid: false; reference: string; status: string; alreadyProcessed: boolean };

const terminalFailureStatuses = new Set(['failed', 'abandoned', 'reversed']);

export async function verifyAndReconcilePaystack(
  referenceInput: string,
  sourceEvent?: Record<string, unknown>,
): Promise<ReconcileResult> {
  const reference = String(referenceInput || '').trim();
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!reference || !secret || !process.env.DATABASE_URL) throw new Error('Payment verification is not configured.');

  const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + secret, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  const tx = payload?.data;
  if (!response.ok || !payload?.status || tx?.reference !== reference) {
    throw new Error('Paystack could not verify this payment reference.');
  }
  const transactionStatus = String(tx.status || '').toLowerCase();
  const amountKobo = Number(tx.amount);
  const transactionId = Number(tx.id);
  if (tx.currency !== 'NGN') throw new Error('The transaction currency does not match NGN.');
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
    throw new Error('Paystack returned an invalid transaction amount or ID.');
  }

  const eventName = typeof sourceEvent?.event === 'string'
    ? sourceEvent.event
    : transactionStatus === 'success' ? 'transaction.verified' : 'transaction.status_checked';
  const safeEvent = {
    source: sourceEvent ? 'webhook' : 'customer_return',
    event: eventName,
    transaction_id: transactionId,
    reference,
    status: transactionStatus,
    currency: String(tx.currency),
    amount: amountKobo,
    channel: typeof tx.channel === 'string' ? tx.channel : null,
    paid_at: tx.paid_at || null,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT reference,amount_kobo,status,fulfilment_status,items,provider_transaction_id,currency
       FROM public.ebnimaam_orders WHERE reference=$1 FOR UPDATE`,
      [reference],
    );
    if (!locked.rowCount) throw new Error('The order reference was not found.');
    const order = locked.rows[0];
    if (Number(order.amount_kobo) !== amountKobo || order.currency !== 'NGN') {
      throw new Error('The amount or currency received does not match this order.');
    }
    if (order.provider_transaction_id && Number(order.provider_transaction_id) !== transactionId) {
      throw new Error('This order is already linked to a different Paystack transaction.');
    }

    const eventId = 'paystack-transaction-' + transactionId + '-' + transactionStatus;
    if (transactionStatus !== 'success') {
      if (terminalFailureStatuses.has(transactionStatus)) {
        if (order.status !== 'paid' && order.status !== transactionStatus) {
          await client.query(
            'UPDATE public.ebnimaam_orders SET status=$1,payment_provider=$2,provider_transaction_id=$3,updated_at=NOW() WHERE reference=$4',
            [transactionStatus, 'paystack', transactionId, reference],
          );
          await client.query(
            'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
            [reference, transactionStatus, 'Paystack reported transaction status: ' + transactionStatus + '.', 'paystack'],
          );
        }
      }
      await client.query(
        `INSERT INTO public.ebnimaam_payment_events(reference,provider_event_id,provider_transaction_id,event_type,payload,processed_at)
         VALUES($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT(provider_event_id) DO NOTHING`,
        [reference,eventId,transactionId,eventName,JSON.stringify(safeEvent)],
      );
      await client.query('COMMIT');
      if (terminalFailureStatuses.has(transactionStatus) && order.status !== 'paid') {
        await sendOrderStatusEmail(reference, 'payment_failed', process.env.NEXT_PUBLIC_SITE_URL || 'https://ebnimaam.vercel.app')
          .catch(() => ({ deliveryStatus: 'failed' }));
      }
      return { paid: false, reference, status: transactionStatus || 'unconfirmed', alreadyProcessed: false };
    }

    const alreadyProcessed = String(order.status || '').toLowerCase() === 'paid';
    if (alreadyProcessed && !order.provider_transaction_id) {
      // Older paid orders may predate transaction-ID persistence. Do not deduct stock again.
      await client.query(
        'UPDATE public.ebnimaam_orders SET provider_transaction_id=$1,payment_provider=$2,updated_at=NOW() WHERE reference=$3',
        [transactionId, 'paystack', reference],
      );
    }
    let fulfilmentStatus = String(order.fulfilment_status || 'processing');

    if (!alreadyProcessed) {
      let items: any[] = [];
      try { items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]'); } catch { items = []; }
      const normalised = (Array.isArray(items) ? items : []).map((item: any) => ({
        productId: String(item?.productId || '').trim(),
        size: String(item?.size || 'One Size').trim(),
        qty: Number(item?.qty),
      }));
      let stockIssue = !Array.isArray(items) || items.length === 0
        || normalised.some((item) => !item.productId || !item.size || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 10);

      // Group quantities before checking stock. A cart may contain the same product/size
      // on separate colour lines, so validating each line independently can oversell.
      const productTotals = new Map<string, number>();
      const sizeTotals = new Map<string, number>();
      if (!stockIssue) {
        for (const item of normalised) {
          productTotals.set(item.productId, (productTotals.get(item.productId) || 0) + item.qty);
          const key = JSON.stringify([item.productId, item.size]);
          sizeTotals.set(key, (sizeTotals.get(key) || 0) + item.qty);
        }
      }

      // Build sorted key arrays with Map.forEach so this compiles with the
      // repository's existing TypeScript target (which does not downlevel Map iteration).
      const productIds: string[] = [];
      const sizeKeys: string[] = [];
      productTotals.forEach((_quantity, productId) => productIds.push(productId));
      sizeTotals.forEach((_quantity, key) => sizeKeys.push(key));
      productIds.sort();

      const productsById = new Map<string, any>();
      if (!stockIssue) {
        const stockRows = await client.query(
          'SELECT id,stock,size_stock FROM public.ebnimaam_products WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
          [productIds],
        );
        for (let i = 0; i < stockRows.rows.length; i++) {
          const row = stockRows.rows[i];
          productsById.set(String(row.id), row);
        }
        if (productsById.size !== productIds.length) stockIssue = true;

        for (let i = 0; i < productIds.length && !stockIssue; i++) {
          const productId = productIds[i];
          const quantity = productTotals.get(productId) || 0;
          const product: any = productsById.get(productId);
          const overallStock = Number(product?.stock);
          if (!product || !Number.isSafeInteger(overallStock) || overallStock < quantity) {
            stockIssue = true;
          }
        }

        for (let i = 0; i < sizeKeys.length && !stockIssue; i++) {
          const key = sizeKeys[i];
          const quantity = sizeTotals.get(key) || 0;
          const [productId, size] = JSON.parse(key) as [string, string];
          const product: any = productsById.get(productId);
          let sizeStock = product?.size_stock;
          if (typeof sizeStock === 'string') {
            try { sizeStock = JSON.parse(sizeStock); } catch { sizeStock = {}; }
          }
          if (sizeStock && typeof sizeStock === 'object' && !Array.isArray(sizeStock)
            && Object.prototype.hasOwnProperty.call(sizeStock, size)) {
            const available = Number(sizeStock[size]);
            if (!Number.isSafeInteger(available) || available < quantity) stockIssue = true;
          }
        }
      }

      if (!stockIssue) {
        // Products are locked in a stable order above. Decrement overall stock once
        // per product and each tracked size by its aggregated quantity in one transaction.
        for (let i = 0; i < productIds.length; i++) {
          const productId = productIds[i];
          const totalQuantity = productTotals.get(productId) || 0;
          const product: any = productsById.get(productId);
          let sizeStock = product.size_stock;
          if (typeof sizeStock === 'string') {
            try { sizeStock = JSON.parse(sizeStock); } catch { sizeStock = {}; }
          }
          sizeStock = sizeStock && typeof sizeStock === 'object' && !Array.isArray(sizeStock)
            ? { ...sizeStock }
            : {};
          for (let j = 0; j < sizeKeys.length; j++) {
            const key = sizeKeys[j];
            const [groupProductId, size] = JSON.parse(key) as [string, string];
            if (groupProductId !== productId || !Object.prototype.hasOwnProperty.call(sizeStock, size)) continue;
            sizeStock[size] = Number(sizeStock[size]) - (sizeTotals.get(key) || 0);
          }
          await client.query(
            'UPDATE public.ebnimaam_products SET stock=stock-$1,size_stock=$2::jsonb,updated_at=NOW() WHERE id=$3',
            [totalQuantity, JSON.stringify(sizeStock), productId],
          );
        }
      } else {
        fulfilmentStatus = 'stock_issue';
      }

      await client.query(
        `UPDATE public.ebnimaam_orders
         SET status='paid',paid_at=COALESCE(paid_at,NOW()),payment_provider='paystack',
             provider_transaction_id=$2,currency='NGN',fulfilment_status=$3,updated_at=NOW()
         WHERE reference=$1`,
        [reference,transactionId,fulfilmentStatus],
      );
      await client.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [reference,'paid',stockIssue?'Payment verified. Stock needs owner review before fulfilment.':'Payment verified with Paystack; inventory updated.','paystack'],
      );
      if (stockIssue) {
        await client.query(
          'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
          [reference,'stock_issue','Payment received but stock could not be fully confirmed. Owner action required.','system'],
        );
      }
    }

    await client.query(
      `INSERT INTO public.ebnimaam_payment_events(reference,provider_event_id,provider_transaction_id,event_type,payload,processed_at)
       VALUES($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT(provider_event_id) DO NOTHING`,
      [reference,eventId,transactionId,eventName,JSON.stringify(safeEvent)],
    );
    await client.query('COMMIT');
    if (!alreadyProcessed) {
      await sendOrderStatusEmail(reference, 'processing', process.env.NEXT_PUBLIC_SITE_URL || 'https://ebnimaam.vercel.app')
        .catch(() => ({ deliveryStatus: 'failed' }));
    }
    return { paid:true,reference,alreadyProcessed,fulfilmentStatus };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
