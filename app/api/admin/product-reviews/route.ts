import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { recordAdminActivity } from '../../../../lib/admin-audit';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const secret=process.env.ADMIN_PASSWORD||'';
async function ensureReportSchema(){
 await pool.query(`ALTER TABLE public.ebnimaam_product_reviews ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'published'`);
 await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_product_review_reports(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),review_id UUID NOT NULL REFERENCES public.ebnimaam_product_reviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(review_id,user_id))`);
}
export async function GET(req:Request){
 if(!isAdminRequest(req,secret))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  await ensureReportSchema();
  const result=await pool.query(`SELECT r.id AS review_id,r.product_id,p.name AS product_name,r.customer_name,r.rating,r.comment,r.moderation_status,r.created_at,
   COALESCE(json_agg(json_build_object('report_id',x.id,'user_id',x.user_id,'reason',x.reason,'status',x.status,'created_at',x.created_at) ORDER BY x.created_at DESC)
     FILTER(WHERE x.id IS NOT NULL),'[]'::json) AS reports
   FROM public.ebnimaam_product_reviews r JOIN public.ebnimaam_products p ON p.id=r.product_id
   LEFT JOIN public.ebnimaam_product_review_reports x ON x.review_id=r.id
   GROUP BY r.id,p.name
   HAVING COUNT(x.id)>0 OR r.moderation_status<>'published'
   ORDER BY COUNT(x.id) FILTER(WHERE x.status='open') DESC,r.created_at DESC LIMIT 300`);
  return NextResponse.json({reviews:result.rows},{headers:{'cache-control':'private,no-store,max-age=0'}});
 }catch{return NextResponse.json({error:'Review moderation queue is unavailable.'},{status:503});}
}
export async function PATCH(req:Request){
 if(!isAdminRequest(req,secret))return NextResponse.json({error:'Unauthorized'},{status:401});
 const body=await req.json().catch(()=>({}));
 const reviewId=String(body?.reviewId||'').trim(),moderation=String(body?.moderation||''),reportStatus=body?.reportStatus==null?null:String(body.reportStatus);
 if(!/^[0-9a-f-]{36}$/i.test(reviewId)||!['published','hidden','rejected'].includes(moderation))
  return NextResponse.json({error:'A review and moderation status are required.'},{status:400});
 if(reportStatus!==null&&!['reviewed','dismissed','open'].includes(reportStatus))
  return NextResponse.json({error:'Invalid report status.'},{status:400});
 try{
  await ensureReportSchema();
  const result=await pool.query('UPDATE public.ebnimaam_product_reviews SET moderation_status=$2 WHERE id=$1 RETURNING id',[reviewId,moderation]);
  if(!result.rowCount)return NextResponse.json({error:'Review not found.'},{status:404});
  if(reportStatus!==null)await pool.query('UPDATE public.ebnimaam_product_review_reports SET status=$2 WHERE review_id=$1',[reviewId,reportStatus]);
  await recordAdminActivity('product.review.moderated','product_review',reviewId,{moderation,reportStatus});
  return NextResponse.json({ok:true},{headers:{'cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Review moderation failed.'},{status:503});}
}
