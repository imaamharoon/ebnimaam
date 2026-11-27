import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { createTextPdf } from '../../../../lib/pdf';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const authBase=(process.env.NEON_AUTH_BASE_URL||'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/,'');
async function customer(req:Request){
 const cookie=req.headers.get('cookie')||'';if(!cookie)return null;
 const response=await fetch(authBase+'/get-session',{headers:{cookie,origin:new URL(req.url).origin},cache:'no-store'});
 if(!response.ok)return null;const data=await response.json();const user=data?.user;
 if(!user?.id||!user?.email||user.emailVerified!==true)return null;
 return user as {id:string;email:string;name?:string;emailVerified?:boolean};
}
export async function GET(req:Request){
 try{
  const user=await customer(req);
  if(!user)return NextResponse.json({error:'Please verify your email and sign in before downloading your information.'},{status:401});
  await pool.query("CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_profiles(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,full_name TEXT,phone TEXT,addresses JSONB NOT NULL DEFAULT '[]'::jsonb,preferences JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('ALTER TABLE public.ebnimaam_orders ADD COLUMN IF NOT EXISTS order_total_kobo BIGINT');
  await pool.query('UPDATE public.ebnimaam_orders SET order_total_kobo=amount_kobo WHERE order_total_kobo IS NULL');
  const profileResult=await pool.query('SELECT full_name,phone,addresses,preferences,created_at,updated_at FROM public.ebnimaam_customer_profiles WHERE user_id=$1',[user.id]);
  const ordersResult=await pool.query("SELECT o.reference,COALESCE(o.order_total_kobo,o.amount_kobo) AS amount_kobo,o.amount_kobo AS paystack_amount_kobo,o.currency,o.status,o.fulfilment_status,o.items,o.created_at,o.paid_at,COALESCE((SELECT json_agg(json_build_object('status',h.status,'note',h.note,'created_at',h.created_at) ORDER BY h.created_at ASC) FROM public.ebnimaam_order_status_history h WHERE h.reference=o.reference),'[]'::json) AS history FROM public.ebnimaam_orders o WHERE o.auth_user_id=$1 OR (o.auth_user_id IS NULL AND LOWER(o.customer_email)=LOWER($2)) ORDER BY o.created_at DESC",[user.id,user.email]);
  const profile=profileResult.rows[0]||{};const addresses=Array.isArray(profile.addresses)?profile.addresses:[];const preferences=profile.preferences||{};
  const hasSavedProfile=!!(profile.full_name||profile.phone||addresses.length||Object.keys(preferences).length);
  if(!hasSavedProfile&&!ordersResult.rows.length)return NextResponse.json({error:'You have no information yet.'},{status:404,headers:{'cache-control':'no-store'}});
  const lines=[
   '# Ebnimaam - Personal Information',
   'Generated: '+new Date().toLocaleString('en-NG',{timeZone:'Africa/Lagos'}),
   'This PDF contains the saved profile details and order information linked to your verified account.',
   ' ','## Account',
   'Name: '+String(profile.full_name||user.name||'Not saved'),
   'Email: '+user.email,
   'Phone: '+String(profile.phone||'Not saved'),
   'Profile created: '+String(profile.created_at||'Not available'),
   'Last profile update: '+String(profile.updated_at||'Not available'),
   ' ','## Saved addresses'
  ];
  if(addresses.length)addresses.forEach((address:any,index:number)=>lines.push((index+1)+'. '+JSON.stringify(address)));
  else lines.push('No saved delivery addresses.');
  lines.push(' ','## Saved preferences',JSON.stringify(preferences),' ','## Order history');
  if(ordersResult.rows.length)ordersResult.rows.forEach((order:any,index:number)=>lines.push((index+1)+'. '+JSON.stringify(order)));
  else lines.push('No orders are linked to this account yet.');
  const pdf=createTextPdf(lines);
  return new Response(new Uint8Array(pdf),{status:200,headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="ebnimaam-personal-information.pdf"','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff'}});
 }catch{return NextResponse.json({error:'Your information could not be downloaded right now. Please try again.'},{status:503,headers:{'cache-control':'no-store'}})}
}
