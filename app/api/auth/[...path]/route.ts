import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { checkRateLimit, consumeOneTimeChallenge } from '../../../../lib/rate-limit';
import { activateCustomerSession, clearCustomerSessionCookies, hasCustomerSession, isCurrentCustomerSession, resolveCustomerSessionUser, revokeCustomerSession } from '../../../../lib/customer-sessions';
export const runtime = 'nodejs';
const base = (process.env.NEON_AUTH_BASE_URL || 'https://ep-cool-frost-bgh6nunl.neonauth.c-9.eu-central-1.aws.neon.tech/ebnimaam/auth').replace(/\/$/, '');
const secret = () => process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET || process.env.NEON_AUTH_SECRET;
const sign = (value: string, key: string) => createHmac('sha256', key).update(value).digest('base64url');
function verifyChallenge(token: string, answer: string, key: string): string | null {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = sign(payload, key);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const nonce = String(data.nonce || '');
    if (Number(data.exp) <= Date.now() || String(data.code).toUpperCase() !== answer.trim().toUpperCase()) return null;
    return /^[a-f0-9]{32}$/i.test(nonce) ? nonce : null;
  } catch { return null; }
}
async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const url = new URL(req.url);
  const { path = [] } = await ctx.params;
  const endpoint = path.join('/');
  const signup = req.method === 'POST' && endpoint === 'sign-up/email';
  const signin = req.method === 'POST' && endpoint === 'sign-in/email';
  const otpSend = req.method === 'POST' && endpoint === 'email-otp/send-verification-otp';
  const otpVerify = req.method === 'POST' && endpoint === 'email-otp/verify-email';
  const passwordResetRequest = req.method === 'POST' && endpoint === 'request-password-reset';
  const passwordReset = req.method === 'POST' && endpoint === 'reset-password';
  if (signup || signin || otpSend || otpVerify || passwordResetRequest || passwordReset) {
    try {
      const scope = signup ? 'auth-signup' : signin ? 'auth-signin' : otpSend ? 'email-otp-send' : otpVerify ? 'email-otp-verify' : passwordResetRequest ? 'auth-password-reset-request' : 'auth-password-reset';
      const limit = signup ? 5 : signin ? 20 : otpSend ? 5 : otpVerify ? 10 : passwordResetRequest ? 5 : 10;
      const windowSeconds = signup ? 2 * 60 : 15 * 60;
      const allowed = await checkRateLimit(req, scope, limit, windowSeconds);
      if (!allowed) {
        const message = signup ? 'Too many account creation attempts. Please wait 2 minutes before trying again.' : 'Too many attempts. Please wait 15 minutes before trying again.';
        return NextResponse.json({ error: message }, { status: 429, headers: { 'retry-after': String(windowSeconds) } });
      }
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
    const nonce = key && token ? verifyChallenge(decodeURIComponent(token), answer, key) : null;
    if (!nonce) {
      const failed = NextResponse.json({ error: 'Human verification failed or expired. Refresh the challenge and try again.' }, { status: 400 });
      failed.cookies.set('ebnimaam_signup_challenge', '', { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'strict', path: '/api/auth/sign-up/email', maxAge: 0 });
      return failed;
    }
    try {
      if (!(await consumeOneTimeChallenge(nonce))) {
        const failed = NextResponse.json({ error: 'This verification challenge has already been used. Refresh the code and try again.' }, { status: 400 });
        failed.cookies.set('ebnimaam_signup_challenge', '', { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'strict', path: '/api/auth/sign-up/email', maxAge: 0 });
        return failed;
      }
    } catch {
      const failed = NextResponse.json({ error: 'Signup verification is temporarily unavailable. Please refresh the code and try again.' }, { status: 503 });
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
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const init: RequestInit = { method: req.method, headers, redirect: 'manual', cache: 'no-store' };
  if (body !== undefined) init.body = body;

  try {
    const signingOut = req.method === 'POST' && endpoint === 'sign-out';
    let previousUser: any = null;
    if (signingOut) {
      try {
        const current = await fetch(base + '/get-session', { headers: { cookie: req.headers.get('cookie') || '', origin: url.origin }, cache: 'no-store' });
        if (current.ok) previousUser = (await current.json())?.user || null;
      } catch { /* Upstream sign-out still proceeds. */ }
      if (!previousUser) previousUser = await resolveCustomerSessionUser(req);
    }
    const upstream = await fetch(target, init);
    const upstreamPayload = upstream.clone();
    const upstreamCookies = (upstream.headers as any).getSetCookie?.() || (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
    const response = new NextResponse(upstream.body, { status: upstream.status });
    for (const header of ['content-type', 'location', 'cache-control']) {
      const value = upstream.headers.get(header);
      if (value) response.headers.set(header, value);
    }
    const mergedCookieHeader = () => {
      const jar = new Map<string, string>();
      for (const part of (req.headers.get('cookie') || '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0) jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
      }
      for (const cookie of upstreamCookies) {
        const value = String(cookie);
        const first = value.split(';', 1)[0];
        const index = first.indexOf('=');
        if (index <= 0) continue;
        const name = first.slice(0, index).trim();
        if (/;\s*Max-Age=0(?:;|$)/i.test(value)) jar.delete(name);
        else jar.set(name, first.slice(index + 1).trim());
      }
      return Array.from(jar.entries()).map(([name, value]) => name + '=' + value).join('; ');
    };
    const fetchSignedInUser = async () => {
      try {
        const payload = await upstreamPayload.clone().json();
        if (payload?.user?.id && payload?.user?.email) return payload.user;
      } catch { /* The provider may return an empty response. */ }
      const cookie = mergedCookieHeader();
      if (!cookie) return null;
      try {
        const current = await fetch(base + '/get-session', { headers: { cookie, origin: url.origin }, cache: 'no-store' });
        if (!current.ok) return null;
        const payload = await current.json();
        return payload?.user?.id && payload?.user?.email ? payload.user : null;
      } catch { return null; }
    };
    const loginSucceeded = (upstream.ok || (upstream.status >= 300 && upstream.status < 400)) && (
      (req.method === 'POST' && (signin || otpVerify)) ||
      (req.method === 'GET' && path[0] === 'callback')
    );
    if (loginSucceeded) {
      const user = await fetchSignedInUser();
      if (user?.emailVerified === true) {
        try {
          await activateCustomerSession(response, req, { id: String(user.id), email: String(user.email) });
        } catch {
          return NextResponse.json({ error: 'Secure sign-in setup is temporarily unavailable. Please try again shortly.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
        }
      }
    }
    if (req.method === 'GET' && endpoint === 'get-session' && upstream.ok) {
      const providerUser = await fetchSignedInUser();
      if (!providerUser?.id || !providerUser?.email || providerUser.emailVerified !== true) {
        const localUser = await resolveCustomerSessionUser(req);
        if (localUser && await isCurrentCustomerSession(req, localUser.id)) {
          return NextResponse.json({
            user: { id: localUser.id, email: localUser.email, name: localUser.name || '', emailVerified: true },
            session: { userId: localUser.id, expiresAt: null, activeDeviceOnly: true },
          }, { headers: { 'cache-control': 'no-store' } });
        }
      }
      const user = providerUser;
      if (user?.id && user?.email && user.emailVerified === true) {
        try {
          if (await hasCustomerSession(String(user.id))) {
            if (!(await isCurrentCustomerSession(req, String(user.id)))) {
              const denied = NextResponse.json({ user: null, session: null }, { headers: { 'cache-control': 'no-store' } });
              clearCustomerSessionCookies(denied);
              return denied;
            }
          } else {
            await activateCustomerSession(response, req, { id: String(user.id), email: String(user.email) });
          }
        } catch {
          return NextResponse.json({ user: null, session: null }, { headers: { 'cache-control': 'no-store' } });
        }
      }
    }
    if (signingOut) {
      if (previousUser?.id) await revokeCustomerSession(req, String(previousUser.id)).catch(() => {});
      clearCustomerSessionCookies(response);
    }
    for (const cookie of upstreamCookies) {
      const local = String(cookie).replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*Path=[^;]*/ig, '; Path=/');
      response.headers.append('set-cookie', local);
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
