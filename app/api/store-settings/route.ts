import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../lib/admin-auth';
import { recordAdminActivity } from '../../../lib/admin-audit';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const NIGERIAN_STATES = new Set([
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi',
  'Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi',
  'Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'
]);
const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb7JXDL0VycOVg5oBv0N';
const socialHosts: Record<string, string[]> = {
  instagram:['instagram.com'],
  facebook:['facebook.com','fb.com','fb.me'],
  tiktok:['tiktok.com'],
  youtube:['youtube.com','youtu.be'],
  x:['x.com','twitter.com'],
  whatsappChannel:['whatsapp.com'],
};
function normalizeSocialLinks(input: unknown) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Social profile links must be valid URLs.');
  const source = input as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [platform, hosts] of Object.entries(socialHosts)) {
    const value = String(source[platform] ?? (platform === 'whatsappChannel' ? WHATSAPP_CHANNEL_URL : '')).trim();
    if (!value) continue;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Enter a full HTTPS profile URL for ' + platform + '.'); }
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hosts.some((host) => hostname === host || hostname.endsWith('.' + host));
    if (url.protocol !== 'https:' || url.username || url.password || !allowedHost || !url.pathname || url.pathname === '/') {
      throw new Error('Enter a valid HTTPS ' + platform + ' profile URL.');
    }
    normalized[platform] = url.toString();
  }
  return normalized;
}
const defaultSettings = {
  storeName:'ebnimaam',country:'Nigeria',deliveryCountries:['Nigeria'],deliveryFeesByState:{},deliveryFeesConfirmed:false,
  pickupAddress:'',pickupAddressConfirmed:false,pickupHours:'',holidayExceptions:'',deliveryRules:'',
  supportEmail:'ebnimaam.com@gmail.com',supportPhone:'08145672755',lowStockThreshold:3,socialLinks:{whatsappChannel:WHATSAPP_CHANNEL_URL},
  returnsPolicy:'',privacyPolicy:'',terms:'',shippingPolicy:'',promotions:[],
};
async function init() {
  await pool.query('CREATE TABLE IF NOT EXISTS public.ebnimaam_store_settings(id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),settings JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('INSERT INTO public.ebnimaam_store_settings(id,settings) VALUES(1,$1) ON CONFLICT(id) DO NOTHING',[JSON.stringify(defaultSettings)]);
}
export async function GET(req: Request) {
  try {
    await init();
    const result = await pool.query('SELECT settings,updated_at FROM public.ebnimaam_store_settings WHERE id=1');
    const settings = { ...defaultSettings, ...(result.rows[0]?.settings || {}) };
    settings.socialLinks = { ...defaultSettings.socialLinks, ...(settings.socialLinks || {}) };
    if (!String(settings.supportEmail || '').trim()) settings.supportEmail = defaultSettings.supportEmail;
    if (!String(settings.supportPhone || '').trim()) settings.supportPhone = defaultSettings.supportPhone;
    if (!settings.deliveryFeesByState || typeof settings.deliveryFeesByState !== 'object' || Array.isArray(settings.deliveryFeesByState)) settings.deliveryFeesByState = {};
    if (!isAdminRequest(req)) {
      const { returnsPolicy, privacyPolicy, terms, shippingPolicy, ...publicSettings } = settings;
      return NextResponse.json({ settings: publicSettings, updated_at: result.rows[0]?.updated_at }, { headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ settings, updated_at: result.rows[0]?.updated_at }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Settings unavailable.' }, { status: 503 });
  }
}
export async function PUT(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await init();
    const body = await req.json();
    const incomingFees = body.deliveryFeesByState && typeof body.deliveryFeesByState === 'object' ? body.deliveryFeesByState : {};
    const deliveryFeesByState: Record<string, number> = {};
    for (const [state, raw] of Object.entries(incomingFees)) {
      const value = Number(raw);
      if (state !== 'default' && !NIGERIAN_STATES.has(state)) {
        return NextResponse.json({ error: 'A delivery fee was supplied for an unsupported Nigerian state.' }, { status: 400 });
      }
      if (raw === '' || raw === null || raw === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 0 || value > 50000) {
        return NextResponse.json({ error: 'Delivery fees must be whole naira amounts from ₦0 to ₦50,000.' }, { status: 400 });
      }
      deliveryFeesByState[state] = value;
    }
    const lowStockThreshold=Number(body.lowStockThreshold ?? defaultSettings.lowStockThreshold);
    if(!Number.isSafeInteger(lowStockThreshold)||lowStockThreshold<0||lowStockThreshold>1000) return NextResponse.json({error:'Low-stock alert threshold must be a whole number from 0 to 1,000.'},{status:400});
    const socialLinks = normalizeSocialLinks(body.socialLinks);
    const allowed = {
      ...defaultSettings,
      ...body,
      pickupAddress: String(body.pickupAddress ?? '').trim().slice(0, 500),
      pickupAddressConfirmed: body.pickupAddressConfirmed === true && !!String(body.pickupAddress ?? '').trim(),
      deliveryFeesConfirmed: body.deliveryFeesConfirmed === true && Object.keys(deliveryFeesByState).length > 0,
      pickupHours: String(body.pickupHours ?? '').trim().slice(0, 240),
      country:'Nigeria',
      deliveryCountries:['Nigeria'],
      deliveryFeesByState,
      lowStockThreshold,
      socialLinks,
    };
    await pool.query('UPDATE public.ebnimaam_store_settings SET settings=$1::jsonb,updated_at=NOW() WHERE id=1',[JSON.stringify(allowed)]);
    await recordAdminActivity('store_settings.updated', 'store_settings', '1', { updatedKeys: Object.keys(body).slice(0, 20).join(',') });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Settings save failed.' }, { status: 500 });
  }
}
