import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../lib/admin-auth';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const defaultFees: Record<string, number> = {
  Plateau:1500,'FCT - Abuja':3500,Kano:3500,Kaduna:3500,Nasarawa:3500,Bauchi:3500,
  Lagos:4500,Ogun:4500,Oyo:4500,Rivers:4500,default:5000,
};
const defaultSettings = {
  storeName:'ebnimaam',country:'Nigeria',deliveryCountries:['Nigeria'],deliveryFeesByState:defaultFees,
  pickupAddress:'',pickupHours:'',holidayExceptions:'',deliveryRules:'',
  supportEmail:'ebnimaam.com@gmail.com',supportPhone:'08145672755',socialLinks:{},
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
    if (!String(settings.supportEmail || '').trim()) settings.supportEmail = defaultSettings.supportEmail;
    if (!String(settings.supportPhone || '').trim()) settings.supportPhone = defaultSettings.supportPhone;
    if (!settings.deliveryFeesByState || typeof settings.deliveryFeesByState !== 'object') settings.deliveryFeesByState = defaultFees;
    else settings.deliveryFeesByState = { ...defaultFees, ...settings.deliveryFeesByState };
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
    const deliveryFeesByState: Record<string, number> = { ...defaultFees };
    for (const [state, raw] of Object.entries(incomingFees)) {
      const value = Number(raw);
      if (state !== 'default' && !Object.prototype.hasOwnProperty.call(defaultFees, state)) continue;
      if (!Number.isSafeInteger(value) || value < 0 || value > 50000) {
        return NextResponse.json({ error: 'Delivery fees must be whole naira amounts from ₦0 to ₦50,000.' }, { status: 400 });
      }
      deliveryFeesByState[state] = value;
    }
    const allowed = {
      ...defaultSettings,
      ...body,
      country:'Nigeria',
      deliveryCountries:['Nigeria'],
      deliveryFeesByState,
    };
    await pool.query('UPDATE public.ebnimaam_store_settings SET settings=$1::jsonb,updated_at=NOW() WHERE id=1',[JSON.stringify(allowed)]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Settings save failed.' }, { status: 500 });
  }
}
