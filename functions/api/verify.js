// Cloudflare Pages Function: /api/verify
// Set these Cloudflare Pages environment variables:
// GOOGLE_APPS_SCRIPT_URL = your Apps Script Web App URL ending in /exec
// GOOGLE_APPS_SCRIPT_SECRET = the same shared secret in Apps Script

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and code are required.' }, { status: 400 });
    }

    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: false, message: 'Server verification is not configured yet.' }, { status: 500 });
    }

    const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
    url.searchParams.set('action', 'verify');
    url.searchParams.set('email', email);
    url.searchParams.set('code', code);
    url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);

    const res = await fetch(url.toString());
    const data = await res.json();

    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
