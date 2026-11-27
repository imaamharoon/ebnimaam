import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getVerifiedCustomer } from '../../../lib/loyalty';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_wishlist(
 user_id TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES public.ebnimaam_products(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,product_id))`)}
export async function GET(req:Request){
 try{
  const user=await getVerifiedCustomer(req);if(!user)return NextResponse.json({error:'Sign in to sync your saved products.'},{status:401});
  await init();
  const result=await pool.query('SELECT product_id FROM public.ebnimaam_wishlist WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[user.id]);
  return NextResponse.json({productIds:result.rows.map(row=>String(row.product_id))},{headers:{'cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Saved products are temporarily unavailable.'},{status:503})}
}
export async function PUT(req:Request){
 const user=await getVerifiedCustomer(req);if(!user)return NextResponse.json({error:'Sign in to sync your saved products.'},{status:401});
 let allowed=false;try{allowed=await checkRateLimit(req,'wishlist-sync',60,15*60)}catch{return NextResponse.json({error:'Saved products are temporarily unavailable.'},{status:503})}
 if(!allowed)return NextResponse.json({error:'Too many wishlist updates. Try again later.'},{status:429});
 try{
  await init();const body=await req.json();const input=Array.isArray(body.productIds)?body.productIds:[];
  if(input.length>200)return NextResponse.json({error:'You can save up to 200 products.'},{status:400});
  const normalizedIds=input.map((value:any)=>String(value||'').trim());
  const ids=normalizedIds.filter((value:string,index:number,list:string[])=>value.length>0&&value.length<=120&&list.indexOf(value)===index);
  if(ids.length){
   const valid=await pool.query('SELECT id FROM public.ebnimaam_products WHERE id=ANY($1::text[])',[ids]);
   if(valid.rowCount!==ids.length)return NextResponse.json({error:'One or more saved products could not be found.'},{status:400});
  }
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('DELETE FROM public.ebnimaam_wishlist WHERE user_id=$1',[user.id]);
   for(const id of ids)await client.query('INSERT INTO public.ebnimaam_wishlist(user_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,id]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
  return NextResponse.json({ok:true,count:ids.length});
 }catch{return NextResponse.json({error:'Saved products could not be updated.'},{status:503})}
}
