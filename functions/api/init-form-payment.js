// Cloudflare Pages Function: /api/init-form-payment
// Starts Paystack checkout for admission form purchase.

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';

function cleanReference(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
}

function toAmount(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeClassName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
}

async function classIsOpen(env, className) {
  if (!className) return false;
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return true;

  const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set('action', 'getAdmissionClasses');
  url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
  const response = await fetch(url.toString());
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || 'Could not confirm available classes.');
  const wanted = normalizeClassName(className);
  return (data.openClasses || []).some((openClass) => normalizeClassName(openClass) === wanted);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const applicantName = String(body.applicantName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const classApplyingFor = String(body.classApplyingFor || '').trim();
    const amount = toAmount(env.ADMISSION_FORM_AMOUNT);

    if (!applicantName || !email || !classApplyingFor) {
      return Response.json({ ok: false, message: 'Applicant name, parent email, and class are required.' }, { status: 400 });
    }
    if (!env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Paystack secret key is not configured.' }, { status: 500 });
    }
    if (amount <= 0) {
      return Response.json({ ok: false, message: 'Admission form amount is not configured. Set ADMISSION_FORM_AMOUNT in Cloudflare.' }, { status: 500 });
    }
    if (!(await classIsOpen(env, classApplyingFor))) {
      return Response.json({ ok: false, message: `Admission is not currently open for ${classApplyingFor}.` }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const reference = cleanReference(`DCA-FORM-${Date.now()}`);
    const callbackUrl = `${origin}/payment-success.html?type=form&reference=${encodeURIComponent(reference)}`;

    const paystackRes = await fetch(PAYSTACK_INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata: {
          paymentType: 'AdmissionForm',
          applicantName,
          phone,
          classApplyingFor,
          formAmount: amount
        }
      })
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return Response.json({ ok: false, message: paystackData.message || 'Could not start Paystack payment.' }, { status: 400 });
    }

    return Response.json({
      ok: true,
      authorizationUrl: paystackData.data.authorization_url,
      reference: paystackData.data.reference
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
