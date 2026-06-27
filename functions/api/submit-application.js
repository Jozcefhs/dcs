// Cloudflare Pages Function: /api/submit-application
// Submits completed admission form to a different sheet/tab through Apps Script.

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const verification = body.verification || {};
    const application = body.application || {};

    const email = String(verification.email || '').trim().toLowerCase();
    const code = String(verification.code || '').trim().toUpperCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Verification information is missing. Please verify again.' }, { status: 400 });
    }

    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: false, message: 'Server submission is not configured yet.' }, { status: 500 });
    }

    const payload = {
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'submitApplication',
      VerificationEmail: email,
      VerificationCode: code,
      ReceiptNo: verification.receiptNo || '',
      Application: application
    };

    const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
