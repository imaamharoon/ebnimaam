import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { createTextPdf } from '../../../../lib/pdf';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:8});
async function tableRows(table:string){
 const allowed=new Set(['ebnimaam_orders','ebnimaam_customer_profiles','ebnimaam_products','ebnimaam_news','ebnimaam_store_settings','ebnimaam_order_status_history','ebnimaam_payment_events']);
 if(!allowed.has(table))throw new Error('Unsupported export table.');
 const exists=await pool.query('SELECT to_regclass($1) AS table_name',['public.'+table]);if(!exists.rows[0]?.table_name)return [];
 const result=await pool.query('SELECT * FROM public.'+table);return result.rows;
}
function safeExport(value:any,key=''):any{
 if(/(password|secret|token|cookie|authorization|api[_-]?key|nonce|challenge|rate_key|ip_address)/i.test(key))return undefined;
 if(Array.isArray(value))return value.map(item=>safeExport(item)).filter(item=>item!==undefined);
 if(value&&typeof value==='object'){const result:Record<string,any>={};for(const [childKey,childValue] of Object.entries(value)){const cleaned=safeExport(childValue,childKey);if(cleaned!==undefined)result[childKey]=cleaned}return result}
 if(typeof value==='string'&&/^data:image\//i.test(value))return '[uploaded image file not embedded in PDF]';
 return value;
}
function addRecords(lines:string[],title:string,rows:any[]){lines.push(' ','## '+title,'Records: '+rows.length);if(!rows.length){lines.push('No records currently stored.');return}rows.forEach((row,index)=>lines.push((index+1)+'. '+JSON.stringify(safeExport(row))))}
export async function GET(req:Request){
 if(!isAdminRequest(req))return NextResponse.json({error:'Administrator sign-in is required to download this report.'},{status:401});
 try{
  const [orders,profiles,products,news,settings,statusHistory,paymentEvents]=await Promise.all([
   tableRows('ebnimaam_orders'),tableRows('ebnimaam_customer_profiles'),tableRows('ebnimaam_products'),tableRows('ebnimaam_news'),tableRows('ebnimaam_store_settings'),tableRows('ebnimaam_order_status_history'),tableRows('ebnimaam_payment_events')
  ]);
  const lines=[
   '# Ebnimaam - Full Website Data Export',
   'Generated: '+new Date().toLocaleString('en-NG',{timeZone:'Africa/Lagos'}),
   'This report contains application-owned records available in the Ebnimaam database.',
   'Passwords, credentials, session cookies, security tokens, rate-limit keys and uploaded image binaries are excluded.',
   'Authentication-provider internal records are managed separately and are not part of this application database export.',
   ' ','## Dataset summary','Orders: '+orders.length,'Customer profiles: '+profiles.length,'Products: '+products.length,'News and announcements: '+news.length,'Store settings: '+settings.length,'Order status history: '+statusHistory.length,'Payment reconciliation events: '+paymentEvents.length
  ];
  addRecords(lines,'Customer profiles',profiles);
  addRecords(lines,'Orders and checkout information',orders);
  addRecords(lines,'Order status history',statusHistory);
  addRecords(lines,'Product catalogue and inventory',products);
  addRecords(lines,'News and announcements',news);
  addRecords(lines,'Store settings and social profiles',settings);
  addRecords(lines,'Payment reconciliation events',paymentEvents);
  const pdf=createTextPdf(lines);
  return new Response(new Uint8Array(pdf),{status:200,headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="ebnimaam-website-information.pdf"','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff'}});
 }catch{return NextResponse.json({error:'The full website report could not be generated. Please try again.'},{status:503,headers:{'cache-control':'no-store'}})}
}
