import { createHash } from 'crypto';
import { Pool } from 'pg';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
export async function checkRateLimit(req: Request, scope: string, limit: number, windowSeconds: number) {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const ip = forwarded.split(',')[0].trim().slice(0, 120) || 'unknown';
  const secret = process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET || process.env.NEON_AUTH_SECRET || 'ebnimaam-rate-limit';
  const rateKey = createHash('sha256').update(secret + ':' + scope + ':' + ip).digest('hex');
  const result = await pool.query(
    `INSERT INTO public.ebnimaam_rate_limits(rate_key,hits,window_started_at,updated_at)
     VALUES($1,1,NOW(),NOW())
     ON CONFLICT(rate_key) DO UPDATE SET
       hits=CASE WHEN public.ebnimaam_rate_limits.window_started_at < NOW()-($2 * INTERVAL '1 second')
         THEN 1 ELSE public.ebnimaam_rate_limits.hits+1 END,
       window_started_at=CASE WHEN public.ebnimaam_rate_limits.window_started_at < NOW()-($2 * INTERVAL '1 second')
         THEN NOW() ELSE public.ebnimaam_rate_limits.window_started_at END,
       updated_at=NOW()
     RETURNING hits`,
    [rateKey, windowSeconds],
  );
  return Number(result.rows[0]?.hits || limit + 1) <= limit;
}
