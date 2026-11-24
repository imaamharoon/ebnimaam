import {NextResponse} from 'next/server';

const base=process.env.NEON_AUTH_BASE_URL||'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth';

async function proxy(req:Request,ctx:{params:Promise<{path:string[]}>}){
  const url=new URL(req.url);
  const {path=[]}=await ctx.params;
  const target=base.replace(/\/$/,'')+'/'+path.map(encodeURIComponent).join('/')+url.search;
  const headers=new Headers();
  for(const key of ['content-type','cookie','accept','user-agent']){const value=req.headers.get(key);if(value)headers.set(key,value)}
  headers.set('origin',url.origin);
  headers.set('x-forwarded-host',url.host);
  headers.set('x-forwarded-proto',url.protocol.replace(':',''));
  const init:RequestInit={method:req.method,headers,redirect:'manual'};
  if(!['GET','HEAD'].includes(req.method))init.body=await req.arrayBuffer();
  try{
    const upstream=await fetch(target,init);
    const out=new NextResponse(upstream.body,{status:upstream.status});
    for(const key of ['content-type','location','cache-control']){const value=upstream.headers.get(key);if(value)out.headers.set(key,value)}
    const cookies=(upstream.headers as any).getSetCookie?.()||[];
    for(const cookie of cookies){const local=cookie.replace(/;\s*Domain=[^;]*/ig,'').replace(/;\s*Path=[^;]*/ig,'; Path=/');out.headers.append('set-cookie',local)}
    out.headers.set('cache-control','no-store');
    return out;
  }catch{return NextResponse.json({error:'Authentication service is temporarily unavailable.'},{status:502})}
}
export const GET=proxy;export const POST=proxy;export const PUT=proxy;export const PATCH=proxy;export const DELETE=proxy;