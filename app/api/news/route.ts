import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { isAdminRequest } from '../../../lib/admin-auth';
import { recordAdminActivity } from '../../../lib/admin-audit';
export const runtime = 'nodejs';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ebnimaam_news(
    id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,image TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
export async function GET(req: Request) {
  try {
    await init();
    const admin = isAdminRequest(req);
    const result = admin
      ? await pool.query('SELECT * FROM public.ebnimaam_news ORDER BY created_at DESC')
      : await pool.query('SELECT id,title,content,image,published,created_at,updated_at FROM public.ebnimaam_news WHERE published=TRUE ORDER BY created_at DESC');
    return NextResponse.json({ news: result.rows }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'News is temporarily unavailable.', news: [] }, { status: 503 });
  }
}
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await init();
    const body = await req.json();
    const title = String(body.title || '').trim().slice(0, 180);
    const content = String(body.content || '').trim().slice(0, 12000);
    const image = String(body.image || '').trim();
    if (!title || !content) return NextResponse.json({ error: 'Headline and content are required.' }, { status: 400 });
    if (image && !image.startsWith('https://') && !image.startsWith('data:image/')) return NextResponse.json({ error: 'News image must be HTTPS or an uploaded image.' }, { status: 400 });
    if (image.length > 5_000_000) return NextResponse.json({ error: 'Image is too large.' }, { status: 400 });
    const id = String(body.id || 'news-' + crypto.randomUUID());
    const published = body.published !== false;
    await pool.query(
      `INSERT INTO public.ebnimaam_news(id,title,content,image,published)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET title=$2,content=$3,image=$4,published=$5,updated_at=NOW()`,
      [id,title,content,image,published],
    );
    await recordAdminActivity('news.saved', 'news', id, { title });
    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'News save failed.' }, { status: 500 });
  }
}
export async function DELETE(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'News item ID is required.' }, { status: 400 });
    await pool.query('DELETE FROM public.ebnimaam_news WHERE id=$1', [String(id)]);
    await recordAdminActivity('news.deleted', 'news', String(id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'News delete failed.' }, { status: 500 });
  }
}
