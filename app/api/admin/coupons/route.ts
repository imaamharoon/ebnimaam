import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { recordAdminActivity } from '../../../../lib/admin-audit';
import { ensureCouponsSchema } from '../../../../lib/coupons';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
export async function GET(req:Request){
 if(!isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await ensureCouponsSchema(pool);const result=await pool.query('SELECT code,discount_type,value,min_spend_kobo,max_redemptions,redeemed_count,valid_until,active,created_at FROM public.ebnimaam_coupons ORDER BY created_at DESC LIMIT 100');return NextResponse.json({coupons:result.rows},{headers:{'cache-control':'no-store'}})}
 catch{return NextResponse.json({error:'Coupons are temporarily unavailable.'},{status:503})}
}
export async function POST(req:Request){
 if(!isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  await ensureCouponsSchema(pool);const body=await req.json().catch(()=>({}));
  const action=String(body.action||'create');
  const code=String(body.code||'').trim().toUpperCase();
  if(action==='toggle'){
   if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))return NextResponse.json({error:'Coupon code is invalid.'},{status:400});
   const active=body.active===true;
   const changed=await pool.query('UPDATE public.ebnimaam_coupons SET active=$1 WHERE code=$2 RETURNING code',[active,code]);
   if(!changed.rowCount)return NextResponse.json({error:'Coupon not found.'},{status:404});
   await recordAdminActivity('coupon.activation.changed','coupon',code,{active});
   return NextResponse.json({ok:true});
  }
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))return NextResponse.json({error:'Use 2–40 uppercase letters, numbers, hyphens or underscores for the code.'},{status:400});
  const discountType=String(body.discountType||'percent');
  const value=Number(body.value);
  const minSpendNaira=Number(body.minSpendNaira||0);
  const maxRedemptions=body.maxRedemptions===''||body.maxRedemptions==null?null:Number(body.maxRedemptions);
  const validUntil=String(body.validUntil||'').trim();
  if(!['percent','fixed'].includes(discountType)||!Number.isSafeInteger(value)||value<1||(discountType==='percent'&&value>100)||(discountType==='fixed'&&value>100000)||!Number.isSafeInteger(minSpendNaira)||minSpendNaira<0||minSpendNaira>10000000||(maxRedemptions!==null&&(!Number.isSafeInteger(maxRedemptions)||maxRedemptions<1||maxRedemptions>1000000)))
   return NextResponse.json({error:'Check the discount, minimum spend and redemption limit.'},{status:400});
  let validUntilDate:Date|null=null;
  if(validUntil){validUntilDate=new Date(validUntil+':00+01:00');if(!Number.isFinite(validUntilDate.getTime())||validUntilDate.getTime()<=Date.now())return NextResponse.json({error:'Expiry must be a valid future date and time.'},{status:400})}
  const result=await pool.query(
   `INSERT INTO public.ebnimaam_coupons(code,discount_type,value,min_spend_kobo,max_redemptions,valid_until,active)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(code) DO UPDATE SET discount_type=EXCLUDED.discount_type,value=EXCLUDED.value,
    min_spend_kobo=EXCLUDED.min_spend_kobo,max_redemptions=EXCLUDED.max_redemptions,
    valid_until=EXCLUDED.valid_until,active=EXCLUDED.active
    WHERE public.ebnimaam_coupons.redeemed_count=0
    RETURNING code`,
   [code,discountType,value,minSpendNaira*100,maxRedemptions,validUntilDate,body.active===true]);
  if(!result.rowCount)return NextResponse.json({error:'A coupon with previous redemptions cannot be edited. Create a new code to preserve the redemption history.'},{status:409});
  await recordAdminActivity('coupon.saved','coupon',code,{discountType,value,minSpendNaira,maxRedemptions,validUntil:validUntilDate?.toISOString()||null});
  return NextResponse.json({ok:true,code});
 }catch(error:any){return NextResponse.json({error:error?.message||'Coupon could not be saved.'},{status:400})}
}
