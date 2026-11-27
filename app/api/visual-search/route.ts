import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { checkRateLimit } from '../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

export async function POST(req: Request) {
  let allowed = false;
  try { allowed = await checkRateLimit(req, 'visual-product-search', 8, 15 * 60); }
  catch { return NextResponse.json({ error: 'Image search is temporarily unavailable.' }, { status: 503 }); }
  if (!allowed) return NextResponse.json({ error: 'Too many image searches. Please wait and try again.' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const image = String(body?.image || '');
  if (!image.startsWith('data:image/')) return NextResponse.json({ error: 'Choose a product photo to search.' }, { status: 400 });
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return NextResponse.json({ error: 'Use a JPG, PNG or WebP image.' }, { status: 400 });
  const binary = Buffer.from(match[2], 'base64');
  if (!binary.length || binary.length > 4 * 1024 * 1024) return NextResponse.json({ error: 'Please choose an image smaller than 4 MB.' }, { status: 413 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Visual search is not yet connected. You can still search by product name.' }, { status: 503 });
  try {
    const catalogue = await pool.query('SELECT name,category,tag,description FROM public.ebnimaam_products WHERE is_active=TRUE AND stock>0 ORDER BY updated_at DESC LIMIT 80');
    const list = catalogue.rows.map((p: any) => [p.name,p.category,p.tag,p.description].filter(Boolean).join(' · ')).join('\n');
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'You are an image-based product search helper for the Ebnimaam shop. Look at the supplied photo and return one short search phrase (2 to 8 words) describing the visible product type, colour, material or style. Do not identify a person. Do not guess brand, price or availability. Return only the search phrase.' }] },
        contents: [{ role: 'user', parts: [
          { text: 'Find the closest matching items in this current Ebnimaam catalogue. Catalogue: ' + list },
          { inline_data: { mime_type: match[1], data: match[2] } }
        ] }],
        generationConfig: { maxOutputTokens: 40, temperature: 0.1 }
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return NextResponse.json({ error: 'Image search could not analyse that photo. Please try a clearer picture.' }, { status: 502 });
    const query = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 100);
    if (!query) return NextResponse.json({ error: 'No clear product description was found. Try another photo.' }, { status: 422 });
    return NextResponse.json({ query });
  } catch {
    return NextResponse.json({ error: 'Image search is temporarily unavailable.' }, { status: 503 });
  }
}
