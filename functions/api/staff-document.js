// Authenticated staff proxy for viewing or downloading private admission documents.

import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const DOCUMENTS = [
  ['BirthCertificate', 'Birth Certificate'],
  ['PreviousSchoolReport', 'Previous School Report'],
  ['PassportPhotograph', 'Passport Photograph'],
  ['MedicalReport', 'Medical Report'],
  ['TransferCertificateDoc', 'Transfer Certificate'],
  ['AcceptanceForm', 'Acceptance Form']
];

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }

function reference(row) {
  return clean(row.ApplicationReference || row.applicationReference || row.ApplicationID || row.applicationId || row.__id);
}

function documentEntry(row, key) {
  const documents = row.documents && typeof row.documents === 'object' ? row.documents : {};
  return documents[key] && typeof documents[key] === 'object' ? documents[key] : {};
}

function documentUrl(row, key) {
  const entry = documentEntry(row, key);
  return clean(entry.url || row[`Doc${key}Url`] || row[`${key}Url`] || row[`${key}Link`]);
}

function decodeBase64(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileName(value, fallback) {
  return clean(value || fallback).replace(/[^\x20-\x7e]|[\r\n"\\/:*?<>|]+/g, '_').slice(0, 160) || fallback;
}

async function loadDriveFile(env, url) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    const error = new Error('Private document storage is not configured.');
    error.status = 500;
    throw error;
  }
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'getStoredDocument',
      DocumentUrl: url
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.fileBase64) {
    const error = new Error(data.message || 'The uploaded document could not be loaded.');
    error.status = response.status >= 400 ? response.status : 502;
    throw error;
  }
  return data;
}

async function handleRequest(context, body = null) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const sharedSecretAuthorized = body && clean(env.BACKEND_SHARED_SECRET) && clean(body.Secret || body.secret) === clean(env.BACKEND_SHARED_SECRET);
    if (!sharedSecretAuthorized) {
      const user = await requireStaffSession(env, request);
      if (!(user.allowedSections || []).includes('admissions')) {
        return Response.json({ ok: false, message: 'Your role cannot access admission documents.' }, { status: 403 });
      }
    }

    const requestUrl = new URL(request.url);
    const applicationReference = clean((body && (body.ApplicationReference || body.applicationReference)) || requestUrl.searchParams.get('applicationReference'));
    const key = clean((body && (body.DocumentType || body.documentType)) || requestUrl.searchParams.get('documentType'));
    const requestedMode = clean((body && (body.Mode || body.mode)) || requestUrl.searchParams.get('mode'));
    const mode = lower(requestedMode) === 'download' ? 'attachment' : 'inline';
    const definition = DOCUMENTS.find(([candidate]) => candidate === key);
    if (!applicationReference || !definition) {
      return Response.json({ ok: false, message: 'A valid application reference and document type are required.' }, { status: 400 });
    }

    const applications = await listCollection(env, 'applications');
    const application = applications.find((row) => lower(reference(row)) === lower(applicationReference));
    if (!application) return Response.json({ ok: false, message: 'Application not found.' }, { status: 404 });
    const storedUrl = documentUrl(application, key);
    if (!storedUrl) return Response.json({ ok: false, message: `${definition[1]} has not been uploaded.` }, { status: 404 });

    const metadata = documentEntry(application, key);
    const file = await loadDriveFile(env, storedUrl);
    const fileName = safeFileName(file.fileName || metadata.fileName, `${key}.bin`);
    const mimeType = clean(file.mimeType || metadata.mimeType) || 'application/octet-stream';
    return new Response(decodeBase64(file.fileBase64), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `${mode}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return Response.json({ ok: false, message: clean(error && error.message ? error.message : error) }, { status: error.status || 500 });
  }
}

export async function onRequestGet(context) {
  return handleRequest(context);
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  return handleRequest(context, body);
}
