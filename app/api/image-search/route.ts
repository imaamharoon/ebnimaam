import { NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(req:Request){
 try{
  let allowed=false;
  try{allowed=await checkRateLimit(req,'customer-image-search',8,15*60)}catch{return NextResponse.json({error:'Photo search is temporarily unavailable.'},{status:503})}
  if(!allowed)return NextResponse.json({error:'Too many photo searches. Please try again later.'},{status:429});
  if(!process.env.GEMINI_API_KEY)return NextResponse.json({error:'Photo search is not configured yet. You can still search by typing or using voice.'},{status:503});
  const body=await req.json().catch(()=>({}));
  const image=String(body.image||'');
  const match=image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!match||match[2].length>4_300_000)return NextResponse.json({error:'Choose a JPG, PNG or WebP image under 3 MB.'},{status:400});
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key='+encodeURIComponent(process.env.GEMINI_API_KEY),{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
    contents:[{role:'user',parts:[
     {text:'You are helping a customer search the Ebnimaam fashion and accessories catalogue. Inspect this image and return only a short plain-text search query of up to 8 words describing the visible product type, colour, pattern or style. Do not identify a person, infer personal traits, mention brands unless clearly shown on the item, or claim the exact item exists in the shop. If this is not a product image, return the best visible item keywords.'},
     {inline_data:{mime_type:match[1],data:match[2]}}
    ]}],
    generationConfig:{maxOutputTokens:40}
   }),
   cache:'no-store',signal:AbortSignal.timeout(12000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)return NextResponse.json({error:'Photo search could not analyse that image. Please try another photo.'},{status:502});
  const query=String(data?.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/[\r\n"'<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
  if(!query)return NextResponse.json({error:'No product keywords were found. Try a clearer photo.'},{status:422});
  return NextResponse.json({query},{headers:{'cache-control':'no-store'}});
 }catch{return NextResponse.json({error:'Photo search failed. Please try again.'},{status:503})}
}
