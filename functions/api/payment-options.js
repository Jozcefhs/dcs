// Cloudflare Pages Function: /api/payment-options
// Returns unpaid online fee items for a verified application.

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and verification code are required.' }, { status: 400 });
    }

    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: false, message: 'Server payment lookup is not configured yet.' }, { status: 500 });
    }

    const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getPayableFees',
        Email: email,
        VerificationCode: code
      })
    });
    const data = await res.json();
    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
