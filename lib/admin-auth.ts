import { createHmac, timingSafeEqual } from 'crypto';

const SESSION_SECONDS = 12 * 60 * 60;
function signature(expiresAt: number, secret: string) {
  return createHmac('sha256', secret).update('ebnimaam-admin-session:' + expiresAt).digest('hex');
}
export function createAdminSession(secret: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return expiresAt + '.' + signature(expiresAt, secret);
}
export function isAdminRequest(req: Request, secret = process.env.ADMIN_PASSWORD || '') {
  if (!secret) return false;
  const match = (req.headers.get('cookie') || '').match(/(?:^|;\s*)ebn_admin=([^;]+)/);
  if (!match) return false;
  let decoded = '';
  try { decoded = decodeURIComponent(match[1]); } catch { return false; }
  const [expiresPart, suppliedPart] = decoded.split('.');
  const expiresAt = Number(expiresPart);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_SECONDS) return false;
  if (!suppliedPart) return false;
  const expected = Buffer.from(signature(expiresAt, secret));
  const supplied = Buffer.from(suppliedPart);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export const ADMIN_SESSION_MAX_AGE = SESSION_SECONDS;
