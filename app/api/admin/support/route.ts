import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { recordAdminActivity } from '../../../../lib/admin-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const secret = process.env.ADMIN_PASSWORD || '';

async function ensureSupportSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_support_tickets(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id TEXT NOT NULL,customer_email TEXT NOT NULL,
    subject TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','waiting_support','waiting_customer','resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_support_messages(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id UUID NOT NULL REFERENCES public.ebnimaam_support_tickets(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('customer','admin')),sender_user_id TEXT,body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

export async function GET(req: Request) {
  if (!isAdminRequest(req,secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureSupportSchema();
    const result = await pool.query(
      `SELECT t.id,t.user_id,t.customer_email,t.subject,t.category,t.status,t.created_at,t.updated_at,
        COALESCE((SELECT json_agg(json_build_object('id',m.id,'sender_type',m.sender_type,'body',m.body,'created_at',m.created_at) ORDER BY m.created_at)
          FROM public.ebnimaam_support_messages m WHERE m.ticket_id=t.id),'[]'::json) AS messages
       FROM public.ebnimaam_support_tickets t
       ORDER BY CASE WHEN t.status='open' THEN 0 WHEN t.status='waiting_support' THEN 1 WHEN t.status='waiting_customer' THEN 2 ELSE 3 END,t.updated_at DESC
       LIMIT 300`,
    );
    return NextResponse.json({ tickets: result.rows }, { headers: { 'cache-control': 'private, no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Support tickets are temporarily unavailable.' }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  if (!isAdminRequest(req,secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ticketId = String(body?.ticketId || '').trim();
  const status = body?.status == null ? null : String(body.status);
  const reply = body?.reply == null ? '' : String(body.reply).replace(/\u0000/g,'').trim();
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return NextResponse.json({ error: 'A valid ticket ID is required.' }, { status: 400 });
  if (status !== null && !['open','waiting_support','waiting_customer','resolved'].includes(status)) return NextResponse.json({ error: 'Invalid support ticket status.' }, { status: 400 });
  if (reply && (reply.length < 3 || reply.length > 3000)) return NextResponse.json({ error: 'An admin reply must contain 3 to 3,000 characters.' }, { status: 400 });
  if (status === null && !reply) return NextResponse.json({ error: 'Provide a status update or a customer reply.' }, { status: 400 });
  try {
    await ensureSupportSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT id FROM public.ebnimaam_support_tickets WHERE id=$1 FOR UPDATE', [ticketId]);
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Support ticket not found.' }, { status: 404 });
      }
      if (reply) {
        await client.query(
          "INSERT INTO public.ebnimaam_support_messages(ticket_id,sender_type,sender_user_id,body) VALUES($1,'admin',NULL,$2)",
          [ticketId,reply],
        );
      }
      if (status !== null || reply) {
        await client.query('UPDATE public.ebnimaam_support_tickets SET status=$2,updated_at=NOW() WHERE id=$1', [ticketId,status || 'waiting_customer']);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally { client.release(); }
    await recordAdminActivity('support.ticket.updated','support_ticket',ticketId,{status:status||'waiting_customer',replied:!!reply});
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The support ticket could not be updated.' }, { status: 503 });
  }
}
