import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getVerifiedCustomer } from '../../../../lib/loyalty';
import { checkRateLimit } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function ensureSupportSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_support_tickets(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting_support','waiting_customer','resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_support_messages(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.ebnimaam_support_tickets(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('customer','admin')),
    sender_user_id TEXT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_support_tickets_user_updated_idx ON public.ebnimaam_support_tickets(user_id,updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS ebnimaam_support_messages_ticket_created_idx ON public.ebnimaam_support_messages(ticket_id,created_at)');
}
function cleanMessage(value: unknown) {
  const body = String(value ?? '').replace(/\u0000/g, '').trim();
  if (body.length < 3 || body.length > 3000) throw new Error('A support message must contain 3 to 3,000 characters.');
  return body;
}

export async function GET(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return NextResponse.json({ error: 'Sign in with your verified account to view support history.' }, { status: 401 });
  try {
    await ensureSupportSchema();
    const result = await pool.query(
      `SELECT t.id,t.subject,t.category,t.status,t.created_at,t.updated_at,
         COALESCE((SELECT json_agg(json_build_object('id',m.id,'sender_type',m.sender_type,'body',m.body,'created_at',m.created_at) ORDER BY m.created_at)
           FROM public.ebnimaam_support_messages m WHERE m.ticket_id=t.id),'[]'::json) AS messages
       FROM public.ebnimaam_support_tickets t
       WHERE t.user_id=$1
       ORDER BY t.updated_at DESC LIMIT 50`,
      [user.id],
    );
    return NextResponse.json({ tickets: result.rows }, { headers: { 'cache-control': 'private, no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'Support history is temporarily unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(req: Request) {
  const user = await getVerifiedCustomer(req);
  if (!user) return NextResponse.json({ error: 'Sign in with your verified account to contact support.' }, { status: 401 });
  let allowed = false;
  try { allowed = await checkRateLimit(req, 'customer-support-write', 12, 60 * 60); }
  catch { return NextResponse.json({ error: 'Support is temporarily unavailable.' }, { status: 503 }); }
  if (!allowed) return NextResponse.json({ error: 'You have reached the hourly support-message limit. Please try again later.' }, { status: 429, headers: { 'retry-after': '3600' } });
  try {
    await ensureSupportSchema();
    const body = await req.json().catch(() => ({}));
    const message = cleanMessage(body?.message);
    const ticketId = String(body?.ticketId || '').trim();
    if (ticketId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ticket = await client.query('SELECT id,status FROM public.ebnimaam_support_tickets WHERE id=$1 AND user_id=$2 FOR UPDATE', [ticketId,user.id]);
        if (!ticket.rowCount) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'That support ticket was not found in your account.' }, { status: 404 });
        }
        await client.query(
          "INSERT INTO public.ebnimaam_support_messages(ticket_id,sender_type,sender_user_id,body) VALUES($1,'customer',$2,$3)",
          [ticketId,user.id,message],
        );
        await client.query(
          "UPDATE public.ebnimaam_support_tickets SET status=CASE WHEN status='resolved' THEN 'open' ELSE 'waiting_support' END,updated_at=NOW() WHERE id=$1",
          [ticketId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      } finally { client.release(); }
      return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    }

    const subject = String(body?.subject || '').trim().slice(0, 140);
    const category = String(body?.category || '').trim();
    if (subject.length < 4 || !['order','payment','delivery','product','account','return','other'].includes(category)) {
      return NextResponse.json({ error: 'Enter a subject of at least 4 characters and choose a support category.' }, { status: 400 });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ticket = await client.query(
        "INSERT INTO public.ebnimaam_support_tickets(user_id,customer_email,subject,category,status) VALUES($1,$2,$3,$4,'open') RETURNING id",
        [user.id,user.email,subject,category],
      );
      await client.query(
        "INSERT INTO public.ebnimaam_support_messages(ticket_id,sender_type,sender_user_id,body) VALUES($1,'customer',$2,$3)",
        [ticket.rows[0].id,user.id,message],
      );
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, ticketId: ticket.rows[0].id }, { status: 201, headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    } finally { client.release(); }
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || 'Your support message could not be saved.') }, { status: 400 });
  }
}
