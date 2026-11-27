import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let schemaReady: Promise<void> | null = null;

async function ensureAuditTable() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS public.admin_activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(async () => {
      await pool.query('CREATE INDEX IF NOT EXISTS admin_activity_log_created_at_idx ON public.admin_activity_log(created_at DESC)');
    }).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function recordAdminActivity(
  action: string,
  entityType: string | null = null,
  entityId: string | null = null,
  details: Record<string, string | number | boolean | null> = {},
) {
  try {
    await ensureAuditTable();
    const serialized = JSON.stringify(details);
    const safeDetails = serialized.length <= 4000
      ? serialized
      : JSON.stringify({ note: 'Details omitted because they exceeded the audit limit.' });
    await pool.query(
      `INSERT INTO public.admin_activity_log(actor,action,entity_type,entity_id,details)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      ['admin', action.slice(0, 100), entityType?.slice(0, 80) || null, entityId?.slice(0, 180) || null, safeDetails],
    );
  } catch (error) {
    // Do not leak request data or interrupt a completed order/product update.
    console.error('Ebnimaam administrator audit write failed.', error instanceof Error ? error.message : 'unknown error');
  }
}

export async function getRecentAdminActivity(limit = 40) {
  await ensureAuditTable();
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 40;
  const result = await pool.query(
    `SELECT id,actor,action,entity_type,entity_id,details,created_at
     FROM public.admin_activity_log ORDER BY created_at DESC LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}
