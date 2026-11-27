import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { recordAdminActivity } from '../../../../lib/admin-audit';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
const secret=process.env.ADMIN_PASSWORD||'';
async function ensureQuestionSchema(){
 await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_product_questions(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),product_id TEXT NOT NULL REFERENCES public.ebnimaam_products(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,customer_name TEXT NOT NULL,question TEXT NOT NULL,answer TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')),
 answered_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
export async function GET(req:Request){
 if(!isAdminRequest(req,secret))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  await ensureQuestionSchema();
  const result=await pool.query(`SELECT q.id,q.product_id,p.name AS product_name,q.user_id,q.customer_name,q.question,q.answer,q.status,q.created_at,q.updated_at
   FROM public.ebnimaam_product_questions q JOIN public.ebnimaam_products p ON p.id=q.product_id
   ORDER BY CASE WHEN q.status='pending' THEN 0 WHEN q.status='published' THEN 1 ELSE 2 END,q.created_at DESC LIMIT 300`);
  return NextResponse.json({questions:result.rows},{headers:{'cache-control':'private,no-store,max-age=0'}});
 }catch{return NextResponse.json({error:'Product questions are unavailable.'},{status:503});}
}
export async function PATCH(req:Request){
 if(!isAdminRequest(req,secret))return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=await req.json().catch(()=>({}));
 const id=String(body?.id||'').trim();
 const status=String(body?.status||'');
 const answer=String(body?.answer||'').replace(/\u0000/g,'').trim();
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['published','rejected'].includes(status))return NextResponse.json({error:'A valid question and moderation status are required.'},{status:400});
 if(status==='published'&&(answer.length<3||answer.length>1600))return NextResponse.json({error:'Publish a helpful answer between 3 and 1,600 characters.'},{status:400});
 try{
  await ensureQuestionSchema();
  const result=await pool.query(
   'UPDATE public.ebnimaam_product_questions SET status=$2,answer=$3,answered_at=CASE WHEN $2=\'published\' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1 RETURNING id',
   [id,status,status==='published'?answer:null]);
  if(!result.rowCount)return NextResponse.json({error:'Product question not found.'},{status:404});
  await recordAdminActivity('product.question.moderated','product_question',id,{status});
  return NextResponse.json({ok:true},{headers:{'cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Product question moderation failed.'},{status:503});}
}
