import { NextResponse } from 'next/server';
import { Pool } from 'pg';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
export async function GET(req:Request){
 try{
  const url=new URL(req.url);const productId=String(url.searchParams.get('productId')||'').slice(0,120);
  const current=productId?await pool.query('SELECT id,category FROM public.ebnimaam_products WHERE id=$1 AND is_active=TRUE',[productId]):{rows:[]};
  const category=current.rows[0]?.category||'';
  const result=await pool.query(
   `SELECT id,name,category,price,image,tag,stock,description
    FROM public.ebnimaam_products
    WHERE is_active=TRUE AND stock>0 AND ($1='' OR id<>$1)
    ORDER BY CASE WHEN category=$2 AND $2<>'' THEN 0 ELSE 1 END,updated_at DESC
    LIMIT 8`,[productId,category]);
  return NextResponse.json({products:result.rows},{headers:{'cache-control':'public, max-age=60, stale-while-revalidate=120'}});
 }catch{return NextResponse.json({error:'Recommendations are temporarily unavailable.',products:[]},{status:503})}
}
