// Cloudflare Pages Function: /api/parent-dashboard
// Parent-facing dashboard for child activity and wallet restrictions.

import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asMoneyNumber(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function toDisplayDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function sameText(left, right) {
  return lower(left) === lower(right);
}

function nowIso() {
  return new Date().toISOString();
}

function accountKeys(student) {
  return [
    pick(student, ['AdmissionNo', 'admissionNo', 'AccountRef', '__id']),
    pick(student, ['ApplicationReference', 'applicationReference'])
  ].map(clean).filter(Boolean);
}

function normalizeStudent(row) {
  const displayName = pick(row, ['DisplayName', 'displayName', 'ApplicantName', 'applicantName']);
  return {
    ...row,
    AccountRef: pick(row, ['AccountRef', 'AdmissionNo', 'admissionNo', '__id']),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo', '__id']),
    ApplicationReference: pick(row, ['ApplicationReference', 'applicationReference']),
    DisplayName: displayName,
    ClassName: pick(row, ['ClassName', 'className', 'ClassAdmitted', 'classAdmitted']),
    StudentType: pick(row, ['StudentType', 'studentType']),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'Email', 'email', 'VerificationEmail'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone']),
    WalletCardStatus: pick(row, ['WalletCardStatus', 'walletCardStatus'], 'Active'),
    WalletDailyLimit: asMoneyNumber(pick(row, ['WalletDailyLimit', 'walletDailyLimit'])),
    WalletTxnLimit: asMoneyNumber(pick(row, ['WalletTxnLimit', 'walletTxnLimit'])),
    WalletPinThreshold: asMoneyNumber(pick(row, ['WalletPinThreshold', 'walletPinThreshold'])),
    Status: pick(row, ['Status', 'status'], 'Active'),
    StatusReason: pick(row, ['StatusReason', 'statusReason', 'WithdrawalReason', 'LeaveReason'])
  };
}

function normalizeLedger(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    EntryType: pick(row, ['EntryType', 'entryType']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    Description: pick(row, ['Description', 'description']),
    Debit: asMoneyNumber(pick(row, ['Debit', 'debit'])),
    Credit: asMoneyNumber(pick(row, ['Credit', 'credit'])),
    RecordedBy: pick(row, ['RecordedBy', 'recordedBy']),
    Source: pick(row, ['Source', 'source'])
  };
}

function normalizeClinicRecord(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef']),
    StudentName: pick(row, ['StudentName', 'studentName']),
    ClassName: pick(row, ['ClassName', 'className']),
    Complaint: pick(row, ['Complaint', 'complaint']),
    Treatment: pick(row, ['Treatment', 'treatment']),
    Disposition: pick(row, ['Disposition', 'disposition']),
    RecordedBy: pick(row, ['RecordedBy', 'recordedBy'])
  };
}

async function assertParentAccess(env, email, code) {
  const wantedEmail = lower(email);
  const wantedCode = clean(code).toUpperCase();
  if (!wantedEmail || !wantedCode) {
    const err = new Error('Parent email and verification code are required.');
    err.status = 400;
    throw err;
  }

  const sales = await listCollection(env, 'formSales');
  const applications = await listCollection(env, 'applications');
  const saleMatch = sales.some((row) => {
    return lower(pick(row, ['Email', 'email'])) === wantedEmail &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode;
  });
  const applicationMatch = applications.some((row) => {
    return [
      pick(row, ['VerificationEmail', 'verificationEmail']),
      pick(row, ['ParentEmail', 'parentEmail']),
      pick(row, ['Email', 'email'])
    ].some((value) => lower(value) === wantedEmail) &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode;
  });
  if (!saleMatch && !applicationMatch) {
    const err = new Error('Invalid parent email or verification code.');
    err.status = 401;
    throw err;
  }
  return { applications };
}

function parentOwnsStudent(student, email, applications) {
  const wantedEmail = lower(email);
  if (lower(student.ParentEmail) === wantedEmail) return true;
  const appRef = pick(student, ['ApplicationReference', 'applicationReference']);
  return applications.some((app) => {
    const sameRef = appRef && sameText(pick(app, ['ApplicationReference', 'applicationReference', '__id']), appRef);
    const emailMatch = [
      pick(app, ['VerificationEmail', 'verificationEmail']),
      pick(app, ['ParentEmail', 'parentEmail']),
      pick(app, ['Email', 'email'])
    ].some((value) => lower(value) === wantedEmail);
    return sameRef && emailMatch;
  });
}

function walletBalance(entries) {
  return entries.reduce((balance, row) => balance + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit), 0);
}

async function getDashboard(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const { applications } = await assertParentAccess(env, email, body.code || body.VerificationCode);
  const allStudents = (await listCollection(env, 'students')).map(normalizeStudent);
  const children = allStudents.filter((student) => parentOwnsStudent(student, email, applications));
  const ledger = (await listCollection(env, 'ledger')).map(normalizeLedger);
  const clinic = (await listCollection(env, 'clinicRecords')).map(normalizeClinicRecord);
  const walletActivity = {};
  const clinicVisits = {};

  children.forEach((child) => {
    const keys = accountKeys(child);
    const walletEntries = ledger.filter((entry) => {
      return keys.some((key) => sameText(entry.AccountRef, key)) &&
        lower(entry.FeeCategory) === 'wallet';
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    child.WalletBalance = walletBalance(walletEntries);
    walletActivity[child.AccountRef] = walletEntries;
    clinicVisits[child.AccountRef] = clinic.filter((record) => {
      return keys.some((key) => sameText(record.AdmissionNo, key));
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  });

  return {
    ok: true,
    message: 'Parent dashboard loaded.',
    children,
    walletActivity,
    clinicVisits
  };
}

async function updateWalletRestrictions(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const { applications } = await assertParentAccess(env, email, body.code || body.VerificationCode);
  const students = (await listCollection(env, 'students')).map(normalizeStudent);
  const accountRef = clean(body.accountRef || body.AccountRef || body.AdmissionNo);
  const student = students.find((row) => {
    return parentOwnsStudent(row, email, applications) &&
      accountKeys(row).some((key) => sameText(key, accountRef));
  });
  if (!student) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  const status = clean(body.walletCardStatus || body.WalletCardStatus || 'Active');
  const updates = {
    ...student,
    WalletCardStatus: ['active', 'blocked'].includes(lower(status)) ? status : 'Active',
    WalletTxnLimit: asMoneyNumber(body.walletTxnLimit || body.WalletTxnLimit),
    WalletDailyLimit: asMoneyNumber(body.walletDailyLimit || body.WalletDailyLimit),
    WalletPinThreshold: asMoneyNumber(body.walletPinThreshold || body.WalletPinThreshold),
    WalletRestrictionUpdatedBy: 'Parent',
    WalletRestrictionUpdatedAt: nowIso()
  };
  await upsertDocument(env, 'students', safeDocumentId(student.AdmissionNo || student.AccountRef), updates);
  return { ok: true, message: 'Wallet restrictions saved.' };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action || body.Action || 'getDashboard');
    const data = action === 'updateWalletRestrictions'
      ? await updateWalletRestrictions(env, body)
      : await getDashboard(env, body);
    return Response.json(data);
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status: err.status || 500 });
  }
}
