import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { checkRateLimit } from '../../../../lib/rate-limit';
export const runtime = 'nodejs';
const base = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');
const secret = () => process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET || process.env.NEON_AUTH_SECRET;
const sign = (value: string, key: string) => createHmac('sha256', key).update(value).digest('base64url');
function verifyChallenge(token: string, answer: string, key: string) {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = sign(payload, key);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Number(data.exp) > Date.now() && String(data.code).toUpperCase() === answer.trim().toUpperCase();
  } catch { return false; }
}
async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const url = new URL(req.url);
  const { path = [] } = await ctx.params;
  const endpoint = path.join('/');
  const signup = req.method === 'POST' && endpoint === 'sign-up/email';
  const signin = req.method === 'POST' && endpoint === 'sign-in/email';
  const otpSend = req.method === 'POST' && endpoint === 'email-otp/send-verification-otp';
  const otpVerify = req.method === 'POST' && endpoint === 'email-otp/verify-email';
  if (signup || signin || otpSend || otpVerify) {
    try {
      const scope = signup ? 'auth-signup' : signin ? 'auth-signin' : otpSend ? 'email-otp-send' : 'email-otp-verify';
      const limit = signup ? 5 : signin ? 20 : otpSend ? 5 : 10;
      const allowed = await checkRateLimit(req, scope, limit, 15 * 60);
      if (!allowed) return NextResponse.json({ error: 'Too many attempts. Please wait 15 minutes before trying again.' }, { status: 429, headers: { 'retry-after': '900' } });
    } catch {
      return NextResponse.json({ error: 'Authentication is temporarily unavailable. Please try again shortly.' }, { status: 503 });
    }
  }

  let body: BodyInit | undefined;
  if (!['GET', 'HEAD'].includes(req.method)) body = await req.arrayBuffer();
  if (signup) {
    const key = secret();
    const token = req.headers.get('cookie')?.split(';').map((value) => value.trim())
      .find((value) => value.startsWith('ebnimaam_signup_challenge='))?.split('=').slice(1).join('=');
    let answer = '';
    try {
      const parsed = JSON.parse(Buffer.from(body as ArrayBuffer).toString());
      answer = String(parsed.challengeAnswer || '');
      delete parsed.challengeAnswer;
      body = Buffer.from(JSON.stringify(parsed));
    } catch { return NextResponse.json({ error: 'Please complete the human verification challenge.' }, { status: 400 }); }
    if (!key || !token || !verifyChallenge(decodeURIComponent(token), answer, key)) {
      const failed = NextResponse.json({ error: 'Human verification failed or expired. Refresh the challenge and try again.' }, { status: 400 });
      failed.cookies.set('ebnimaam_signup_challenge', '', { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'strict', path: '/api/auth/sign-up/email', maxAge: 0 });
      return failed;
    }
  }

  const target = base + '/' + path.map(encodeURIComponent).join('/') + url.search;
  const headers = new Headers();
  for (const header of ['content-type', 'cookie', 'accept', 'user-agent']) {
    const value = req.headers.get(header);
    if (value) headers.set(header, value);
  }
  headers.set('origin', url.origin);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const init: RequestInit = { method: req.method, headers, redirect: 'manual', cache: 'no-store' };
  if (body !== undefined) init.body = body;

  try {
    const upstream = await fetch(target, init);
    const response = new NextResponse(upstream.body, { status: upstream.status });
    for (const header of ['content-type', 'location', 'cache-control']) {
      const value = upstream.headers.get(header);
      if (value) response.headers.set(header, value);
    }
    const cookies = (upstream.headers as any).getSetCookie?.() || [];
    if (cookies.length) {
      for (const cookie of cookies) {
        const local = cookie.replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*Path=[^;]*/ig, '; Path=/');
        response.headers.append('set-cookie', local);
      }
    } else {
      const cookie = upstream.headers.get('set-cookie');
      if (cookie) response.headers.append('set-cookie', cookie.replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*Path=[^;]*/ig, '; Path=/'));
    }
    if (signup) response.cookies.set('ebnimaam_signup_challenge', '', {
      httpOnly: true, secure: url.protocol === 'https:', sameSite: 'strict',
      path: '/api/auth/sign-up/email', maxAge: 0,
    });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch {
    const failed = NextResponse.json({ error: 'Authentication service is temporarily unavailable.' }, { status: 502 });
    if (signup) failed.cookies.set('ebnimaam_signup_challenge', '', { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'strict', path: '/api/auth/sign-up/email', maxAge: 0 });
    return failed;
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
