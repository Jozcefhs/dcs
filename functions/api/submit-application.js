import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function applicantName(application) {
  return [application.Surname, application.FirstName, application.MiddleName]
    .map(clean)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nextApplicationReference(applications) {
  const yearCode = String(new Date().getFullYear()).slice(-2);
  let maxNo = 0;
  (applications || []).forEach((row) => {
    const value = clean(row.ApplicationReference || row.ApplicationID || row.__id);
    const match = value.match(/(\d+)$/);
    if (match) maxNo = Math.max(maxNo, Number(match[1]));
  });
  return `DCA/${yearCode}/${String(maxNo + 1).padStart(6, '0')}`;
}

async function submitToFirestore(env, email, code, receiptNo, application) {
  requireFirestoreEnv(env);
  const sales = await listCollection(env, 'formSales');
  const sale = sales.find((row) => lower(row.Email) === email && clean(row.VerificationCode).toUpperCase() === code);
  if (!sale) return null;
  if (['yes', 'true', '1'].includes(lower(sale.Used))) {
    return { ok: false, message: 'This verification code has already been used.' };
  }

  const applications = await listCollection(env, 'applications');
  const reference = nextApplicationReference(applications);
  const now = new Date().toISOString();
  const app = {
    ...application,
    ApplicationReference: reference,
    ApplicationID: reference,
    ApplicantName: applicantName(application) || clean(sale.ApplicantName),
    Name: applicantName(application) || clean(sale.ApplicantName),
    VerificationEmail: email,
    VerificationCode: code,
    Email: email,
    ReceiptNo: receiptNo || clean(sale.ReceiptNo),
    ClassApplyingFor: clean(application.ClassApplyingFor || sale.ClassApplyingFor),
    Status: 'Submitted',
    SubmittedAt: now,
    UpdatedAt: now
  };
  await upsertDocument(env, 'applications', safeDocumentId(reference), app);
  await upsertDocument(env, 'formSales', safeDocumentId(clean(sale.ReceiptNo) || receiptNo || sale.__id), {
    ...sale,
    Used: 'YES',
    UsedAt: now,
    ApplicationReference: reference,
    UpdatedAt: now
  });
  return {
    ok: true,
    message: 'Application submitted successfully.',
    applicationReference: reference,
    reference,
    backend: 'firestore'
  };
}

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

    try {
      const firestoreResult = await submitToFirestore(env, email, code, verification.receiptNo || '', application);
      if (firestoreResult) {
        return Response.json(firestoreResult, { status: firestoreResult.ok ? 200 : 400 });
      }
    } catch (_err) {
      // Fall back to Apps Script if Firestore is not configured or does not contain the sale.
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
