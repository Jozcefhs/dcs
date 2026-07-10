// Cloudflare Pages Function: /api/parent-dashboard
// Parent-facing dashboard for child activity and wallet restrictions.

import { getPayableFees } from './backend.js';
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
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    EntryType: pick(row, ['EntryType', 'entryType']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    Description: pick(row, ['Description', 'description']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Debit: asMoneyNumber(pick(row, ['Debit', 'debit'])),
    Credit: asMoneyNumber(pick(row, ['Credit', 'credit'])),
    Balance: asMoneyNumber(pick(row, ['Balance', 'balance'])),
    Status: pick(row, ['Status', 'status']),
    RecordedBy: pick(row, ['RecordedBy', 'recordedBy']),
    Source: pick(row, ['Source', 'source'])
  };
}

function normalizeInvoice(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Debit: asMoneyNumber(pick(row, ['Debit', 'debit', 'Amount', 'amount'])),
    Credit: asMoneyNumber(pick(row, ['Credit', 'credit', 'PaidAmount', 'paidAmount'])),
    Balance: asMoneyNumber(pick(row, ['Balance', 'balance', 'BalanceAmount', 'balanceAmount'])),
    Status: pick(row, ['Status', 'status']),
    Reference: pick(row, ['InvoiceId', 'invoiceId', 'Reference', 'reference', '__id'])
  };
}

function normalizePayment(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'PaidAt', 'paidAt', 'CreatedAt', 'createdAt'])),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Amount: asMoneyNumber(pick(row, ['Amount', 'amount', 'Credit', 'credit'])),
    Currency: pick(row, ['Currency', 'currency'], 'NGN'),
    Status: pick(row, ['Status', 'status'], 'Paid'),
    Gateway: pick(row, ['Gateway', 'gateway']),
    Method: pick(row, ['Method', 'method']),
    Reference: pick(row, ['Reference', 'reference', 'TransactionReference', 'transactionReference', 'PaymentId', 'paymentId', '__id'])
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

function isWalletFee(fee) {
  return clean(fee.FeeCode) === 'WALLET_TOPUP' || lower(fee.FeeCategory) === 'wallet';
}

function isSchoolFee(fee) {
  return fee && !isWalletFee(fee) && lower(fee.FeeCategory || 'School Fee') === 'school fee';
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(lower(value));
}

function schoolFeeTotalItem(breakdown) {
  const items = (breakdown || []).filter(isSchoolFee);
  if (!items.length) return null;
  const total = items.reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0);
  if (total <= 0) return null;
  const nonInstallmentTotal = items.reduce((sum, fee) => sum + (isYes(fee.AllowInstallment) ? 0 : asMoneyNumber(fee.Amount)), 0);
  const installmentItems = items.filter((fee) => isYes(fee.AllowInstallment));
  const installmentMinimum = items.reduce((sum, fee) => {
    if (!isYes(fee.AllowInstallment)) return sum;
    const min = asMoneyNumber(fee.MinAmount);
    return sum + (min > 0 ? min : 0);
  }, 0);
  const minimumInstallmentPortion = installmentItems.length && installmentMinimum <= 0 ? 1 : installmentMinimum;
  const minAmount = Math.min(total, nonInstallmentTotal + minimumInstallmentPortion);
  const allowInstallment = installmentItems.length > 0 && minAmount < total;
  return {
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeName: 'School Fees Total',
    FeeCategory: 'School Fee',
    Amount: total,
    Currency: items[0].Currency || 'NGN',
    AllowInstallment: allowInstallment ? 'YES' : 'NO',
    MinAmount: allowInstallment ? minAmount : '',
    MaxAmount: total,
    PaymentType: 'SchoolFeesTotal',
    AcademicSession: items[0].AcademicSession || '',
    Term: items[0].Term || '',
    DueDate: items.map((item) => clean(item.DueDate)).filter(Boolean).sort()[0] || '',
    Components: items.map((fee) => ({
      FeeCode: fee.FeeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory || 'School Fee',
      Amount: fee.Amount,
      OriginalAmount: fee.OriginalAmount || fee.Amount,
      PaidAmount: fee.PaidAmount || '',
      AcceptanceCreditApplied: fee.AcceptanceCreditApplied || '',
      BalanceAmount: fee.BalanceAmount || fee.Amount,
      Currency: fee.Currency || items[0].Currency || 'NGN',
      AcademicSession: fee.AcademicSession || '',
      Term: fee.Term || '',
      AllowInstallment: fee.AllowInstallment || '',
      MinAmount: fee.MinAmount || '',
      MaxAmount: fee.MaxAmount || '',
      DueDate: fee.DueDate || ''
    }))
  };
}

function buildPayableItems(fees, breakdown) {
  const items = [];
  const schoolTotal = schoolFeeTotalItem(breakdown);
  if (schoolTotal) items.push(schoolTotal);
  (fees || []).forEach((fee) => {
    if (!isSchoolFee(fee)) items.push(fee);
  });
  return items;
}

function dueStatus(dueDate) {
  const text = clean(dueDate);
  if (!text) return '';
  const due = new Date(`${text}T23:59:59`);
  if (Number.isNaN(due.getTime())) return '';
  const today = new Date();
  const ms = due.getTime() - today.getTime();
  const days = Math.ceil(ms / 86400000);
  if (days < 0) return `Overdue by ${Math.abs(days)} day(s)`;
  if (days === 0) return 'Due today';
  if (days <= 7) return `Due in ${days} day(s)`;
  return `Due ${text}`;
}

async function getDashboard(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const { applications } = await assertParentAccess(env, email, code);
  const allStudents = (await listCollection(env, 'students')).map(normalizeStudent);
  const children = allStudents.filter((student) => parentOwnsStudent(student, email, applications));
  const ledger = (await listCollection(env, 'ledger')).map(normalizeLedger);
  const invoices = (await listCollection(env, 'invoices')).map(normalizeInvoice);
  const payments = (await listCollection(env, 'payments')).map(normalizePayment);
  const clinic = (await listCollection(env, 'clinicRecords')).map(normalizeClinicRecord);
  const walletActivity = {};
  const paymentRecords = {};
  const payableItems = {};
  const dueNotifications = {};
  const clinicVisits = {};

  for (const child of children) {
    const keys = accountKeys(child);
    const walletEntries = ledger.filter((entry) => {
      return keys.some((key) => sameText(entry.AccountRef, key)) &&
        lower(entry.FeeCategory) === 'wallet';
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    child.WalletBalance = walletBalance(walletEntries);
    walletActivity[child.AccountRef] = walletEntries;
    const invoiceEntries = invoices.filter((entry) => keys.some((key) => sameText(entry.AccountRef, key))).map((entry) => ({
      ...entry,
      RecordType: 'Invoice',
      Amount: entry.Debit,
      Description: entry.FeeName || entry.FeeCode || 'Fee invoice',
      Status: entry.Status || (entry.Balance > 0 ? 'Outstanding' : 'Paid')
    }));
    const paymentEntries = payments.filter((entry) => keys.some((key) => sameText(entry.AccountRef, key))).map((entry) => ({
      ...entry,
      RecordType: 'Payment',
      Description: entry.FeeName || entry.FeeCode || 'Payment',
      Credit: entry.Amount,
      Status: entry.Status || 'Paid'
    }));
    const ledgerEntries = ledger.filter((entry) => {
      return keys.some((key) => sameText(entry.AccountRef, key)) &&
        lower(entry.FeeCategory) !== 'wallet';
    }).map((entry) => ({
      ...entry,
      RecordType: entry.Credit > 0 ? 'Ledger Credit' : 'Ledger Debit',
      Amount: entry.Debit || entry.Credit,
      Description: entry.Description || entry.FeeName || entry.FeeCode || entry.EntryType || 'Ledger entry',
      Status: entry.Status || (entry.Credit > 0 ? 'Paid' : (entry.Balance > 0 ? 'Outstanding' : 'Posted'))
    }));
    paymentRecords[child.AccountRef] = [...invoiceEntries, ...paymentEntries, ...ledgerEntries]
      .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    try {
      const payable = await getPayableFees(env, { Email: email, VerificationCode: code, AccountRef: child.AccountRef });
      const items = buildPayableItems(payable.fees || [], payable.schoolFeeBreakdown || []);
      payableItems[child.AccountRef] = items;
      dueNotifications[child.AccountRef] = items
        .filter((item) => clean(item.DueDate))
        .map((item) => ({
          FeeCode: item.FeeCode,
          FeeName: item.FeeName,
          FeeCategory: item.FeeCategory,
          Amount: item.Amount,
          Currency: item.Currency || 'NGN',
          AcademicSession: item.AcademicSession || '',
          Term: item.Term || '',
          DueDate: item.DueDate,
          DueStatus: dueStatus(item.DueDate),
          AllowInstallment: item.AllowInstallment || '',
          MinAmount: item.MinAmount || '',
          MaxAmount: item.MaxAmount || ''
        }));
    } catch (_err) {
      payableItems[child.AccountRef] = [];
      dueNotifications[child.AccountRef] = [];
    }
    clinicVisits[child.AccountRef] = clinic.filter((record) => {
      return keys.some((key) => sameText(record.AdmissionNo, key));
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  }

  return {
    ok: true,
    message: 'Parent dashboard loaded.',
    children,
    walletActivity,
    paymentRecords,
    payableItems,
    dueNotifications,
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
