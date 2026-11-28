import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const vapidPublic = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivate = () => process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = () => process.env.VAPID_SUBJECT || 'mailto:ebnimaam.com@gmail.com';

export function getPushConfiguration() {
  return { enabled: Boolean(vapidPublic() && vapidPrivate()), publicKey: vapidPublic() };
}

async function ensurePushSchema() {
  await pool.query(\`CREATE TABLE IF NOT EXISTS public.ebnimaam_push_subscriptions(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_key TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    expiration_time BIGINT,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )\`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_push_owner_idx ON public.ebnimaam_push_subscriptions(owner_key,updated_at DESC)');
}

export async function savePushSubscription(ownerKey: string, subscription: any, userAgent = '') {
  await ensurePushSchema();
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) throw new Error('The browser returned an incomplete notification subscription.');
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('The notification endpoint must use HTTPS.');
  if (endpoint.length > 4096 || p256dh.length > 500 || auth.length > 500) throw new Error('The notification subscription is too large.');
  await pool.query(
    \`INSERT INTO public.ebnimaam_push_subscriptions(owner_key,endpoint,p256dh,auth,expiration_time,user_agent)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(endpoint) DO UPDATE SET owner_key=EXCLUDED.owner_key,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
       expiration_time=EXCLUDED.expiration_time,user_agent=EXCLUDED.user_agent,updated_at=NOW()\`,
    [ownerKey,endpoint,p256dh,auth,subscription.expirationTime==null?null:Number(subscription.expirationTime),String(userAgent).slice(0,240)],
  );
}

export async function hasPushSubscription(ownerKey: string) {
  await ensurePushSchema();
  const result = await pool.query('SELECT 1 FROM public.ebnimaam_push_subscriptions WHERE owner_key=$1 LIMIT 1',[ownerKey]);
  return Boolean(result.rowCount);
}

export async function removePushSubscription(ownerKey: string, endpoint: string) {
  await ensurePushSchema();
  await pool.query('DELETE FROM public.ebnimaam_push_subscriptions WHERE owner_key=$1 AND endpoint=$2',[ownerKey,endpoint]);
}

export async function sendPushToOwner(ownerKey: string, notification: { title: string; body: string; url?: string; tag?: string }) {
  const keys = getPushConfiguration();
  if (!keys.enabled) return { sent: 0, configured: false };
  try {
    await ensurePushSchema();
    const webPush = (await import('web-push')).default as any;
    webPush.setVapidDetails(vapidSubject(),vapidPublic(),vapidPrivate());
    const rows = await pool.query('SELECT id,endpoint,p256dh,auth FROM public.ebnimaam_push_subscriptions WHERE owner_key=$1',[ownerKey]);
    let sent = 0;
    await Promise.all(rows.rows.map(async (row:any)=>{
      const subscription = { endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth} };
      try {
        await webPush.sendNotification(subscription,JSON.stringify({
          title:String(notification.title||'Ebnimaam').slice(0,80),
          body:String(notification.body||'').slice(0,220),
          url:String(notification.url||'/store.html'),
          tag:String(notification.tag||'ebnimaam-update').slice(0,100),
        }),{TTL:60*60});
        sent += 1;
      } catch(error:any) {
        if ([404,410].includes(Number(error?.statusCode))) {
          await pool.query('DELETE FROM public.ebnimaam_push_subscriptions WHERE id=$1',[row.id]);
        }
      }
    }));
    return { sent, configured: true };
  } catch {
    return { sent: 0, configured: true };
  }
}

export async function notifyOrder(reference: string, title: string, message: string, url = '/account.html') {
  try {
    const found = await pool.query('SELECT auth_user_id FROM public.ebnimaam_orders WHERE reference=$1',[reference]);
    if (!found.rowCount) return;
    const userId = String(found.rows[0].auth_user_id || '');
    const tasks:Promise<any>[] = [sendPushToOwner('admin',{title,body:message,url:'/admin#orders',tag:'order-'+reference})];
    if(userId) tasks.push(sendPushToOwner('customer:'+userId,{title,body:message,url:url+'?next=track&reference='+encodeURIComponent(reference),tag:'order-'+reference}));
    await Promise.allSettled(tasks);
  } catch { /* Push is best-effort and never blocks payment or fulfilment. */ }
}
