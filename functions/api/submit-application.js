// Cloudflare Pages Function: /api/submit-application
// Submits completed admission form to Google Apps Script.

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
    if (data.ok) {
      return Response.json(data, { status: 200 });
    }

    const recovered = await findSubmittedApplication(env, email, code);
    if (recovered.ok) {
      return Response.json(recovered, { status: 200 });
    }

    return Response.json(data, { status: 400 });

  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}

async function findSubmittedApplication(env, email, code) {
  try {
    const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
    url.searchParams.set('action', 'getApplications');
    url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return { ok: false };

    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.applications || data.rows || []);
    const match = rows.find((row) => {
      const rowEmail = String(row.VerificationEmail || row.Email || '').trim().toLowerCase();
      const rowCode = String(row.VerificationCode || '').trim().toUpperCase();
      return rowEmail === email && rowCode === code;
    });

    if (!match) return { ok: false };
    const reference = String(match.ApplicationReference || match.ApplicationID || '').trim();
    return {
      ok: true,
      message: 'Application submitted successfully.',
      recovered: true,
      applicationReference: reference,
      reference
    };
  } catch (_) {
    return { ok: false };
  }
}
