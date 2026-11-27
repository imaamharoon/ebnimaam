import { createHmac, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import nodemailer from 'nodemailer';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const validStatuses = new Set(['pending','processing','picked','shipped','delivered','cancelled','ready_for_pickup','collected','payment_failed']);

function parseObject(value: any): Record<string, any> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function html(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c));
}
export function isOrderEmailConfigured(): boolean {
  return Boolean(((process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.RESEND_API_KEY || process.env.BREVO_API_KEY) && process.env.EMAIL_FROM && process.env.AUTH_SECRET);
}
export async function ensureOrderEmailEventsTable(): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS public.ebnimaam_order_email_events (event_key TEXT PRIMARY KEY, reference TEXT NOT NULL, status_key TEXT NOT NULL, recipient TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'pending', provider_message_id TEXT, last_error TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ)");
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_order_email_events_reference_idx ON public.ebnimaam_order_email_events(reference, created_at DESC)');
  await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
}
export function createOrderTrackingToken(reference: string): string {
  const secret = process.env.AUTH_SECRET || '';
  if (!secret) throw new Error('Secure order tracking is not configured.');
  const payload = Buffer.from(JSON.stringify({ reference, expiresAt: Math.floor(Date.now()/1000) + 90*24*60*60 })).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}
export function verifyOrderTrackingToken(token: string): string | null {
  try {
    const secret = process.env.AUTH_SECRET || '';
    if (!secret || typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const expected = Buffer.from(createHmac('sha256', secret).update(parts[0]).digest('base64url'));
    const supplied = Buffer.from(parts[1]);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const reference = String(data?.reference || '');
    return reference && reference.length <= 160 && Number(data.expiresAt) > Math.floor(Date.now()/1000) ? reference : null;
  } catch { return null; }
}
function copyFor(status: string, pickup: boolean) {
  const copies: Record<string, {subject:string;heading:string;message:string}> = {
    pending: { subject:'We received your Ebnimaam order', heading:'Your order has been received', message:'Your order has been saved and is awaiting Paystack payment confirmation. We will begin fulfilment once payment is verified.' },
    processing: { subject:'Your Ebnimaam payment is confirmed', heading:'Payment confirmed — we are preparing your order', message:'Paystack has confirmed your payment. Your order is now with our team for preparation. We will keep you updated as it moves through fulfilment.' },
    picked: { subject:'Your Ebnimaam items have been picked', heading:'Your items have been picked', message:pickup ? 'Our team has picked the items in your order and is preparing them for collection.' : 'Our team has picked the items in your order and is preparing them for dispatch.' },
    shipped: { subject:'Your Ebnimaam order is on its way', heading:'Your order is on its way', message:'Your parcel has been handed to the delivery service. Sign in to your Ebnimaam account to view the latest updates.' },
    delivered: { subject:'Your Ebnimaam order has been delivered', heading:'Your order has been delivered', message:'Your Ebnimaam order has been marked as delivered. Thank you for shopping with us.' },
    cancelled: { subject:'An update about your Ebnimaam order', heading:'Your order has been cancelled', message:'Your order has been cancelled. Contact our store team if you need help or clarification.' },
    ready_for_pickup: { subject:'Your Ebnimaam order is ready for pickup', heading:'Your order is ready for collection', message:'Your order is ready. Please visit the pickup address during the stated collection hours.' },
    collected: { subject:'Your Ebnimaam pickup is complete', heading:'Your order has been collected', message:'Our team has recorded that your self-pickup order has been collected. Thank you for shopping with Ebnimaam.' },
    payment_failed: { subject:'Payment update for your Ebnimaam order', heading:'We could not confirm your payment', message:'Your payment has not been confirmed. Contact Ebnimaam support using your order reference if you need assistance.' }
  };
  return copies[status] || null;
}
export async function sendOrderStatusEmail(reference: string, statusInput: string, siteOrigin: string, note = '', force = false): Promise<{deliveryStatus:string;reason?:string}> {
  const status = String(statusInput || '').toLowerCase();
  if (!reference || !validStatuses.has(status)) return { deliveryStatus:'skipped', reason:'Unsupported status.' };
  await ensureOrderEmailEventsTable();
  const found = await pool.query('SELECT o.reference,o.customer_email,o.customer_name,COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.status AS payment_status,o.address,o.items,s.settings FROM public.ebnimaam_orders o LEFT JOIN public.ebnimaam_store_settings s ON s.id=1 WHERE o.reference=$1',[reference]);
  if (!found.rowCount) return { deliveryStatus:'failed', reason:'Order not found.' };
  const order = found.rows[0];
  const address = parseObject(order.address);
  const settings = parseObject(order.settings);
  const pickup = String(address.fulfilment_method || 'delivery') === 'pickup';
  const copy = copyFor(status, pickup);
  if (!copy) return { deliveryStatus:'skipped' };
  const recipient = String(order.customer_email || '').trim().toLowerCase();
  const eventKey = reference + ':' + status + (force ? ':manual:' + Date.now() : '');
  const claim = await pool.query(
    "INSERT INTO public.ebnimaam_order_email_events(event_key,reference,status_key,recipient,delivery_status,attempt_count) VALUES($1,$2,$3,$4,'sending',1) ON CONFLICT(event_key) DO UPDATE SET delivery_status='sending',last_error=NULL,attempt_count=public.ebnimaam_order_email_events.attempt_count+1,updated_at=NOW() WHERE public.ebnimaam_order_email_events.delivery_status IN ('failed','not_configured') OR (public.ebnimaam_order_email_events.delivery_status='sending' AND public.ebnimaam_order_email_events.updated_at < NOW()-INTERVAL '5 minutes') RETURNING event_key",
    [eventKey, reference, status, recipient || 'unknown']
  );
  if (!claim.rowCount) return { deliveryStatus:'already_sent' };
  const brevoKey = process.env.BREVO_API_KEY || '';
  const resendKey = process.env.RESEND_API_KEY || '';
  const sender = process.env.EMAIL_FROM || '';
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASS || '';
  const provider = smtpUser && smtpPass ? 'smtp' : (resendKey ? 'resend' : (brevoKey ? 'brevo' : ''));
  if (!provider || !sender || !process.env.AUTH_SECRET || !recipient) {
    const reason = !recipient ? 'Customer email is missing.' : 'Email setup is incomplete. Configure SMTP_USER, SMTP_PASS, EMAIL_FROM and AUTH_SECRET for Gmail SMTP (or a supported API fallback).';
    await pool.query('UPDATE public.ebnimaam_order_email_events SET delivery_status=$1,last_error=$2,updated_at=NOW() WHERE event_key=$3',[recipient?'not_configured':'failed',reason,eventKey]);
    return { deliveryStatus:recipient?'not_configured':'failed',reason };
  }
  let origin = '';
  try { const u = new URL(siteOrigin); if (!['https:','http:'].includes(u.protocol)) throw new Error(); origin = u.origin; }
  catch { return { deliveryStatus:'failed',reason:'Invalid tracking site URL.' }; }
  const trackingUrl = new URL('/account.html?next=track&reference=' + encodeURIComponent(reference), origin).toString();
  const items = Array.isArray(order.items) ? order.items : (()=>{try{return JSON.parse(String(order.items||'[]'));}catch{return [];}})();
  const naira = new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0});
  const rows = (Array.isArray(items)?items:[]).map((item:any)=>'<tr><td style="padding:10px;border-bottom:1px solid #eee7dc">'+html(item.name||'Item')+' <small>'+html([item.size,item.color].filter(Boolean).join(' · '))+'</small></td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee7dc">×'+html(item.qty||1)+'</td></tr>').join('');
  const pickupAddress = String(address.pickup_address || settings.pickupAddress || '').trim();
  const pickupHours = String(address.pickup_hours || settings.pickupHours || '').trim();
  const fulfilment = pickup
    ? '<p><b>Collection:</b> Self-pickup — no delivery fee</p><p><b>Pickup address:</b> '+html(pickupAddress)+'</p><p><b>Pickup hours:</b> '+html(pickupHours||'Please confirm collection time with the store.')+'</p>'
    : '<p><b>Delivery destination:</b> '+html([address.city,address.state].filter(Boolean).join(', '))+'</p><p><b>Delivery fee:</b> '+html(naira.format(Number(address.delivery_fee||0)))+'</p>';
  const storeNote = String(note||'').trim().slice(0,500);
  const body = '<!doctype html><html><body style="margin:0;background:#f7f5ef;font-family:Arial,sans-serif;color:#243348"><div style="max-width:620px;margin:28px auto;background:#fffefa;border:1px solid #e9e3d8"><header style="background:#102544;padding:26px 30px;color:#fff;font:22px Georgia,serif">ebnimaam</header><main style="padding:30px"><p>Hello '+html(order.customer_name||'there')+',</p><h1 style="font:normal 28px Georgia,serif;color:#102544">'+html(copy.heading)+'</h1><p style="line-height:1.8">'+html(copy.message)+'</p>'+(storeNote?'<p style="padding:12px;background:#f5f1e8;border-left:3px solid #c99550"><b>Store note:</b> '+html(storeNote)+'</p>':'')+'<section style="background:#f7f5ef;padding:18px;margin:22px 0"><b>Order '+html(reference)+'</b><p>Order total: '+html(naira.format(Number(order.amount_kobo||0)/100))+'</p><p>Payment status: '+html(order.payment_status||'pending')+'</p>'+fulfilment+'</section><table style="width:100%;border-collapse:collapse">'+rows+'</table><p style="text-align:center;margin:28px 0"><a href="'+html(trackingUrl)+'" style="display:inline-block;background:#102544;color:#fff;text-decoration:none;padding:15px 24px">SIGN IN TO VIEW YOUR ORDER</a></p><p style="font-size:12px;color:#78818b">Sign in to your verified Ebnimaam account to view this order and its delivery details. This link alone does not reveal your order. For help: ebnimaam.com@gmail.com · WhatsApp 08145672755</p></main><footer style="padding:18px 30px;border-top:1px solid #eee7dc;color:#87909a">© '+new Date().getFullYear()+' ebnimaam · Everyday, elevated.</footer></div></body></html>';
  const textBody = ['Hello '+String(order.customer_name||'there'),copy.heading,copy.message,'Order: '+reference,'Total: '+naira.format(Number(order.amount_kobo||0)/100),pickup?'Self-pickup — no delivery fee':'Delivery fee: '+naira.format(Number(address.delivery_fee||0)),pickupAddress?'Pickup address: '+pickupAddress:'',pickupHours?'Pickup hours: '+pickupHours:'',storeNote?'Store note: '+storeNote:'','Track your order: '+trackingUrl].filter(Boolean).join('\n');
  try {
    let messageId = '';
    if (provider === 'smtp') {
      const port = Number(process.env.SMTP_PORT || 465);
      if (port !== 465 && port !== 587) throw new Error('SMTP_PORT must be 465 (SSL) or 587 (STARTTLS).');
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: port === 465,
        requireTLS: port === 587,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        tls: { minVersion: 'TLSv1.2' },
      });
      let info: any;
      try {
        info = await transport.sendMail({ from: sender, to: recipient, subject: copy.subject + ' · ' + reference, html: body, text: textBody });
      } finally {
        transport.close();
      }
      const accepted = Array.isArray(info?.accepted) && info.accepted.some((entry: any) =>
        String(typeof entry === 'string' ? entry : entry?.address || '').trim().toLowerCase() === recipient
      );
      if (!accepted || typeof info?.messageId !== 'string' || !info.messageId) {
        const reason = 'Gmail SMTP did not confirm acceptance of the customer address.';
        await pool.query("UPDATE public.ebnimaam_order_email_events SET delivery_status='failed',last_error=$1,updated_at=NOW() WHERE event_key=$2",[reason,eventKey]);
        return {deliveryStatus:'failed',reason};
      }
      messageId = info.messageId;
    } else {
      let response: Response;
      let payload: any;
      if (provider === 'resend') {
        response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resendKey,'Content-Type':'application/json'},body:JSON.stringify({from:sender,to:[recipient],subject:copy.subject+' · '+reference,html:body,text:textBody}),cache:'no-store',signal:AbortSignal.timeout(10000)});
      } else {
        const match = sender.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
        const senderEmail = match ? match[2].trim() : sender.trim();
        const senderName = match ? match[1].replace(/^['"]|['"]$/g,'').trim() : 'Ebnimaam';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
          const reason = 'EMAIL_FROM must be a valid sender email address or display-name address.';
          await pool.query("UPDATE public.ebnimaam_order_email_events SET delivery_status='failed',last_error=$1,updated_at=NOW() WHERE event_key=$2",[reason,eventKey]);
          return {deliveryStatus:'failed',reason};
        }
        response = await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':brevoKey,'Content-Type':'application/json','accept':'application/json'},body:JSON.stringify({sender:{email:senderEmail,name:senderName||'Ebnimaam'},to:[{email:recipient}],subject:copy.subject+' · '+reference,htmlContent:body,textContent:textBody}),cache:'no-store',signal:AbortSignal.timeout(10000)});
      }
      payload = await response.json().catch(()=>({}));
      const providerId = provider === 'brevo' ? payload?.messageId : payload?.id;
      if (!response.ok || !providerId) {
        const reason = String(payload?.message||payload?.error||payload?.code||'Email provider could not accept the message.').slice(0,400);
        await pool.query("UPDATE public.ebnimaam_order_email_events SET delivery_status='failed',last_error=$1,updated_at=NOW() WHERE event_key=$2",[reason,eventKey]);
        return {deliveryStatus:'failed',reason};
      }
      messageId = String(providerId);
    }
    await pool.query("UPDATE public.ebnimaam_order_email_events SET delivery_status='sent',provider_message_id=$1,last_error=NULL,sent_at=NOW(),updated_at=NOW() WHERE event_key=$2",[String(messageId).slice(0,160),eventKey]);
    return {deliveryStatus:'sent'};
  } catch (error:any) {
    const reason = String(error?.message||'Email delivery failed.').slice(0,400);
    await pool.query("UPDATE public.ebnimaam_order_email_events SET delivery_status='failed',last_error=$1,updated_at=NOW() WHERE event_key=$2",[reason,eventKey]);
    return {deliveryStatus:'failed',reason};
  }
}
