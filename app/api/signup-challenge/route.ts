import { NextResponse } from 'next/server';
import { randomBytes, randomInt, createHmac } from 'crypto';
import { checkRateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
const secret = () => process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET || process.env.NEON_AUTH_SECRET;
const sign = (value: string, key: string) => createHmac('sha256', key).update(value).digest('base64url');
export async function GET(req: Request) {
  try {
    const allowed = await checkRateLimit(req, 'signup-challenge', 12, 15 * 60);
    if (!allowed) return NextResponse.json({ error: 'Too many challenge requests. Please wait 15 minutes and try again.' }, { status: 429, headers: { 'retry-after': '900', 'cache-control': 'no-store' } });
    const key = secret();
    if (!key) return NextResponse.json({ error: 'Signup verification is temporarily unavailable.' }, { status: 503 });
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const pick = (count: number) => Array.from({ length: count }, () => characters[randomInt(characters.length)]).join('');
    const code = pick(3) + '-' + pick(4);
    const payload = Buffer.from(JSON.stringify({ code, exp: Date.now() + 5 * 60 * 1000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
    const token = payload + '.' + sign(payload, key);
    const response = NextResponse.json({ challenge: code, expiresIn: 300 }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.set('ebnimaam_signup_challenge', token, {
      httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'strict',
      path: '/api/auth/sign-up/email', maxAge: 300,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Signup verification is temporarily unavailable.' }, { status: 503 });
  }
}
