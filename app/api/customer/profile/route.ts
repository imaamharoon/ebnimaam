import {NextResponse} from 'next/server';
import {Pool} from 'pg';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const authBase=(process.env.NEON_AUTH_BASE_URL||'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/,'');
async function customer(req:Request){
  const cookie=req.headers.get('cookie')||'';
  if(!cookie)return null;
  const response=await fetch(authBase+'/get-session',{headers:{cookie,origin:'https://ebnimaam.vercel.app'},cache:'no-store'});
  if(!response.ok)return null;
  const data=await response.json();
  const user=data?.user;
  if(!user?.id||!user?.email)return null;
  return user as {id:string,email:string,name?:string};
}
async function init(){
  await pool.query("CREATE TABLE IF NOT EXISTS ebnimaam_customer_profiles (user_id TEXT PRIMARY KEY,email TEXT NOT NULL,full_name TEXT,phone TEXT,addresses JSONB NOT NULL DEFAULT '[]'::jsonb,preferences JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}
export async function GET(req:Request){
  try{
    const user=await customer(req);
    if(!user)return NextResponse.json({error:'Please sign in to view your saved details.'},{status:401});
    await init();
    const result=await pool.query('SELECT full_name,phone,addresses,preferences,updated_at FROM ebnimaam_customer_profiles WHERE user_id=$1',[user.id]);
    const profile=result.rows[0]||{full_name:user.name||'',phone:'',addresses:[],preferences:{}};
    const orders=await pool.query('SELECT reference,amount_kobo,status,fulfilment_status,items,created_at,paid_at FROM ebnimaam_orders WHERE LOWER(customer_email)=LOWER($1) ORDER BY created_at DESC LIMIT 100',[user.email]);
    return NextResponse.json({profile:{...profile,email:user.email},orders:orders.rows});
  }catch{return NextResponse.json({error:'Could not load your saved details.'},{status:500})}
}
export async function PUT(req:Request){
  try{
    const user=await customer(req);
    if(!user)return NextResponse.json({error:'Please sign in before saving your details.'},{status:401});
    const body=await req.json();
    const fullName=String(body.full_name||'').trim().slice(0,120);
    const phone=String(body.phone||'').trim().slice(0,40);
    const addresses=Array.isArray(body.addresses)?body.addresses.slice(0,5).map((a:any)=>({label:String(a.label||'Home').slice(0,30),recipient:String(a.recipient||fullName).slice(0,120),phone:String(a.phone||phone).slice(0,40),line1:String(a.line1||'').slice(0,240),line2:String(a.line2||'').slice(0,240),city:String(a.city||'').slice(0,100),state:String(a.state||'').slice(0,100),country:String(a.country||'Nigeria').slice(0,80)})):[];
    if(!fullName)return NextResponse.json({error:'Please enter your full name.'},{status:400});
    if(addresses.some((a:any)=>!a.line1||!a.city||!a.state))return NextResponse.json({error:'Each saved address needs a street address, city and state.'},{status:400});
    await init();
    await pool.query('INSERT INTO ebnimaam_customer_profiles(user_id,email,full_name,phone,addresses) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,addresses=EXCLUDED.addresses,updated_at=NOW()',[user.id,user.email,fullName,phone,JSON.stringify(addresses)]);
    return NextResponse.json({ok:true});
  }catch{return NextResponse.json({error:'Could not save your details. Please try again.'},{status:500})}
}
