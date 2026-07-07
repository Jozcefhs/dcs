// Cloudflare Pages Function: /api/verify-form-payment
// Verifies a Paystack admission form purchase and records the form sale.

import { recordSale as recordSaleInFirestore } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';

function extractMetadata(data) {
  const metadata = data && data.metadata;
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (_err) {
      return {};
    }
  }
  return metadata;
}

function makeVerificationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  bytes.forEach((byte) => {
    code += chars[byte % chars.length];
  });
  return code;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function makeReceiptNo(reference) {
  const year = new Date().getFullYear();
  const suffix = String(reference || '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return `DCA/FORM/${year}/${suffix || Date.now().toString().slice(-6)}`;
}

async function recordSaleInAppsScript(env, payload) {
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'recordSale',
      ...payload
    })
  });
  const data = await response.json();
  return { response, data };
}

async function recordSale(env, payload) {
  try {
    requireFirestoreEnv(env);
    const data = await recordSaleInFirestore(env, {
      ...payload,
      CreatedBy: 'Online Payment',
      PaymentReference: payload.PaymentReference || payload.Reference || ''
    });
    return { response: { ok: true, status: 200 }, data };
  } catch (firestoreErr) {
    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return {
        response: { ok: false, status: firestoreErr.status || 500 },
        data: { ok: false, message: firestoreErr.message || String(firestoreErr) }
      };
    }
    return recordSaleInAppsScript(env, payload);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const reference = String(body.reference || '').trim();

    if (!reference) {
      return Response.json({ ok: false, message: 'Payment reference is required.' }, { status: 400 });
    }
    if (!env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Admission form payment verification is not configured yet.' }, { status: 500 });
    }

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      return Response.json({ ok: false, message: paystackData.message || 'Payment has not been confirmed.' }, { status: 400 });
    }

    const tx = paystackData.data;
    const meta = extractMetadata(tx);
    if (meta.paymentType && meta.paymentType !== 'AdmissionForm') {
      return Response.json({ ok: false, message: 'This payment is not an admission form purchase.' }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const amount = Number(tx.amount || 0) / 100;
    const expiryDays = Number(env.ADMISSION_FORM_EXPIRY_DAYS || 60);
    const receiptNo = makeReceiptNo(tx.reference || reference);
    const basePayload = {
      ReceiptNo: receiptNo,
      ApplicantName: meta.applicantName || '',
      Email: (tx.customer && tx.customer.email) || meta.email || '',
      Phone: meta.phone || '',
      ClassApplyingFor: meta.classApplyingFor || '',
      AmountPaid: amount,
      FormLink: `${origin}/verify.html`,
      PaymentDate: tx.paid_at || tx.paidAt || new Date().toISOString(),
      PaymentReference: tx.reference || reference,
      ExpiryDate: formatDateOnly(addDays(new Date(), Number.isFinite(expiryDays) && expiryDays > 0 ? expiryDays : 60)),
      Status: 'PAID',
      Used: 'NO'
    };

    let recordData = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const verificationCode = makeVerificationCode();
      const result = await recordSale(env, { ...basePayload, VerificationCode: verificationCode });
      recordData = result.data;
      if (recordData && recordData.ok) break;
      if (!String((recordData && recordData.message) || '').toLowerCase().includes('verification code already exists')) {
        return Response.json(recordData || { ok: false, message: 'Could not record form sale.' }, { status: 400 });
      }
    }

    if (!recordData || !recordData.ok) {
      return Response.json({ ok: false, message: 'Could not generate a unique verification code. Please contact the Admissions Office.' }, { status: 500 });
    }

    return Response.json({
      ok: true,
      message: recordData.duplicate ? 'Admission form purchase was already recorded.' : 'Admission form purchase verified and recorded.',
      applicantName: basePayload.ApplicantName,
      email: basePayload.Email,
      receiptNo,
      verificationCode: recordData.verificationCode || recordData.VerificationCode || '',
      amount,
      currency: tx.currency || 'NGN',
      reference: tx.reference || reference,
      formLink: basePayload.FormLink,
      expiryDate: recordData.expiryDate || basePayload.ExpiryDate
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
