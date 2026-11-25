import {NextResponse} from 'next/server';
import {randomBytes,createHmac} from 'crypto';
const secret=()=>process.env.AUTH_SECRET||process.env.BETTER_AUTH_SECRET||process.env.NEON_AUTH_SECRET;
const sign=(v:string,s:string)=>createHmac('sha256',s).update(v).digest('base64url');
export async function GET(){
 const s=secret();if(!s)return NextResponse.json({error:'Signup verification is temporarily unavailable.'},{status:503});
 const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 const pick=(n:number)=>Array.from({length:n},()=>chars[randomBytes(1)[0]%chars.length]).join('');
 const code=pick(3)+'-'+pick(4),payload=Buffer.from(JSON.stringify({code,exp:Date.now()+5*60*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
 const token=payload+'.'+sign(payload,s);
 const res=NextResponse.json({challenge:code,expiresIn:300},{headers:{'cache-control':'no-store'}});
 res.cookies.set('ebnimaam_signup_challenge',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/auth/sign-up/email',maxAge:300});
 return res;
}