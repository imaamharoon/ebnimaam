import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '@/lib/admin-auth';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const defaults = {
  storeName:'ebnimaam', country:'Nigeria', deliveryCountries:['Nigeria'], pickupAddress:'', pickupHours:'',
  holidayExceptions:'', deliveryRules:'', supportEmail:'ebnimaam.com@gmail.com', supportPhone:'08145672755',
  socialLinks:{}, returnsPolicy:'', privacyPolicy:'', terms:'', shippingPolicy:'', promotions:[]
};
async function init() {
  await pool.query('CREATE TABLE IF NOT EXISTS public.ebnimaam_store_settings(id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),settings JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('INSERT INTO public.ebnimaam_store_settings(id,settings) VALUES(1,$1) ON CONFLICT(id) DO NOTHING',[JSON.stringify(defaults)]);
}
export async function GET(req: Request) {
  try {
    await init();
    const result = await pool.query('SELECT settings,updated_at FROM public.ebnimaam_store_settings WHERE id=1');
    const settings = result.rows[0]?.settings || defaults;
    if (!isAdminRequest(req)) {
      const { returnsPolicy, privacyPolicy, terms, shippingPolicy, ...publicSettings } = settings;
      return NextResponse.json({ settings: publicSettings, updated_at: result.rows[0]?.updated_at }, { headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json(result.rows[0], { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Settings unavailable.' }, { status: 503 });
  }
}
export async function PUT(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await init();
    const body = await req.json();
    const allowed = { ...defaults, ...body, country: 'Nigeria', deliveryCountries: ['Nigeria'] };
    await pool.query('UPDATE public.ebnimaam_store_settings SET settings=$1::jsonb,updated_at=NOW() WHERE id=1',[JSON.stringify(allowed)]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Settings save failed.' }, { status: 500 });
  }
}
