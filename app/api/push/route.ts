import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
import { getVerifiedCustomer } from '../../../lib/loyalty';
import { isAdminRequest } from '../../../lib/admin-auth';
import { getPushConfiguration, hasPushSubscription, removePushSubscription, savePushSubscription } from '../../../lib/push-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function owner(req: Request) {
  if (isAdminRequest(req,process.env.ADMIN_PASSWORD || process.env.AUTH_SECRET || '')) return 'admin';
  const customer = await getVerifiedCustomer(req);
  return customer ? 'customer:'+customer.id : '';
}

export async function GET(req: Request) {
  const ownerKey = await owner(req);
  if (!ownerKey) return NextResponse.json({error:'Sign in to manage your notifications.'},{status:401,headers:{'cache-control':'no-store'}});
  try {
    const config = getPushConfiguration();
    return NextResponse.json({
      configured:config.enabled,
      publicKey:config.enabled?config.publicKey:'',
      subscribed:config.enabled?await hasPushSubscription(ownerKey):false,
      message:config.enabled?'Push notifications are ready to enable on this device.':'Push delivery needs VAPID keys in the secure hosting environment.',
    },{headers:{'cache-control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Notification settings are temporarily unavailable.'},{status:503});
  }
}

export async function POST(req: Request) {
  const ownerKey = await owner(req);
  if (!ownerKey) return NextResponse.json({error:'Sign in to enable notifications.'},{status:401});
  if (!(await checkRateLimit(req,'push-subscription-save',10,15*60))) return NextResponse.json({error:'Please wait before changing notification settings again.'},{status:429});
  const config = getPushConfiguration();
  if (!config.enabled) return NextResponse.json({error:'Push delivery is not configured on the server yet. Ask the owner to configure VAPID keys in the hosting environment.'},{status:503});
  const body = await req.json().catch(()=>({}));
  try {
    await savePushSubscription(ownerKey,body?.subscription,req.headers.get('user-agent')||'');
    return NextResponse.json({ok:true,subscribed:true,message:'Notifications are enabled for this device.'},{headers:{'cache-control':'no-store'}});
  } catch(error:any) {
    return NextResponse.json({error:error?.message||'The notification subscription could not be saved.'},{status:400});
  }
}

export async function DELETE(req: Request) {
  const ownerKey = await owner(req);
  if (!ownerKey) return NextResponse.json({error:'Sign in to manage notifications.'},{status:401});
  const body = await req.json().catch(()=>({}));
  const endpoint = String(body?.endpoint||'').trim();
  if (!endpoint || endpoint.length>4096) return NextResponse.json({error:'A valid notification endpoint is required.'},{status:400});
  await removePushSubscription(ownerKey,endpoint);
  return NextResponse.json({ok:true,subscribed:false},{headers:{'cache-control':'no-store'}});
}
