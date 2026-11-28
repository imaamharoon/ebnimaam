import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const SESSION_COOKIE = 'ebnimaam_customer_session';
const DEVICE_COOKIE = 'ebnimaam_device';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

function signingSecret() {
  const value = process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET || process.env.NEON_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('Customer session signing is not configured.');
  return value;
}
function digest(value: string) {
  return createHmac('sha256', signingSecret()).update('ebnimaam-customer-session-v1:' + value).digest('hex');
}
function cookieValue(req: Request, name: string) {
  const prefix = name + '=';
  const item = (req.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ''; }
}
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function deviceLabel(req: Request) {
  const agent = req.headers.get('user-agent') || '';
  const platform = /Android/i.test(agent) ? 'Android' : /iPhone|iPad|iPod/i.test(agent) ? 'iPhone or iPad' : /Windows/i.test(agent) ? 'Windows' : /Mac OS/i.test(agent) ? 'Mac' : /Linux/i.test(agent) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//i.test(agent) ? 'Edge' : /Firefox\//i.test(agent) ? 'Firefox' : /Chrome\//i.test(agent) ? 'Chrome' : /Safari\//i.test(agent) ? 'Safari' : 'browser';
  return (platform + ' · ' + browser).slice(0, 100);
}
async function ensureSessionTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_sessions (
    user_id TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    device_label TEXT NOT NULL,
    user_email TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE public.ebnimaam_customer_sessions ADD COLUMN IF NOT EXISTS user_email TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE public.ebnimaam_customer_sessions ADD COLUMN IF NOT EXISTS user_name TEXT NOT NULL DEFAULT ''");
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_customer_sessions_hash_idx ON public.ebnimaam_customer_sessions(session_hash,device_hash)');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_known_devices (
    user_id TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    device_label TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id,device_hash)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_customer_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    event_type TEXT NOT NULL,
    device_label TEXT NOT NULL,
    notification_status TEXT NOT NULL DEFAULT 'not_configured',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
async function sendNewDeviceEmail(email: string, label: string) {
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASS || '';
  const from = process.env.EMAIL_FROM || smtpUser;
  const apiKey = process.env.RESEND_API_KEY || '';
  const safeLabel = label.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
  const subject = 'New sign-in to your Ebnimaam account';
  const text = 'New sign-in detected. Your Ebnimaam account was signed in from a new device: ' + label + '. If this was not you, reset your password immediately and contact Ebnimaam support.';
  const html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202a35"><h2 style="color:#102544">New sign-in detected</h2><p>Your Ebnimaam account was signed in from a new device:</p><p><strong>' + safeLabel + '</strong></p><p>If this was you, no action is needed. If you do not recognise this sign-in, reset your password immediately and contact Ebnimaam support.</p><p>Ebnimaam Security</p></div>';
  try {
    if (smtpUser && smtpPass) {
      const port = Number(process.env.SMTP_PORT || 465);
      if (port !== 465 && port !== 587) throw new Error('SMTP_PORT must be 465 (SSL) or 587 (STARTTLS).');
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: port === 465,
        requireTLS: port === 587,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        tls: { minVersion: 'TLSv1.2' },
      });
      let info: any;
      try {
        info = await transport.sendMail({ from, to: email, subject, html, text });
      } finally {
        transport.close();
      }
      const accepted = Array.isArray(info?.accepted) && info.accepted.some((entry: any) =>
        String(typeof entry === 'string' ? entry : entry?.address || '').trim().toLowerCase() === email.toLowerCase()
      );
      return accepted && typeof info?.messageId === 'string' && info.messageId ? 'sent' : 'failed';
    }
    if (!apiKey || !from) return 'not_configured';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject, html, text }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const payload: any = await response.json().catch(() => ({}));
    return response.ok && typeof payload?.id === 'string' && payload.id.length > 0 ? 'sent' : 'failed';
  } catch { return 'failed'; }
}

/** One active Ebnimaam application session is allowed per customer account. */
export async function activateCustomerSession(response: NextResponse, req: Request, user: { id: string; email: string; name?: string }) {
  await ensureSessionTables();
  let deviceId = cookieValue(req, DEVICE_COOKIE);
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(deviceId)) deviceId = randomBytes(32).toString('base64url');
  const label = deviceLabel(req);
  const deviceHash = digest(deviceId);
  const [knownDevice, anyKnownDevice] = await Promise.all([
    pool.query('SELECT 1 FROM public.ebnimaam_customer_known_devices WHERE user_id=$1 AND device_hash=$2', [user.id, deviceHash]),
    pool.query('SELECT 1 FROM public.ebnimaam_customer_known_devices WHERE user_id=$1 LIMIT 1', [user.id]),
  ]);
  const isNewDevice = !knownDevice.rowCount;
  await pool.query(
    `INSERT INTO public.ebnimaam_customer_known_devices(user_id,device_hash,device_label,first_seen_at,last_seen_at)
     VALUES($1,$2,$3,NOW(),NOW())
     ON CONFLICT(user_id,device_hash) DO UPDATE SET device_label=EXCLUDED.device_label,last_seen_at=NOW()`,
    [user.id, deviceHash, label],
  );
  // A browser/app installation must not keep two customer accounts signed in at once.
  await pool.query('DELETE FROM public.ebnimaam_customer_sessions WHERE device_hash=$1 AND user_id<>$2', [deviceHash, user.id]);
  const sessionToken = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO public.ebnimaam_customer_sessions(user_id,session_hash,device_hash,device_label,user_email,user_name,started_at,last_seen_at)
     VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
     ON CONFLICT(user_id) DO UPDATE SET session_hash=EXCLUDED.session_hash,device_hash=EXCLUDED.device_hash,
       device_label=EXCLUDED.device_label,user_email=EXCLUDED.user_email,user_name=EXCLUDED.user_name,
       started_at=NOW(),last_seen_at=NOW()`,
    [user.id, digest(sessionToken), deviceHash, label, user.email, String(user.name || '')],
  );
  const secure = new URL(req.url).protocol === 'https:';
  response.cookies.set(SESSION_COOKIE, sessionToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE });
  response.cookies.set(DEVICE_COOKIE, deviceId, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: DEVICE_MAX_AGE });
  if (isNewDevice) {
    const event = await pool.query(
      'INSERT INTO public.ebnimaam_customer_security_events(user_id,email,event_type,device_label,notification_status) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [user.id, user.email, anyKnownDevice.rowCount ? 'new_device' : 'first_sign_in', label, 'pending'],
    );
    const status = await sendNewDeviceEmail(user.email, label);
    await pool.query('UPDATE public.ebnimaam_customer_security_events SET notification_status=$2 WHERE id=$1', [event.rows[0].id, status]);
  }
}

export async function resolveCustomerSessionUser(req: Request): Promise<{id:string;email:string;name:string}|null> {
  try {
    const token = cookieValue(req, SESSION_COOKIE);
    const deviceId = cookieValue(req, DEVICE_COOKIE);
    if (!token || !deviceId) return null;
    await ensureSessionTables();
    const result = await pool.query(
      'SELECT user_id,user_email,user_name FROM public.ebnimaam_customer_sessions WHERE session_hash=$1 AND device_hash=$2 LIMIT 1',
      [digest(token), digest(deviceId)],
    );
    if (!result.rowCount || !String(result.rows[0].user_email || '').includes('@')) return null;
    return { id: String(result.rows[0].user_id), email: String(result.rows[0].user_email), name: String(result.rows[0].user_name || '') };
  } catch { return null; }
}

export async function hasCustomerSession(userId: string) {
  await ensureSessionTables();
  const result = await pool.query('SELECT 1 FROM public.ebnimaam_customer_sessions WHERE user_id=$1', [userId]);
  return Boolean(result.rowCount);
}

export async function isCurrentCustomerSession(req: Request, userId: string) {
  const token = cookieValue(req, SESSION_COOKIE);
  const deviceId = cookieValue(req, DEVICE_COOKIE);
  if (!token || !deviceId) return false;
  try {
    await ensureSessionTables();
    const result = await pool.query('SELECT session_hash,device_hash FROM public.ebnimaam_customer_sessions WHERE user_id=$1', [userId]);
    if (!result.rowCount) return false;
    return safeEqual(String(result.rows[0].session_hash), digest(token)) && safeEqual(String(result.rows[0].device_hash), digest(deviceId));
  } catch { return false; }
}

export async function revokeCustomerSession(req: Request, userId: string) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return;
  await ensureSessionTables();
  await pool.query('DELETE FROM public.ebnimaam_customer_sessions WHERE user_id=$1 AND session_hash=$2', [userId, digest(token)]);
}
export function clearCustomerSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  response.cookies.set(DEVICE_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}
