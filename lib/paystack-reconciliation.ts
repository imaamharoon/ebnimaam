import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
type ReconcileResult = { paid: true; reference: string; alreadyProcessed: boolean; fulfilmentStatus: string };

export async function verifyAndReconcilePaystack(referenceInput: string, sourceEvent?: Record<string, unknown>): Promise<ReconcileResult> {
  const reference = String(referenceInput || '').trim();
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!reference || !secret || !process.env.DATABASE_URL) throw new Error('Payment verification is not configured.');

  const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + secret, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  const tx = payload?.data;
  if (!response.ok || !payload?.status || tx?.status !== 'success' || tx?.reference !== reference) {
    throw new Error('Paystack has not confirmed this payment.');
  }
  if (tx.currency !== 'NGN') throw new Error('The transaction currency does not match NGN.');
  const amountKobo = Number(tx.amount);
  const transactionId = Number(tx.id);
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
    throw new Error('Paystack returned an invalid transaction amount or ID.');
  }

  const safeEvent = {
    source: sourceEvent ? 'webhook' : 'customer_return',
    event: typeof sourceEvent?.event === 'string' ? sourceEvent.event : 'transaction.verified',
    transaction_id: transactionId,
    reference,
    status: String(tx.status),
    currency: String(tx.currency),
    amount: amountKobo,
    channel: typeof tx.channel === 'string' ? tx.channel : null,
    paid_at: tx.paid_at || null,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT reference, amount_kobo, status, fulfilment_status, items, provider_transaction_id, currency FROM public.ebnimaam_orders WHERE reference = $1 FOR UPDATE',
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

    const alreadyProcessed = order.status === 'paid' && Number(order.provider_transaction_id) === transactionId;
    let fulfilmentStatus = String(order.fulfilment_status || 'processing');

    if (!alreadyProcessed) {
      let items: any[] = [];
      try { items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]'); } catch { items = []; }
      let stockIssue = !Array.isArray(items) || items.length === 0;
      const normalised = (Array.isArray(items) ? items : []).map((item: any) => ({
        productId: String(item.productId || ''),
        qty: Number(item.qty),
      }));
      if (normalised.some((item) => !item.productId || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 10)) {
        stockIssue = true;
      }

      if (!stockIssue) {
        for (const item of normalised) {
          const stockRow = await client.query(
            'SELECT stock FROM public.ebnimaam_products WHERE id = $1 FOR UPDATE',
            [item.productId],
          );
          if (!stockRow.rowCount || Number(stockRow.rows[0].stock || 0) < item.qty) {
            stockIssue = true;
            break;
          }
        }
      }

      if (!stockIssue) {
        for (const item of normalised) {
          await client.query(
            'UPDATE public.ebnimaam_products SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
            [item.qty, item.productId],
          );
        }
      } else {
        fulfilmentStatus = 'stock_issue';
      }

      await client.query(
        `UPDATE public.ebnimaam_orders
         SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), payment_provider = 'paystack',
             provider_transaction_id = $2, currency = 'NGN', fulfilment_status = $3, updated_at = NOW()
         WHERE reference = $1`,
        [reference, transactionId, fulfilmentStatus],
      );
      await client.query(
        'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
        [reference, 'paid', stockIssue ? 'Payment verified. Stock needs owner review before fulfilment.' : 'Payment verified with Paystack; inventory updated.', 'paystack'],
      );
      if (stockIssue) {
        await client.query(
          'INSERT INTO public.ebnimaam_order_status_history(reference,status,note,changed_by) VALUES($1,$2,$3,$4)',
          [reference, 'stock_issue', 'Payment received but stock could not be fully confirmed. Owner action required.', 'system'],
        );
      }
    }

    const eventId = 'paystack-transaction-' + transactionId;
    await client.query(
      `INSERT INTO public.ebnimaam_payment_events(reference,provider_event_id,provider_transaction_id,event_type,payload,processed_at)
       VALUES($1,$2,$3,$4,$5::jsonb,NOW()) ON CONFLICT (provider_event_id) DO NOTHING`,
      [reference, eventId, transactionId, safeEvent.event, JSON.stringify(safeEvent)],
    );
    await client.query('COMMIT');
    return { paid: true, reference, alreadyProcessed, fulfilmentStatus };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
