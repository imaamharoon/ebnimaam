import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APK_URL = 'https://github.com/imaamharoon/ebnimaam/releases/latest/download/app-debug.apk';

export async function GET() {
  try {
    const upstream = await fetch(APK_URL, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'Ebnimaam-App-Downloader',
      },
    });

    const contentType = upstream.headers.get('content-type') || '';
    const size = Number(upstream.headers.get('content-length') || 0);
    const apkResponse = /application\/(octet-stream|vnd\.android\.package-archive)/i.test(contentType);

    if (!upstream.ok || !upstream.body || !apkResponse || (size > 0 && size < 1024 * 1024)) {
      return NextResponse.json(
        { error: 'The Android app download is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }

    const headers = new Headers({
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': 'attachment; filename="ebnimaam-android.apk"',
      'cache-control': 'private, no-store, no-cache, must-revalidate',
      'x-content-type-options': 'nosniff',
    });
    if (size > 0) headers.set('content-length', String(size));

    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return NextResponse.json(
      { error: 'The Android app download is temporarily unavailable. Please try again shortly.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
