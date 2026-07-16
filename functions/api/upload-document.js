// Cloudflare Pages Function: /api/upload-document
// Lets parents upload missing admission documents using their verification email/code.

import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function pick(row, names, fallback = '') {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return row[name];
    }
  }
  return fallback;
}

function applicationPayloadForAppsScript(app) {
  const payload = { ...app };
  [
    '__id',
    '__name',
    'createdAt',
    'updatedAt',
    'parent',
    'documents',
    'activities'
  ].forEach((key) => {
    delete payload[key];
  });
  return payload;
}

async function findFirestoreApplication(env, email, code) {
  try {
    requireFirestoreEnv(env);
    const rows = await listCollection(env, 'applications');
    return rows.find((row) => {
      const rowEmail = lower(pick(row, ['VerificationEmail', 'verificationEmail', 'ParentEmail', 'parentEmail', 'Email', 'email']));
      const rowCode = clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase();
      return rowEmail === email && rowCode === code;
    }) || null;
  } catch (_err) {
    return null;
  }
}

async function syncFirestoreApplicationToAppsScript(env, app, email, code) {
  if (!app || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  const payload = {
    Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
    Action: 'submitApplication',
    VerificationEmail: email,
    VerificationCode: code,
    ReceiptNo: pick(app, ['ReceiptNo', 'receiptNo']),
    Application: applicationPayloadForAppsScript(app)
  };
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return response.json().catch(() => null);
}

async function uploadViaAppsScript(env, payload) {
  const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();
    const documentType = String(body.documentType || '').trim();
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const fileBase64 = String(body.fileBase64 || '').trim();
    const replaceExisting = Boolean(body.replaceExisting);

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and verification code are required.' }, { status: 400 });
    }
    if (!documentType) {
      return Response.json({ ok: false, message: 'Select the document you are uploading.' }, { status: 400 });
    }
    if (!fileName || !fileBase64) {
      return Response.json({ ok: false, message: 'Choose a file to upload.' }, { status: 400 });
    }
    if (!env.GOOGLE_APPS_SCRIPT_URL) {
      return Response.json({
        ok: false,
        message: 'Document upload storage is not configured. In Firestore mode, files are not stored inside Firestore; configure Google Apps Script/Google Drive, Firebase Storage, or Cloudflare R2 for document storage.'
      }, { status: 500 });
    }

    const payload = {
      Action: 'uploadParentDocument',
      Email: email,
      VerificationCode: code,
      DocumentType: documentType,
      FileName: fileName,
      MimeType: mimeType,
      FileBase64: fileBase64,
      ReplaceExisting: replaceExisting ? 'YES' : 'NO'
    };

    let data = await uploadViaAppsScript(env, payload);
    if (!data.ok && String(data.message || '').toLowerCase().includes('application not found')) {
      const firestoreApp = await findFirestoreApplication(env, email, code);
      if (firestoreApp) {
        const syncResult = await syncFirestoreApplicationToAppsScript(env, firestoreApp, email, code);
        if (syncResult && syncResult.ok) {
          data = await uploadViaAppsScript(env, payload);
        } else {
          data = {
            ok: false,
            message: `Application exists in Firestore, but could not be synced to Google Sheet for Drive upload. ${syncResult && syncResult.message ? syncResult.message : 'Check the form sale record in Apps Script/Google Sheet.'}`
          };
        }
      }
    }
    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
