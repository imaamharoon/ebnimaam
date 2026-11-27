import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getVerifiedCustomer } from '../../../lib/loyalty';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function ensureQuestionSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_product_questions(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id TEXT NOT NULL REFERENCES public.ebnimaam_products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')),
    answered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_product_questions_public_idx ON public.ebnimaam_product_questions(product_id,status,created_at DESC)');
}
export async function GET(req: Request) {
  try {
    await ensureQuestionSchema();
    const productId=String(new URL(req.url).searchParams.get('productId')||'').trim().slice(0,120);
    if(!productId) return NextResponse.json({error:'Product ID is required.'},{status:400});
    const result=await pool.query(
      `SELECT id,customer_name,question,answer,answered_at,created_at
       FROM public.ebnimaam_product_questions WHERE product_id=$1 AND status='published'
       ORDER BY created_at DESC LIMIT 100`,
      [productId],
    );
    return NextResponse.json({questions:result.rows},{headers:{'cache-control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Product questions are temporarily unavailable.'},{status:503,headers:{'cache-control':'no-store'}});
  }
}
export async function POST(req: Request) {
  let allowed=false;
  try { allowed=await checkRateLimit(req,'product-question-submit',8,15*60); }
  catch { return NextResponse.json({error:'Product questions are temporarily unavailable.'},{status:503}); }
  if(!allowed) return NextResponse.json({error:'Too many questions. Please wait before sending another.'},{status:429,headers:{'retry-after':'900'}});
  const user=await getVerifiedCustomer(req);
  if(!user) return NextResponse.json({error:'Sign in with your verified account to ask a product question.'},{status:401});
  try {
    await ensureQuestionSchema();
    const body=await req.json().catch(()=>({}));
    const productId=String(body?.productId||'').trim().slice(0,120);
    const question=String(body?.question||'').replace(/\u0000/g,'').trim();
    if(!productId||question.length<8||question.length>1200) return NextResponse.json({error:'Choose a product and enter a question between 8 and 1,200 characters.'},{status:400});
    const product=await pool.query('SELECT id FROM public.ebnimaam_products WHERE id=$1 AND is_active=TRUE AND stock>0',[productId]);
    if(!product.rowCount) return NextResponse.json({error:'That product is not currently available for questions.'},{status:404});
    const name=String(user.name||'Ebnimaam customer').trim().slice(0,80);
    const result=await pool.query(
      "INSERT INTO public.ebnimaam_product_questions(product_id,user_id,customer_name,question,status) VALUES($1,$2,$3,$4,'pending') RETURNING id,created_at",
      [productId,user.id,name,question],
    );
    return NextResponse.json({ok:true,question:{id:result.rows[0].id,created_at:result.rows[0].created_at},moderation:'pending'},{status:201,headers:{'cache-control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Your question could not be saved.'},{status:503});
  }
}
