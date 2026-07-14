// Cloudflare Pages Function: /api/parent-dashboard
// Parent-facing dashboard for child activity and wallet restrictions.

import { getAccountsOverview, getPayableFees } from './backend.js';
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

function timestampMs(value) {
  const text = clean(value);
  if (!text) return 0;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.getTime();
  const dateOnly = new Date(`${text}T00:00:00`);
  return Number.isNaN(dateOnly.getTime()) ? 0 : dateOnly.getTime();
}

function sameText(left, right) {
  return lower(left) === lower(right);
}

function normalizeReferenceText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function referencesMatch(left, right) {
  const a = normalizeReferenceText(left);
  const b = normalizeReferenceText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const leftParts = clean(left).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const rightParts = clean(right).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (leftParts.length >= 3 && rightParts.length >= 3) {
    const leftTail = leftParts[leftParts.length - 1];
    const rightTail = rightParts[rightParts.length - 1];
    const samePrefix = leftParts.slice(0, -1).join('|') === rightParts.slice(0, -1).join('|');
    if (samePrefix && String(Number(leftTail)) === String(Number(rightTail))) return true;
  }
  return false;
}

function anyKeyMatches(value, keys) {
  return keys.some((key) => sameText(value, key) || referencesMatch(value, key));
}

function anyExactKeyMatches(value, keys) {
  return keys.some((key) => sameText(value, key));
}

function nowIso() {
  return new Date().toISOString();
}

function accountKeys(student) {
  return [
    pick(student, ['AccountRef', 'accountRef', '__id']),
    pick(student, ['AdmissionNo', 'admissionNo']),
    pick(student, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId'])
  ].map(clean).filter(Boolean);
}

function studentLoginCode(student) {
  return clean(pick(student, [
    'ParentLoginCode',
    'parentLoginCode',
    'VerificationCode',
    'verificationCode',
    'LoginCode',
    'loginCode'
  ])).toUpperCase();
}

async function firestoreRows(env, collection) {
  try {
    requireFirestoreEnv(env);
    return await listCollection(env, collection);
  } catch (_err) {
    return [];
  }
}

async function appsScriptAction(env, action, payload = {}) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  try {
    if (action === 'getApplications') {
      const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
      url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
      url.searchParams.set('action', action);
      const response = await fetch(url.toString());
      const text = await response.text();
      return JSON.parse(text);
    }
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: action,
        ...payload
      })
    });
    const text = await response.text();
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

async function loadParentSources(env, scope = 'full') {
  const full = scope !== 'identity';
  const [firestoreSales, firestoreApplications, firestoreStudents, firestoreLedger, firestoreInvoices, firestorePayments, firestoreClinic] = await Promise.all([
    firestoreRows(env, 'formSales'),
    firestoreRows(env, 'applications'),
    firestoreRows(env, 'students'),
    full ? firestoreRows(env, 'ledger') : Promise.resolve([]),
    full ? firestoreRows(env, 'invoices') : Promise.resolve([]),
    full ? firestoreRows(env, 'payments') : Promise.resolve([]),
    full ? firestoreRows(env, 'clinicRecords') : Promise.resolve([])
  ]);
  const [sheetSales, sheetApplications, sheetStudents, sheetFinance, sheetClinic] = await Promise.all([
    appsScriptAction(env, 'getFormSales'),
    appsScriptAction(env, 'getApplications'),
    appsScriptAction(env, 'getStudents'),
    full ? appsScriptAction(env, 'getAccountsOverview') : Promise.resolve(null),
    full ? appsScriptAction(env, 'getClinicRecords') : Promise.resolve(null)
  ]);
  let accountOverview = null;
  if (full) {
    try {
      accountOverview = await getAccountsOverview(env);
    } catch (_err) {
      accountOverview = null;
    }
  }
  const preferFirestore = (firestoreRows, sheetRows) => firestoreRows.length ? firestoreRows : (sheetRows || []);
  return {
    accounts: (accountOverview && accountOverview.ok && accountOverview.accounts) ||
      ((sheetFinance && sheetFinance.ok && sheetFinance.accounts) || []),
    sales: preferFirestore(firestoreSales, (sheetSales && sheetSales.ok && sheetSales.sales) || []),
    applications: preferFirestore(firestoreApplications, (sheetApplications && sheetApplications.ok && sheetApplications.applications) || []),
    students: preferFirestore(firestoreStudents, (sheetStudents && sheetStudents.ok && sheetStudents.students) || []),
    ledger: preferFirestore(firestoreLedger, (sheetFinance && sheetFinance.ok && sheetFinance.ledger) || []),
    invoices: preferFirestore(firestoreInvoices, (sheetFinance && sheetFinance.ok && sheetFinance.invoices) || []),
    payments: preferFirestore(firestorePayments, (sheetFinance && sheetFinance.ok && sheetFinance.payments) || []),
    clinic: preferFirestore(firestoreClinic, (sheetClinic && sheetClinic.ok && sheetClinic.records) || [])
  };
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
    ClassArm: pick(row, ['ClassArm', 'classArm', 'Arm', 'arm']),
    StudentType: pick(row, ['StudentType', 'studentType']),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'Email', 'email', 'VerificationEmail', 'FatherEmail', 'MotherEmail', 'GuardianEmail'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone']),
    VerificationCode: studentLoginCode(row),
    WalletCardStatus: pick(row, ['WalletCardStatus', 'walletCardStatus'], 'Active'),
    WalletDailyLimit: asMoneyNumber(pick(row, ['WalletDailyLimit', 'walletDailyLimit'])),
    WalletTxnLimit: asMoneyNumber(pick(row, ['WalletTxnLimit', 'walletTxnLimit'])),
    WalletPinThreshold: asMoneyNumber(pick(row, ['WalletPinThreshold', 'walletPinThreshold'])),
    Status: pick(row, ['Status', 'status'], 'Active'),
    StatusReason: pick(row, ['StatusReason', 'statusReason', 'WithdrawalReason', 'LeaveReason'])
  };
}

function normalizeApplicationChild(row) {
  const displayName = pick(row, ['ApplicantName', 'applicantName', 'DisplayName', 'displayName', 'Name', 'name']) ||
    [pick(row, ['Surname', 'surname']), pick(row, ['FirstName', 'firstName']), pick(row, ['MiddleName', 'middleName'])]
      .map(clean)
      .filter(Boolean)
      .join(' ');
  const applicationRef = pick(row, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
  return {
    ...row,
    AccountRef: applicationRef,
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
    ApplicationReference: applicationRef,
    DisplayName: displayName,
    ClassName: pick(row, ['ClassApplyingFor', 'classApplyingFor', 'ClassAdmitted', 'classAdmitted', 'ClassName', 'className']),
    StudentType: pick(row, ['StudentType', 'studentType'], 'Day Student'),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'VerificationEmail', 'verificationEmail', 'Email', 'email'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone', 'Phone', 'phone']),
    WalletCardStatus: 'Not Issued',
    WalletDailyLimit: 0,
    WalletTxnLimit: 0,
    WalletPinThreshold: 0,
    Status: pick(row, ['ResultStatus', 'resultStatus', 'Status', 'status'], 'Application'),
    StatusReason: '',
    EnglishScore: pick(row, ['EnglishScore', 'englishScore', 'English', 'english']),
    MathematicsScore: pick(row, ['MathematicsScore', 'mathematicsScore', 'MathScore', 'mathScore', 'Mathematics', 'mathematics']),
    InterviewScore: pick(row, ['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore']),
    TotalScore: pick(row, ['TotalScore', 'totalScore', 'Total', 'total']),
    ResultPercentage: pick(row, ['ResultPercentage', 'resultPercentage', 'Percentage', 'percentage']),
    ResultStatus: pick(row, ['ResultStatus', 'resultStatus', 'AdmissionDecision', 'admissionDecision']),
    ResultNotes: pick(row, ['ResultNotes', 'resultNotes', 'Notes', 'notes']),
    ResultSent: pick(row, ['ResultSent', 'resultSent', 'EntranceResultSent', 'entranceResultSent']),
    ResultReadyOnline: pick(row, ['ResultReadyOnline', 'resultReadyOnline', 'ResultPublished', 'resultPublished']),
    SubmittedAt: pick(row, ['SubmittedAt', 'submittedAt', 'CreatedAt', 'createdAt', 'ApplicationDate', 'applicationDate', 'Timestamp', 'timestamp']),
    CreatedAt: pick(row, ['CreatedAt', 'createdAt', 'SubmittedAt', 'submittedAt']),
    SourceType: 'Application'
  };
}

function normalizeLedger(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    RawDate: pick(row, ['Date', 'date', 'CreatedAt', 'createdAt', 'PaidAt', 'paidAt']),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    ApplicationReference: pick(row, ['ApplicationReference', 'applicationReference']),
    ApplicationID: pick(row, ['ApplicationID', 'applicationId']),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
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
    Source: pick(row, ['Source', 'source']),
    Reference: pick(row, ['Reference', 'reference', 'GatewayReference', 'gatewayReference', 'LedgerNo', 'ledgerNo', '__id'])
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
    DueDate: toDisplayDate(pick(row, ['DueDate', 'dueDate', 'PaymentDueDate', 'paymentDueDate'])),
    Status: pick(row, ['Status', 'status']),
    Reference: pick(row, ['InvoiceId', 'invoiceId', 'Reference', 'reference', '__id'])
  };
}

function normalizePayment(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'PaidAt', 'paidAt', 'CreatedAt', 'createdAt'])),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    ApplicationReference: pick(row, ['ApplicationReference', 'applicationReference']),
    ApplicationID: pick(row, ['ApplicationID', 'applicationId']),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Amount: asMoneyNumber(pick(row, ['Amount', 'amount', 'Credit', 'credit'])),
    Currency: pick(row, ['Currency', 'currency'], 'NGN'),
    Status: pick(row, ['Status', 'status']),
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

async function assertParentAccess(sources, email, code) {
  const wantedEmail = lower(email);
  const wantedCode = clean(code).toUpperCase();
  if (!wantedEmail || !wantedCode) {
    const err = new Error('Parent email and verification code are required.');
    err.status = 400;
    throw err;
  }

  const sales = sources.sales || [];
  const applications = sources.applications || [];
  const saleMatch = sales.some((row) => {
    return lower(pick(row, ['Email', 'email'])) === wantedEmail &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode;
  });
  const matchingApplications = applications.filter((row) => {
    return [
      pick(row, ['VerificationEmail', 'verificationEmail']),
      pick(row, ['ParentEmail', 'parentEmail']),
      pick(row, ['Email', 'email'])
    ].some((value) => lower(value) === wantedEmail) &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode;
  });
  const studentMatch = (sources.students || []).map(normalizeStudent).some((row) => {
    return lower(row.ParentEmail) === wantedEmail && studentLoginCode(row) === wantedCode;
  });
  if (!saleMatch && matchingApplications.length === 0 && !studentMatch) {
    const err = new Error('Invalid parent email or verification code.');
    err.status = 401;
    throw err;
  }
  return { applications, matchingApplications, studentMatch };
}

function parentOwnsStudent(student, email, applications, matchingApplications = []) {
  const wantedEmail = lower(email);
  if (lower(student.ParentEmail) === wantedEmail) return true;
  const appRef = pick(student, ['ApplicationReference', 'applicationReference']);
  if (appRef && matchingApplications.some((app) => sameText(pick(app, ['ApplicationReference', 'applicationReference', '__id']), appRef))) {
    return true;
  }
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

function isWalletLedger(entry) {
  return clean(entry && entry.FeeCode).toUpperCase() === 'WALLET_TOPUP' ||
    lower(entry && entry.FeeCategory) === 'wallet' ||
    lower(entry && entry.EntryType).includes('wallet');
}

function feeAccountSummary(entries) {
  const rows = (entries || []).filter((entry) => !isWalletLedger(entry));
  const debit = rows.reduce((sum, row) => sum + asMoneyNumber(row.Debit), 0);
  const credit = rows.reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0);
  return {
    TotalDebit: debit,
    TotalCredit: credit,
    OutstandingBalance: Math.max(0, debit - credit),
    CreditBalance: Math.max(0, credit - debit)
  };
}

function normalizeAccountSummary(row) {
  if (!row) return null;
  const totalDebit = asMoneyNumber(pick(row, ['TotalDebit', 'totalDebit']));
  const totalCredit = asMoneyNumber(pick(row, ['TotalCredit', 'totalCredit']));
  const balance = pick(row, ['Balance', 'balance']);
  const outstanding = pick(row, ['OutstandingBalance', 'outstandingBalance']);
  const credit = pick(row, ['ExcessCredit', 'excessCredit', 'CreditBalance', 'creditBalance']);
  const computedBalance = totalDebit - totalCredit;
  return {
    TotalDebit: totalDebit,
    TotalCredit: totalCredit,
    OutstandingBalance: outstanding !== '' ? asMoneyNumber(outstanding) : Math.max(0, asMoneyNumber(balance || computedBalance)),
    CreditBalance: credit !== '' ? asMoneyNumber(credit) : Math.max(0, -asMoneyNumber(balance || computedBalance))
  };
}

function accountSummaryForKeys(accounts, keys, ledgerEntries) {
  const account = (accounts || []).find((row) => {
    const rowKeys = [
      pick(row, ['AccountRef', 'accountRef', '__id']),
      pick(row, ['AdmissionNo', 'admissionNo']),
      pick(row, ['ApplicationReference', 'applicationReference'])
    ].map(clean).filter(Boolean);
    return rowKeys.some((key) => anyKeyMatches(key, keys));
  });
  return normalizeAccountSummary(account) || feeAccountSummary(ledgerEntries);
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

function schoolResultsAreVisible(profile = {}) {
  return isYes(profile.ShowResultsOnline || profile.showResultsOnline || profile.ResultsOnline || profile.resultsOnline);
}

async function getSchoolProfile(env) {
  try {
    const rows = await listCollection(env, 'settings');
    return rows.find((row) => row.__id === 'schoolProfile') || {};
  } catch (_err) {
    return {};
  }
}

function resultIsVisible(application, profile = {}) {
  if (!schoolResultsAreVisible(profile)) return false;
  return isYes(pick(application, ['ResultReadyOnline', 'resultReadyOnline', 'ResultPublished', 'resultPublished', 'ShowResultOnPortal', 'showResultOnPortal']));
}

function buildEntranceResult(application, profile = {}) {
  if (!application || !resultIsVisible(application, profile)) return null;
  return {
    ApplicationReference: pick(application, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']),
    ApplicantName: pick(application, ['ApplicantName', 'applicantName', 'DisplayName', 'displayName', 'Name', 'name']),
    EnglishScore: pick(application, ['EnglishScore', 'englishScore', 'English', 'english']),
    MathematicsScore: pick(application, ['MathematicsScore', 'mathematicsScore', 'MathScore', 'mathScore', 'Mathematics', 'mathematics']),
    InterviewScore: pick(application, ['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore']),
    TotalScore: pick(application, ['TotalScore', 'totalScore', 'Total', 'total']),
    ResultPercentage: pick(application, ['ResultPercentage', 'resultPercentage', 'Percentage', 'percentage']),
    ResultStatus: pick(application, ['ResultStatus', 'resultStatus', 'AdmissionDecision', 'admissionDecision', 'Status', 'status']),
    ResultNotes: pick(application, ['ResultNotes', 'resultNotes', 'Notes', 'notes']),
    ResultNextStep: pick(application, ['ResultNextStep', 'resultNextStep', 'NextStep', 'nextStep']),
    ResultUpdatedAt: toDisplayDate(pick(application, ['ResultUpdatedAt', 'resultUpdatedAt', 'UpdatedAt', 'updatedAt'])),
    ResultSentAt: toDisplayDate(pick(application, ['ResultSentAt', 'resultSentAt', 'EntranceResultSentAt', 'entranceResultSentAt']))
  };
}

function schoolFeeTotalItem(breakdown) {
  const items = (breakdown || []).filter(isSchoolFee);
  if (!items.length) return null;
  const total = items.reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0);
  if (total <= 0) return null;
  const originalTotal = items.reduce((sum, fee) => sum + asMoneyNumber(fee.OriginalAmount || fee.Amount), 0);
  const creditApplied = Math.max(0, originalTotal - total);
  const installmentItems = items.filter((fee) => isYes(fee.AllowInstallment));
  const installmentMinimum = items.reduce((sum, fee) => {
    if (!isYes(fee.AllowInstallment)) return sum;
    const min = asMoneyNumber(fee.MinAmount);
    return sum + (min > 0 ? min : 0);
  }, 0);
  const minimumInstallmentPortion = installmentItems.length && installmentMinimum <= 0 ? 1 : installmentMinimum;
  const minAmount = Math.min(total, minimumInstallmentPortion);
  const allowInstallment = installmentItems.length > 0;
  return {
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeName: 'School Fees Total',
    FeeCategory: 'School Fee',
    Amount: total,
    OriginalAmount: originalTotal || total,
    CreditApplied: creditApplied,
    BalanceAmount: total,
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
      Amount: fee.OriginalAmount || fee.Amount,
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

function walletTopupItem(account = {}) {
  return {
    FeeCode: 'WALLET_TOPUP',
    FeeName: 'Student Wallet Top-up',
    FeeCategory: 'Wallet',
    Amount: 0,
    Currency: 'NGN',
    AllowInstallment: 'YES',
    MinAmount: 500,
    MaxAmount: '',
    PaymentType: 'Wallet',
    AcademicSession: account.AcademicSession || '',
    Term: account.Term || ''
  };
}

function paymentGroupKey(entry) {
  const reference = clean(entry.Reference || entry.GatewayReference || entry.TransactionReference || entry.PaymentNo || '');
  const schoolFeesBase = reference.match(/^(.*SCHOOL_FEES_TOTAL.*-\d+)(?:-[A-Za-z0-9_]+)?$/);
  return [
    schoolFeesBase ? schoolFeesBase[1] : reference,
    clean(entry.Date || ''),
    clean(entry.AccountRef || '')
  ].join('||');
}

function isPaidRecord(entry) {
  const status = lower(entry.Status);
  if (['unpaid', 'pending', 'due', 'invoice', 'invoiced', 'failed', 'cancelled', 'canceled'].includes(status)) return false;
  const amount = asMoneyNumber(entry.Credit || entry.Amount);
  if (amount <= 0) return false;
  if (['paid', 'success', 'successful', 'completed', 'confirmed'].includes(status)) return true;
  if (lower(entry.EntryType).includes('payment')) return true;
  return Boolean(clean(entry.Reference || entry.GatewayReference || entry.TransactionReference || entry.PaymentId));
}

function childCanShowFinanceHistory(child) {
  const status = lower(child && child.Status);
  return !['new', 'submitted', 'pending', 'application'].includes(status);
}

function groupedLedgerPayments(entries) {
  const groups = {};
  (entries || []).forEach((entry) => {
    const credit = asMoneyNumber(entry.Credit);
    if (credit <= 0) return;
    if (!isPaidRecord(entry)) return;
    const key = paymentGroupKey(entry) || `${clean(entry.Date)}||${clean(entry.AccountRef)}||${clean(entry.RecordedBy)}`;
    groups[key] = groups[key] || {
      ...entry,
      RecordType: 'Payment',
      Description: lower(entry.FeeCategory) === 'school fee' ? 'School Fee' : (entry.FeeCategory || entry.Department || entry.Description || entry.FeeName || entry.FeeCode || 'Payment'),
      Amount: 0,
      Credit: 0,
      Status: entry.Status || 'Paid'
    };
    groups[key].Amount += credit;
    groups[key].Credit += credit;
  });
  return Object.values(groups);
}

function paymentHistoryFor(keys, payments, ledger) {
  const ledgerEntries = (ledger || []).filter((entry) => anyExactKeyMatches(entry.AccountRef, keys) && lower(entry.FeeCategory) !== 'wallet');
  const paidLedgerEntries = ledgerEntries.filter(isPaidRecord);
  return groupedLedgerPayments(paidLedgerEntries).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
}

function recordMatchesApplication(record, applicationRef) {
  const ref = clean(applicationRef);
  if (!ref) return false;
  return sameText(record.ApplicationReference, ref) ||
    sameText(record.ApplicationID, ref) ||
    referencesMatch(record.Reference, ref);
}

function paymentHistoryForChild(child, payments, ledger) {
  if (!childCanShowFinanceHistory(child)) return [];
  if (child && child.SourceType === 'Application') {
    const appRef = clean(child.ApplicationReference || child.AccountRef);
    const childCreatedMs = timestampMs(child.SubmittedAt || child.CreatedAt || child.UpdatedAt);
    const appLedger = (ledger || []).filter((entry) => {
      if (lower(entry.FeeCategory) === 'wallet' || !isPaidRecord(entry) || !recordMatchesApplication(entry, appRef)) return false;
      if (!childCreatedMs) return false;
      const entryMs = timestampMs(entry.RawDate || entry.Date);
      return entryMs >= childCreatedMs;
    });
    return groupedLedgerPayments(appLedger).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  }
  return paymentHistoryFor(accountKeys(child), payments, ledger);
}

async function getAppsScriptAccountsOverview(env) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getAccountsOverview'
      })
    });
    const text = await response.text();
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
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

function invoiceDueNotifications(invoices, keys, accountSummary = null) {
  if (accountSummary && asMoneyNumber(accountSummary.OutstandingBalance) <= 0) return [];
  return (invoices || [])
    .filter((invoice) => anyKeyMatches(invoice.AccountRef, keys))
    .filter((invoice) => {
      const status = lower(invoice.Status);
      const balance = invoice.Balance !== undefined && invoice.Balance !== ''
        ? asMoneyNumber(invoice.Balance)
        : Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit));
      return clean(invoice.DueDate) && status !== 'paid' && balance > 0;
    })
    .map((invoice) => ({
      FeeCode: invoice.FeeCode,
      FeeName: invoice.FeeName || invoice.FeeCode || 'Payment due',
      FeeCategory: invoice.FeeCategory,
      Amount: invoice.Balance !== undefined && invoice.Balance !== '' ? invoice.Balance : Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit)),
      Currency: 'NGN',
      AcademicSession: invoice.AcademicSession || '',
      Term: invoice.Term || '',
      DueDate: invoice.DueDate,
      DueStatus: dueStatus(invoice.DueDate),
      Source: 'Invoice'
    }));
}

async function getDashboard(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const sources = await loadParentSources(env, 'full');
  const schoolProfile = await getSchoolProfile(env);
  const { applications, matchingApplications } = await assertParentAccess(sources, email, code);
  const allStudents = (sources.students || []).map(normalizeStudent);
  const children = allStudents.filter((student) => parentOwnsStudent(student, email, applications, matchingApplications));
  const childRefs = new Set(children.flatMap((child) => accountKeys(child).map((key) => lower(key))));
  const parentApplications = applications.filter((app) => {
    const emailMatch = [
      pick(app, ['VerificationEmail', 'verificationEmail']),
      pick(app, ['ParentEmail', 'parentEmail']),
      pick(app, ['Email', 'email'])
    ].some((value) => lower(value) === email);
    const codeMatch = clean(pick(app, ['VerificationCode', 'verificationCode'])).toUpperCase() === code;
    return emailMatch || codeMatch;
  });
  parentApplications
    .map(normalizeApplicationChild)
    .filter((child) => child.AccountRef && !childRefs.has(lower(child.AccountRef)))
    .forEach((child) => {
      children.push(child);
      accountKeys(child).forEach((key) => childRefs.add(lower(key)));
    });
  const ledger = (sources.ledger || []).map(normalizeLedger);
  const invoices = (sources.invoices || []).map(normalizeInvoice);
  const payments = (sources.payments || []).map(normalizePayment);
  const clinic = (sources.clinic || []).map(normalizeClinicRecord);
  const walletActivity = {};
  const paymentRecords = {};
  const payableItems = {};
  const payableErrors = {};
  const dueNotifications = {};
  const clinicVisits = {};
  const entranceResults = {};
  const accountSummaries = {};

  for (const child of children) {
    const keys = accountKeys(child);
    const childLedger = ledger.filter((entry) => anyKeyMatches(entry.AccountRef, keys));
    const walletEntries = ledger.filter((entry) => {
      return anyKeyMatches(entry.AccountRef, keys) &&
        lower(entry.FeeCategory) === 'wallet';
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    child.WalletBalance = walletBalance(walletEntries);
    const accountSummary = accountSummaryForKeys(sources.accounts, keys, childLedger);
    child.TotalDebit = accountSummary.TotalDebit;
    child.TotalCredit = accountSummary.TotalCredit;
    child.OutstandingBalance = accountSummary.OutstandingBalance;
    child.CreditBalance = accountSummary.CreditBalance;
    accountSummaries[child.AccountRef] = accountSummary;
    walletActivity[child.AccountRef] = walletEntries;
    paymentRecords[child.AccountRef] = paymentHistoryForChild(child, payments, ledger);
    payableItems[child.AccountRef] = [];
    dueNotifications[child.AccountRef] = invoiceDueNotifications(invoices, keys, accountSummary);
    clinicVisits[child.AccountRef] = clinic.filter((record) => {
      return anyKeyMatches(record.AdmissionNo, keys);
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    const resultSource = applications.find((app) => {
      const appRef = pick(app, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
      return keys.some((key) => referencesMatch(appRef, key) || sameText(appRef, key));
    }) || (child.SourceType === 'Application' ? child : null);
    const result = buildEntranceResult(resultSource, schoolProfile);
    entranceResults[child.AccountRef] = result ? [result] : [];
  }

  return {
    ok: true,
    message: 'Parent dashboard loaded.',
    children,
    walletActivity,
    paymentRecords,
    accountSummaries,
    payableItems,
    payableErrors,
    dueNotifications,
    showResultsOnline: schoolResultsAreVisible(schoolProfile),
    entranceResults,
    clinicVisits
  };
}

async function getChildActivity(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const accountRef = clean(body.accountRef || body.AccountRef || body.AdmissionNo);
  const sources = await loadParentSources(env, 'full');
  const schoolProfile = await getSchoolProfile(env);
  const { applications, matchingApplications } = await assertParentAccess(sources, email, code);
  const allStudents = (sources.students || []).map(normalizeStudent);
  const children = allStudents.filter((student) => parentOwnsStudent(student, email, applications, matchingApplications));
  const childRefs = new Set(children.flatMap((child) => accountKeys(child).map((key) => lower(key))));
  applications
    .filter((app) => {
      const emailMatch = [
        pick(app, ['VerificationEmail', 'verificationEmail']),
        pick(app, ['ParentEmail', 'parentEmail']),
        pick(app, ['Email', 'email'])
      ].some((value) => lower(value) === email);
      const codeMatch = clean(pick(app, ['VerificationCode', 'verificationCode'])).toUpperCase() === code;
      return emailMatch || codeMatch;
    })
    .map(normalizeApplicationChild)
    .filter((child) => child.AccountRef && !childRefs.has(lower(child.AccountRef)))
    .forEach((child) => {
      children.push(child);
      accountKeys(child).forEach((key) => childRefs.add(lower(key)));
    });
  const child = children.find((row) => accountKeys(row).some((key) => anyKeyMatches(accountRef, [key])));
  if (!child) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  const keys = accountKeys(child);
  const ledger = (sources.ledger || []).map(normalizeLedger);
  const invoices = (sources.invoices || []).map(normalizeInvoice);
  const payments = (sources.payments || []).map(normalizePayment);
  const clinic = (sources.clinic || []).map(normalizeClinicRecord);
  const walletEntries = ledger.filter((entry) => anyKeyMatches(entry.AccountRef, keys) && lower(entry.FeeCategory) === 'wallet')
    .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  const childLedger = ledger.filter((entry) => anyKeyMatches(entry.AccountRef, keys));
  const accountSummary = accountSummaryForKeys(sources.accounts, keys, childLedger);
  child.TotalDebit = accountSummary.TotalDebit;
  child.TotalCredit = accountSummary.TotalCredit;
  child.OutstandingBalance = accountSummary.OutstandingBalance;
  child.CreditBalance = accountSummary.CreditBalance;
  const resultSource = applications.find((app) => {
    const appRef = pick(app, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
    return keys.some((key) => referencesMatch(appRef, key) || sameText(appRef, key));
  }) || (child.SourceType === 'Application' ? child : null);
  const result = buildEntranceResult(resultSource, schoolProfile);
  return {
    ok: true,
    accountRef: child.AccountRef,
    walletActivity: walletEntries,
    walletBalance: walletBalance(walletEntries),
    accountSummary,
    paymentRecords: paymentHistoryForChild(child, payments, ledger),
    dueNotifications: invoiceDueNotifications(invoices, keys, accountSummary),
    clinicVisits: clinic.filter((record) => anyKeyMatches(record.AdmissionNo, keys)).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))),
    showResultsOnline: schoolResultsAreVisible(schoolProfile),
    entranceResults: result ? [result] : []
  };
}

async function updateWalletRestrictions(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  requireFirestoreEnv(env);
  const sources = await loadParentSources(env);
  const { applications } = await assertParentAccess(sources, email, body.code || body.VerificationCode);
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

async function getChildPayable(env, body) {
  const payable = await getPayableFees(env, {
    Email: body.email || body.ParentEmail || body.Email,
    VerificationCode: body.code || body.VerificationCode,
    AccountRef: body.accountRef || body.AccountRef || body.AdmissionNo
  });
  const items = buildPayableItems(payable.fees || [], payable.schoolFeeBreakdown || []);
  if (!items.some(isWalletFee) && clean(payable.account && payable.account.AdmissionNo)) {
    items.push(walletTopupItem(payable.account));
  }
  const sources = await loadParentSources(env);
  const accountOverview = await getAccountsOverview(env).catch(() => null);
  const accountSummary = accountOverview && accountOverview.ok
    ? accountSummaryForKeys(accountOverview.accounts || [], [body.accountRef || body.AccountRef || body.AdmissionNo], [])
    : null;
  const invoiceNotices = invoiceDueNotifications((sources.invoices || []).map(normalizeInvoice), [body.accountRef || body.AccountRef || body.AdmissionNo], accountSummary);
  const itemNotices = items
    .filter((item) => clean(item.DueDate))
    .map((item) => ({
      FeeCode: item.FeeCode,
      FeeName: item.FeeName,
      FeeCategory: item.FeeCategory,
      Amount: item.Amount,
      OriginalAmount: item.OriginalAmount || item.Amount,
      CreditApplied: item.CreditApplied || '',
      BalanceAmount: item.BalanceAmount || item.Amount,
      Currency: item.Currency || 'NGN',
      AcademicSession: item.AcademicSession || '',
      Term: item.Term || '',
      DueDate: item.DueDate,
      DueStatus: dueStatus(item.DueDate),
      AllowInstallment: item.AllowInstallment || '',
      MinAmount: item.MinAmount || '',
      MaxAmount: item.MaxAmount || '',
      Components: item.Components || []
    }));
  return {
    ok: true,
    message: 'Payable items loaded.',
    accountRef: clean(body.accountRef || body.AccountRef || body.AdmissionNo),
    payableItems: items,
    dueNotifications: [...invoiceNotices, ...itemNotices]
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action || body.Action || 'getDashboard');
    let data;
    if (action === 'updateWalletRestrictions') {
      data = await updateWalletRestrictions(env, body);
    } else if (action === 'getChildActivity') {
      data = await getChildActivity(env, body);
    } else if (action === 'getChildPayable') {
      data = await getChildPayable(env, body);
    } else {
      data = await getDashboard(env, body);
    }
    return Response.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache'
      }
    });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, {
      status: err.status || 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache'
      }
    });
  }
}
