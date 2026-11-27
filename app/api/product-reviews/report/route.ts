import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getVerifiedCustomer } from '../../../../../lib/loyalty';
import { checkRateLimit } from '../../../../../lib/rate-limit';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
export async function POST(req:Request){
 const user=await getVerifiedCustomer(req);
 if(!user)return NextResponse.json({error:'Sign in with your verified account to report a review.'},{status:401});
 let allowed=false;
 try{allowed=await checkRateLimit(req,'product-review-report',6,60*60)}
 catch{return NextResponse.json({error:'Review reporting is temporarily unavailable.'},{status:503})}
 if(!allowed)return NextResponse.json({error:'Too many report attempts. Please try again later.'},{status:429,headers:{'retry-after':'3600'}});
 try{
  const body=await req.json().catch(()=>({}));
  const reviewId=String(body?.reviewId||'').trim();
  const reason=String(body?.reason||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(reviewId)||!['spam','abuse','false_information','privacy','other'].includes(reason))
    return NextResponse.json({error:'Choose a valid report reason.'},{status:400});
  const review=await pool.query(
   `SELECT r.id,r.product_id FROM public.ebnimaam_product_reviews r
    WHERE r.id=$1 AND r.moderation_status='published'`,
   [reviewId],
  );
  if(!review.rowCount)return NextResponse.json({error:'That review is no longer available.'},{status:404});
  const purchase=await pool.query(
   `SELECT 1 FROM public.ebnimaam_orders o
    WHERE o.status='paid' AND (o.auth_user_id=$1 OR (o.auth_user_id IS NULL AND LOWER(o.customer_email)=LOWER($2)))
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.items) line WHERE line->>'productId'=$3) LIMIT 1`,
   [user.id,user.email,review.rows[0].product_id],
  );
  if(!purchase.rowCount)return NextResponse.json({error:'A verified paid purchase of this item is required to report its review.'},{status:403});
  await pool.query(
   `INSERT INTO public.ebnimaam_product_review_reports(review_id,user_id,reason,status)
    VALUES($1,$2,$3,'open')
    ON CONFLICT(review_id,user_id) DO UPDATE SET reason=EXCLUDED.reason,status='open',created_at=NOW()`,
   [reviewId,user.id,reason],
  );
  return NextResponse.json({ok:true},{headers:{'cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Your report could not be saved.'},{status:503});}
}
