import { deleteDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
}

export async function getSchoolCode(env) {
  try {
    requireFirestoreEnv(env);
    const rows = await listCollection(env, 'settings');
    const profile = rows.find((row) => row.__id === 'schoolProfile') || rows.find((row) => clean(row.SchoolName));
    return normalizeSchoolCode((profile && profile.SchoolCode) || env.SCHOOL_CODE);
  } catch (_err) {
    return normalizeSchoolCode(env.SCHOOL_CODE);
  }
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asMoneyNumber(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function formatNairaAmount(value) {
  const text = clean(value);
  const number = Number(text.replace(/[₦\s,]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return text;
  return `₦${number.toLocaleString('en-NG', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

function yesNo(value) {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  const text = lower(value);
  return ['yes', 'y', 'true', '1', 'paid', 'active'].includes(text) ? 'YES' : (text ? 'NO' : '');
}

function toDisplayDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().slice(0, 10);
}

function timestampMs(value) {
  const text = clean(value);
  if (!text) return 0;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.getTime();
  const dateOnly = new Date(`${text}T00:00:00`);
  return Number.isNaN(dateOnly.getTime()) ? 0 : dateOnly.getTime();
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function nameFormatOrder(value) {
  const text = clean(value).toLowerCase();
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : ['surname', 'first name', 'middle name'];
}

function formatPersonName(row, profile = {}, fallback = '') {
  const values = {
    'first name': pick(row, ['FirstName', 'firstName', 'GivenName']),
    'middle name': pick(row, ['MiddleName', 'middleName']),
    surname: pick(row, ['Surname', 'surname', 'LastName', 'lastName', 'FamilyName'])
  };
  const name = nameFormatOrder(profile.NameFormat || profile.nameFormat)
    .map((key) => clean(values[key]))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || clean(fallback);
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function nowIso() {
  return new Date().toISOString();
}

function sameText(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function applicationIdFrom(data) {
  return clean(data.ApplicationID || data.ApplicationReference || data.id || data.applicationReference);
}

function studentIdFrom(data) {
  return clean(data.AdmissionNo || data.AdmissionNumber || data.admissionNo || data.AccountRef);
}

async function findApplication(env, id) {
  const rows = await listCollection(env, 'applications');
  return rows.find((row) => {
    return sameText(row.__id, safeDocumentId(id)) ||
      sameText(row.ApplicationReference, id) ||
      sameText(row.ApplicationID, id) ||
      sameText(row.applicationReference, id);
  }) || null;
}

async function findStudent(env, admissionNo, applicationReference = '') {
  const rows = await listCollection(env, 'students');
  return rows.find((row) => {
    return (admissionNo && (sameText(row.__id, safeDocumentId(admissionNo)) || sameText(row.AdmissionNo, admissionNo) || sameText(row.admissionNo, admissionNo))) ||
      (applicationReference && (sameText(row.ApplicationReference, applicationReference) || sameText(row.applicationReference, applicationReference)));
  }) || null;
}

async function findStudentByWalletCard(env, cardId) {
  const wanted = clean(cardId).toUpperCase();
  if (!wanted) return null;
  const rows = await listCollection(env, 'students');
  return rows.map(normalizeStudent).find((row) => clean(row.WalletCardId).toUpperCase() === wanted) || null;
}

async function findStudentByAccountRef(env, accountRef) {
  const wanted = clean(accountRef);
  if (!wanted) return null;
  const rows = await listCollection(env, 'students');
  return rows.map(normalizeStudent).find((row) => {
    return referencesMatch(row.AdmissionNo, wanted) ||
      referencesMatch(row.ApplicationReference, wanted) ||
      sameText(row.AdmissionNo, wanted) ||
      sameText(row.ApplicationReference, wanted) ||
      sameText(row.AccountRef, wanted);
  }) || null;
}

function findStudentByAccountRefInRows(rows, accountRef) {
  const wanted = clean(accountRef);
  if (!wanted) return null;
  return (rows || []).map(normalizeStudent).find((row) => {
    return referencesMatch(row.AdmissionNo, wanted) ||
      referencesMatch(row.ApplicationReference, wanted) ||
      sameText(row.AdmissionNo, wanted) ||
      sameText(row.ApplicationReference, wanted) ||
      sameText(row.AccountRef, wanted);
  }) || null;
}

async function saveApplication(env, application) {
  const id = pick(application, ['ApplicationReference', 'ApplicationID', 'applicationReference', '__id']);
  if (!id) {
    const err = new Error('ApplicationReference is required.');
    err.status = 400;
    throw err;
  }
  await upsertDocument(env, 'applications', safeDocumentId(id), application);
  return normalizeApplication(application);
}

async function saveStudent(env, student) {
  const id = pick(student, ['AdmissionNo', 'admissionNo', 'AccountRef', '__id']);
  if (!id) {
    const err = new Error('AdmissionNo is required.');
    err.status = 400;
    throw err;
  }
  await upsertDocument(env, 'students', safeDocumentId(id), student);
  return normalizeStudent(student);
}

function normalizeApplication(row, profile = {}) {
  const parent = row.parent && typeof row.parent === 'object' ? row.parent : {};
  const applicantName = formatPersonName(row, profile, pick(row, ['applicantName', 'ApplicantName', 'displayName', 'DisplayName']));
  return {
    ...row,
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference', '__id']),
    ApplicationID: pick(row, ['applicationReference', 'ApplicationReference', '__id']),
    ApplicantName: applicantName,
    Name: applicantName,
    Surname: pick(row, ['surname', 'Surname']),
    FirstName: pick(row, ['firstName', 'FirstName']),
    MiddleName: pick(row, ['middleName', 'MiddleName']),
    Gender: pick(row, ['gender', 'Gender']),
    DateOfBirth: toDisplayDate(pick(row, ['dateOfBirth', 'DateOfBirth'])),
    ClassApplyingFor: pick(row, ['classApplyingFor', 'ClassApplyingFor', 'className', 'ClassName']),
    StudentType: pick(row, ['studentType', 'StudentType'], 'Day Student'),
    Status: pick(row, ['status', 'Status'], 'Submitted'),
    ResultStatus: pick(row, ['resultStatus', 'ResultStatus']),
    OfferSent: yesNo(pick(row, ['offerSent', 'OfferSent'])),
    OfferSentAt: toDisplayDate(pick(row, ['offerSentAt', 'OfferSentAt'])),
    AdmissionLetterSent: yesNo(pick(row, ['admissionLetterSent', 'AdmissionLetterSent'])),
    AdmissionLetterSentAt: toDisplayDate(pick(row, ['admissionLetterSentAt', 'AdmissionLetterSentAt'])),
    AcceptanceFeePaid: yesNo(pick(row, ['acceptanceFeePaid', 'AcceptanceFeePaid'])),
    AcceptanceFeePaidAt: toDisplayDate(pick(row, ['acceptanceFeePaidAt', 'AcceptanceFeePaidAt'])),
    Enrolled: yesNo(pick(row, ['enrolled', 'Enrolled'])),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    VerificationEmail: lower(pick(row, ['verificationEmail', 'VerificationEmail', 'email', 'Email'], parent.email)),
    VerificationCode: clean(pick(row, ['verificationCode', 'VerificationCode'])).toUpperCase(),
    Email: lower(pick(row, ['email', 'Email'], parent.email)),
    Phone: pick(row, ['phone', 'Phone'], parent.phone),
    ParentName: pick(row, ['parentName', 'ParentName'], parent.name),
    ParentEmail: lower(pick(row, ['parentEmail', 'ParentEmail'], parent.email)),
    ParentPhone: pick(row, ['parentPhone', 'ParentPhone'], parent.phone),
    SubmittedAt: toDisplayDate(pick(row, ['createdAt', 'submittedAt', 'SubmittedAt'])),
    UpdatedAt: toDisplayDate(pick(row, ['updatedAt', 'UpdatedAt']))
  };
}

function normalizeStudent(row, profile = {}) {
  const displayName = formatPersonName(row, profile, pick(row, ['displayName', 'DisplayName', 'applicantName', 'ApplicantName']));
  return {
    ...row,
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo', '__id']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    ApplicantName: displayName,
    DisplayName: displayName,
    ClassAdmitted: pick(row, ['className', 'ClassName', 'classAdmitted', 'ClassAdmitted']),
    ClassName: pick(row, ['className', 'ClassName', 'classAdmitted', 'ClassAdmitted']),
    ClassArm: pick(row, ['classArm', 'ClassArm', 'arm', 'Arm']),
    StudentType: pick(row, ['studentType', 'StudentType'], 'Day Student'),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    ParentEmail: lower(pick(row, ['parentEmail', 'ParentEmail'])),
    ParentPhone: pick(row, ['parentPhone', 'ParentPhone']),
    VerificationCode: clean(pick(row, ['verificationCode', 'VerificationCode', 'parentLoginCode', 'ParentLoginCode', 'loginCode', 'LoginCode'])).toUpperCase(),
    ParentLoginCode: clean(pick(row, ['parentLoginCode', 'ParentLoginCode', 'verificationCode', 'VerificationCode', 'loginCode', 'LoginCode'])).toUpperCase(),
    WalletCardId: pick(row, ['walletCardId', 'WalletCardId']),
    WalletCardStatus: pick(row, ['walletCardStatus', 'WalletCardStatus']),
    WalletPinHash: pick(row, ['walletPinHash', 'WalletPinHash']),
    WalletPinSetAt: toDisplayDate(pick(row, ['walletPinSetAt', 'WalletPinSetAt'])),
    WalletDailyLimit: asMoneyNumber(pick(row, ['walletDailyLimit', 'WalletDailyLimit'])),
    WalletTxnLimit: asMoneyNumber(pick(row, ['walletTxnLimit', 'WalletTxnLimit'])),
    WalletPinThreshold: asMoneyNumber(pick(row, ['walletPinThreshold', 'WalletPinThreshold'])),
    WalletUpdatedAt: toDisplayDate(pick(row, ['walletUpdatedAt', 'WalletUpdatedAt'])),
    Status: pick(row, ['status', 'Status'], 'Active'),
    StatusReason: pick(row, ['statusReason', 'StatusReason', 'WithdrawalReason', 'LeaveReason']),
    StatusEffectiveDate: toDisplayDate(pick(row, ['statusEffectiveDate', 'StatusEffectiveDate'])),
    ExpectedReturnDate: toDisplayDate(pick(row, ['expectedReturnDate', 'ExpectedReturnDate']))
  };
}

function studentLoginCode(row) {
  return clean(pick(row, ['VerificationCode', 'verificationCode', 'ParentLoginCode', 'parentLoginCode', 'LoginCode', 'loginCode'])).toUpperCase();
}

function normalizeAccount(row) {
  return {
    ...row,
    AccountRef: pick(row, ['accountRef', 'AccountRef', '__id']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    DisplayName: pick(row, ['displayName', 'DisplayName']),
    ClassName: pick(row, ['className', 'ClassName']),
    StudentType: pick(row, ['studentType', 'StudentType']),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    TotalDebit: asMoneyNumber(pick(row, ['totalDebit', 'TotalDebit'])),
    TotalCredit: asMoneyNumber(pick(row, ['totalCredit', 'TotalCredit'])),
    Balance: asMoneyNumber(pick(row, ['balance', 'Balance'])),
    WalletBalance: asMoneyNumber(pick(row, ['walletBalance', 'WalletBalance'])),
    LastPaymentAt: toDisplayDate(pick(row, ['lastPaymentAt', 'LastPaymentAt'])),
    Status: pick(row, ['status', 'Status'])
  };
}

function normalizeFeeItem(row) {
  return {
    ...row,
    FeeCode: pick(row, ['feeCode', 'FeeCode', '__id']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory'], 'School Fee'),
    ClassName: pick(row, ['className', 'ClassName'], 'All'),
    StudentType: pick(row, ['studentType', 'StudentType'], 'All'),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'All'),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession'], 'All'),
    Term: pick(row, ['term', 'Term'], 'All'),
    Amount: asMoneyNumber(pick(row, ['amount', 'Amount'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    PayableOnline: yesNo(pick(row, ['payableOnline', 'PayableOnline'])),
    AllowInstallment: yesNo(pick(row, ['allowInstallment', 'AllowInstallment'])),
    MinAmount: asMoneyNumber(pick(row, ['minAmount', 'MinAmount'])),
    MaxAmount: asMoneyNumber(pick(row, ['maxAmount', 'MaxAmount'])),
    DueDate: toDisplayDate(pick(row, ['dueDate', 'DueDate', 'PaymentDueDate', 'paymentDueDate'])),
    RequiredForEnrollment: yesNo(pick(row, ['requiredForEnrollment', 'RequiredForEnrollment'])),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
  };
}

function normalizeInvoice(row) {
  return {
    ...row,
    InvoiceId: pick(row, ['invoiceId', 'InvoiceId', '__id']),
    AccountRef: pick(row, ['accountRef', 'AccountRef']),
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory']),
    Debit: asMoneyNumber(pick(row, ['amount', 'Amount', 'Debit'])),
    Credit: asMoneyNumber(pick(row, ['paidAmount', 'PaidAmount', 'Credit'])),
    Balance: asMoneyNumber(pick(row, ['balanceAmount', 'BalanceAmount', 'Balance'])),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    Status: pick(row, ['status', 'Status']),
    Date: toDisplayDate(pick(row, ['createdAt', 'Date']))
  };
}

function normalizePayment(row) {
  return {
    ...row,
    PaymentId: pick(row, ['paymentId', 'PaymentId', '__id']),
    AccountRef: pick(row, ['accountRef', 'AccountRef']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    DisplayName: pick(row, ['displayName', 'DisplayName']),
    ClassName: pick(row, ['className', 'ClassName']),
    StudentType: pick(row, ['studentType', 'StudentType']),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory']),
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory']),
    Amount: asMoneyNumber(pick(row, ['amount', 'Amount'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    Gateway: pick(row, ['gateway', 'Gateway']),
    Method: pick(row, ['method', 'Method']),
    Reference: pick(row, ['reference', 'Reference']),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    Status: pick(row, ['status', 'Status'], 'Paid'),
    Metadata: pick(row, ['metadata', 'Metadata']),
    Date: toDisplayDate(pick(row, ['paidAt', 'Date'])),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy'])
  };
}

function normalizeLedger(row) {
  return {
    ...row,
    LedgerNo: pick(row, ['ledgerNo', 'LedgerNo', 'LedgerId', 'LedgerID', '__id']),
    Date: toDisplayDate(pick(row, ['date', 'Date', 'createdAt', 'CreatedAt'])),
    RawDate: pick(row, ['date', 'Date', 'createdAt', 'CreatedAt', 'paidAt', 'PaidAt']),
    AccountRef: pick(row, ['accountRef', 'AccountRef']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    DisplayName: pick(row, ['displayName', 'DisplayName']),
    ClassName: pick(row, ['className', 'ClassName']),
    EntryType: pick(row, ['entryType', 'EntryType']),
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory']),
    Description: pick(row, ['description', 'Description']),
    Debit: asMoneyNumber(pick(row, ['debit', 'Debit'])),
    Credit: asMoneyNumber(pick(row, ['credit', 'Credit'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    Reference: pick(row, ['reference', 'Reference']),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy']),
    Source: pick(row, ['source', 'Source']),
    Metadata: pick(row, ['metadata', 'Metadata'])
  };
}

function normalizeClinicRecord(row) {
  return {
    ...row,
    RecordId: pick(row, ['recordId', 'RecordId', '__id']),
    Date: toDisplayDate(pick(row, ['createdAt', 'Date'])),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    StudentName: pick(row, ['studentName', 'StudentName']),
    ClassName: pick(row, ['className', 'ClassName']),
    Complaint: pick(row, ['complaint', 'Complaint']),
    Treatment: pick(row, ['treatment', 'Treatment']),
    Disposition: pick(row, ['disposition', 'Disposition']),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy']),
    ReviewedBy: pick(row, ['reviewedBy', 'ReviewedBy']),
    Notes: pick(row, ['notes', 'Notes'])
  };
}

function normalizeInventory(row) {
  return {
    ...row,
    ItemName: pick(row, ['itemName', 'ItemName', '__id']),
    Category: pick(row, ['category', 'Category']),
    Unit: pick(row, ['unit', 'Unit']),
    Quantity: asMoneyNumber(pick(row, ['quantity', 'Quantity'])),
    ReorderLevel: asMoneyNumber(pick(row, ['reorderLevel', 'ReorderLevel'])),
    LastUpdated: toDisplayDate(pick(row, ['lastUpdated', 'LastUpdated'])),
    Notes: pick(row, ['notes', 'Notes'])
  };
}

function requireBackendSecret(env, body) {
  const expected = clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET);
  if (!expected) return;
  const supplied = clean(body.Secret || body.secret);
  if (supplied !== expected) {
    const err = new Error('Unauthorized.');
    err.status = 401;
    throw err;
  }
}

function normalizeMatchText(value) {
  return clean(value).toLowerCase();
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
  const aParts = a.match(/^([a-z]+)(\d+)(\d+)$/);
  const bParts = b.match(/^([a-z]+)(\d+)(\d+)$/);
  return Boolean(aParts && bParts && aParts[1] === bParts[1] && aParts[2] === bParts[2] && String(Number(aParts[3])) === String(Number(bParts[3])));
}

function isAcceptanceFeeLike(row) {
  const parts = [
    row && row.FeeCode,
    row && row.FeeName,
    row && row.FeeCategory,
    row && row.PaymentType,
    row && row.EntryType,
    row && row.Description
  ].map((value) => normalizeMatchText(value)).join(' ');
  return parts.includes('acceptance_fee') ||
    parts.includes('acceptance fee') ||
    (parts.includes('acceptance') && parts.includes('admission'));
}

function accountRefsFrom(row) {
  return [
    row && row.AccountRef,
    row && row.ApplicationReference,
    row && row.ApplicationID,
    row && row.AdmissionNo,
    row && row.AdmissionNumber
  ].map(clean).filter(Boolean);
}

function referencesAny(left, refs) {
  const wanted = clean(left);
  if (!wanted) return false;
  return (refs || []).some((ref) => sameText(wanted, ref) || referencesMatch(wanted, ref));
}

function displayNameFromApplication(app) {
  return clean(pick(app, ['ApplicantName', 'DisplayName', 'Name'])) ||
    [pick(app, ['Surname']), pick(app, ['FirstName']), pick(app, ['MiddleName'])].map(clean).filter(Boolean).join(' ');
}

function accountRefFromApplication(app) {
  return clean(pick(app, ['AdmissionNo', 'AdmissionNumber', 'ApplicationReference', 'ApplicationID', '__id']));
}

function feeMatchVariants(value) {
  const text = normalizeMatchText(value);
  const compact = text.replace(/[^a-z0-9]/g, '');
  const variants = {};
  if (text) variants[text] = true;
  if (compact) variants[compact] = true;
  const levelMatch = text.match(/\b(jss|ss|primary|nursery|grade)\s*([0-9]+)/);
  if (levelMatch) variants[levelMatch[1] + levelMatch[2]] = true;
  if (text.includes('day')) variants.day = true;
  if (text.includes('boarding') || text.includes('boarder')) variants.boarding = true;
  return Object.keys(variants);
}

function feeFieldMatches(ruleValue, actualValue, allowBlankActual = false) {
  const rule = normalizeMatchText(ruleValue);
  if (!rule || rule === 'all' || rule === '*') return true;
  if (!normalizeMatchText(actualValue) && allowBlankActual) return true;
  if (!normalizeMatchText(actualValue)) return false;
  const actualVariants = feeMatchVariants(actualValue);
  const ruleVariants = [];
  rule.split(',').forEach((part) => {
    feeMatchVariants(part).forEach((variant) => ruleVariants.push(variant));
  });
  return ruleVariants.some((variant) => actualVariants.includes(variant));
}

function feeMatchesApplication(fee, app) {
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appBillingCategory = app.BillingCategory || 'Regular';
  const appSession = app.AcademicSession || '';
  const appTerm = app.Term || '';
  return feeFieldMatches(fee.ClassName, appClass) &&
    feeFieldMatches(fee.StudentType, appType) &&
    feeFieldMatches(fee.BillingCategory || 'All', appBillingCategory, true) &&
    feeFieldMatches(fee.AcademicSession, appSession, true) &&
    feeFieldMatches(fee.Term, appTerm, true);
}

function termRank(value) {
  const term = normalizeMatchText(value);
  if (!term || term === 'all' || term === '*') return 0;
  if (term.includes('first') || term === '1' || term === 'term1') return 1;
  if (term.includes('second') || term === '2' || term === 'term2') return 2;
  if (term.includes('third') || term === '3' || term === 'term3') return 3;
  return 0;
}

function feeMatchesAccountPeriod(fee, app) {
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appBillingCategory = app.BillingCategory || 'Regular';
  const appSession = app.AcademicSession || '';
  const appTerm = app.Term || '';
  if (!feeFieldMatches(fee.ClassName, appClass)) return false;
  if (!feeFieldMatches(fee.StudentType, appType)) return false;
  if (!feeFieldMatches(fee.BillingCategory || 'All', appBillingCategory, true)) return false;
  if (!feeFieldMatches(fee.AcademicSession, appSession, true)) return false;
  const feeTerm = normalizeMatchText(fee.Term || 'All');
  if (!feeTerm || feeTerm === 'all' || feeTerm === '*') return true;
  const feeTermRank = termRank(fee.Term);
  const appTermRank = termRank(appTerm);
  if (feeTermRank && appTermRank) return feeTermRank <= appTermRank;
  return feeFieldMatches(fee.Term, appTerm, true);
}

function feeBillingSpecificity(fee, app) {
  const rule = normalizeMatchText(fee.BillingCategory || 'All');
  const actual = normalizeMatchText(app.BillingCategory || 'Regular');
  if (!rule || rule === 'all' || rule === '*') return 0;
  return feeFieldMatches(fee.BillingCategory, actual || 'Regular', true) ? 2 : 0;
}

function feeOverrideKey(fee) {
  return [
    normalizeMatchText(fee.FeeName || fee.FeeCode || ''),
    normalizeMatchText(fee.FeeCategory || ''),
    normalizeMatchText(fee.ClassName || 'All'),
    normalizeMatchText(fee.StudentType || 'All'),
    normalizeMatchText(fee.AcademicSession || 'All'),
    normalizeMatchText(fee.Term || 'All')
  ].join('||');
}

function applyBillingCategoryOverrides(fees, app) {
  const grouped = {};
  fees.forEach((fee) => {
    const key = feeOverrideKey(fee);
    grouped[key] = grouped[key] || [];
    grouped[key].push(fee);
  });
  const result = [];
  Object.values(grouped).forEach((items) => {
    const bestSpecificity = Math.max(...items.map((item) => feeBillingSpecificity(item, app)));
    items.forEach((item) => {
      if (feeBillingSpecificity(item, app) === bestSpecificity) result.push(item);
    });
  });
  return result;
}

function isWalletFee(fee) {
  return clean(fee && fee.FeeCode) === 'WALLET_TOPUP' || normalizeMatchText(fee && fee.FeeCategory) === 'wallet';
}

function isOptionalSubscriptionFee(fee) {
  const category = normalizeMatchText(fee && fee.FeeCategory);
  if (['bus service', 'transport', 'club', 'optional', 'others'].includes(category)) return true;
  const feeCode = clean(fee && fee.FeeCode).toUpperCase();
  const feeName = normalizeMatchText(fee && fee.FeeName);
  const description = normalizeMatchText(fee && fee.Description);
  const reference = clean(fee && fee.Reference).toUpperCase();
  const metadata = parseMetadata(fee && fee.Metadata);
  const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  const metadataCategory = normalizeMatchText(metadata.feeCategory || nested.feeCategory);
  const metadataCode = clean(metadata.feeCode || nested.feeCode).toUpperCase();
  if (['bus service', 'transport', 'club', 'optional', 'others'].includes(metadataCategory)) return true;
  if (/^(BUS|CLUB|TRANSPORT|OPTIONAL)[_-]/.test(feeCode) || /[-_](BUS|CLUB|TRANSPORT|OPTIONAL)[_-]/.test(reference)) return true;
  if (/^(BUS|CLUB|TRANSPORT|OPTIONAL)[_-]/.test(metadataCode)) return true;
  return feeName.includes('bus service') ||
    feeName.includes('bus route') ||
    feeName.includes('paid club') ||
    feeName.includes('club subscription') ||
    description.includes('bus service') ||
    description.includes('bus route') ||
    description.includes('paid club') ||
    description.includes('club subscription');
}

function isWalletLedger(row) {
  return clean(row && row.FeeCode).toUpperCase() === 'WALLET_TOPUP' ||
    normalizeMatchText(row && row.FeeCategory) === 'wallet' ||
    normalizeMatchText(row && row.EntryType).includes('wallet');
}

function periodKey(key, session, term) {
  const cleanKey = clean(key);
  if (!cleanKey) return '';
  return [cleanKey, normalizeMatchText(session || ''), normalizeMatchText(term || '')].join('||');
}

function isPeriodSpecificFee(fee) {
  const session = normalizeMatchText(fee.AcademicSession || '');
  const term = normalizeMatchText(fee.Term || '');
  return Boolean((session && session !== 'all' && session !== '*') || (term && term !== 'all' && term !== '*'));
}

function periodMatchesFee(row, fee) {
  const feeSession = normalizeMatchText(fee.AcademicSession || '');
  const feeTerm = normalizeMatchText(fee.Term || '');
  const rowSession = normalizeMatchText(row.AcademicSession || '');
  const rowTerm = normalizeMatchText(row.Term || '');
  if (feeSession && feeSession !== 'all' && feeSession !== '*' && rowSession && rowSession !== feeSession) return false;
  if (feeTerm && feeTerm !== 'all' && feeTerm !== '*' && rowTerm && rowTerm !== feeTerm) return false;
  return true;
}

function feeMatchesAccountBase(fee, app) {
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appBillingCategory = app.BillingCategory || 'Regular';
  const appSession = app.AcademicSession || '';
  return feeFieldMatches(fee.ClassName, appClass) &&
    feeFieldMatches(fee.StudentType, appType) &&
    feeFieldMatches(fee.BillingCategory || 'All', appBillingCategory, true) &&
    feeFieldMatches(fee.AcademicSession, appSession, true);
}

function parseFeeItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function isSchoolFeesTotalPayment(row) {
  const feeCode = clean(row && row.FeeCode).toUpperCase();
  const feeName = normalizeMatchText(row && row.FeeName);
  const description = normalizeMatchText(row && row.Description);
  if (feeCode === 'SCHOOL_FEES_TOTAL') return true;
  if (feeName === 'school fees total' || description === 'school fees total') return true;
  const metadata = parseMetadata(row && row.Metadata);
  const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  return normalizeMatchText(metadata.paymentType || nested.paymentType) === 'schoolfeestotal';
}

function isGeneralFeeCredit(row) {
  if (!row || isWalletLedger(row) || isAcceptanceFeeLike(row) || isSchoolFeesTotalPayment(row)) return false;
  const feeCode = normalizeMatchText(row.FeeCode);
  const feeName = normalizeMatchText(row.FeeName);
  const description = normalizeMatchText(row.Description);
  const category = normalizeMatchText(row.FeeCategory);
  const compactCode = normalizeReferenceText(row.FeeCode);
  const compactName = normalizeReferenceText(row.FeeName);
  const compactDescription = normalizeReferenceText(row.Description);
  if (['manualpayment', 'generalpayment', 'accountcredit', 'feecredit', 'credittransferin', 'creditadjustment'].includes(compactCode)) return true;
  if (['manual_payment', 'general_payment', 'account_credit', 'fee_credit', 'credit_transfer_in', 'credit_adjustment'].includes(feeCode)) return true;
  if (!category && ['payment', 'manualpayment', 'generalpayment', 'accountcredit', 'feecredit'].includes(compactName || compactDescription)) return true;
  return false;
}

async function findStudentForApplication(env, app) {
  const students = (await listCollection(env, 'students')).map(normalizeStudent);
  const refs = [
    accountRefFromApplication(app),
    app.ApplicationReference,
    app.ApplicationID,
    app.AdmissionNo,
    app.AdmissionNumber
  ].map(clean).filter(Boolean);
  let found = students.find((student) => refs.some((ref) => {
    return referencesMatch(student.AdmissionNo, ref) ||
      referencesMatch(student.ApplicationReference, ref) ||
      sameText(student.AdmissionNo, ref) ||
      sameText(student.ApplicationReference, ref);
  }));
  if (found) return found;
  const appName = normalizeReferenceText(displayNameFromApplication(app));
  const appEmail = normalizeMatchText(app.VerificationEmail || app.ParentEmail || app.Email || '');
  if (!appName || !appEmail) return null;
  found = students.find((student) => {
    const studentName = normalizeReferenceText(student.DisplayName || student.ApplicantName || '');
    const studentEmail = normalizeMatchText(student.ParentEmail || student.Email || '');
    return studentName === appName && studentEmail === appEmail;
  });
  return found || null;
}

async function getAppsScriptPayableFees(env, body = {}) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'getPayableFees',
      Email: body.Email || body.email,
      VerificationCode: body.VerificationCode || body.code,
      AccountRef: body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo
    })
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data && data.ok ? { ...data, backend: 'apps-script' } : data;
  } catch (_err) {
    return {
      ok: false,
      message: 'Google Sheets fee lookup did not return JSON. Confirm the Apps Script deployment is current.'
    };
  }
}

async function getAppsScriptAccountsOverview(env) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'getAccountsOverview'
    })
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data && data.ok ? data : null;
  } catch (_err) {
    return null;
  }
}

async function getAppsScriptApplications(env) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return [];
  const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
  url.searchParams.set('action', 'getApplications');
  try {
    const response = await fetch(url.toString());
    const text = await response.text();
    const data = JSON.parse(text);
    return data && data.ok && Array.isArray(data.applications) ? data.applications : [];
  } catch (_err) {
    return [];
  }
}

async function getAppsScriptStudents(env) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return [];
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getStudents'
      })
    });
    const text = await response.text();
    const data = JSON.parse(text);
    return data && data.ok && Array.isArray(data.students) ? data.students : [];
  } catch (_err) {
    return [];
  }
}

async function getAppsScriptFormSales(env) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return [];
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getFormSales'
      })
    });
    const text = await response.text();
    const data = JSON.parse(text);
    return data && data.ok && Array.isArray(data.sales) ? data.sales : [];
  } catch (_err) {
    return [];
  }
}

export async function getPayableFees(env, body = {}) {
  const email = lower(body.Email || body.email);
  const code = clean(body.VerificationCode || body.code).toUpperCase();
  const requestedAccountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  if (!email || !code) {
    const err = new Error('Email and verification code are required.');
    err.status = 400;
    throw err;
  }

  const [firestoreApplications, sheetApplications, firestoreStudents, sheetStudents, firestoreSales, sheetSales] = await Promise.all([
    listCollection(env, 'applications').catch(() => []),
    getAppsScriptApplications(env),
    listCollection(env, 'students').catch(() => []),
    getAppsScriptStudents(env),
    listCollection(env, 'formSales').catch(() => []),
    getAppsScriptFormSales(env)
  ]);
  const applications = [...firestoreApplications, ...sheetApplications].map(normalizeApplication);
  const students = [...firestoreStudents, ...sheetStudents].map(normalizeStudent);
  const sales = [...firestoreSales, ...sheetSales];
  const loginApp = applications.find((row) => lower(row.VerificationEmail || row.Email || row.ParentEmail) === email && clean(row.VerificationCode).toUpperCase() === code);
  const loginStudent = students.find((row) => lower(row.ParentEmail || row.Email || row.VerificationEmail) === email && studentLoginCode(row) === code);
  const saleMatch = sales.some((row) => {
    return lower(pick(row, ['Email', 'email'])) === email &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === code;
  });
  if (!loginApp && !loginStudent && !saleMatch) {
    const err = new Error('Application not found for that email/code.');
    err.status = 404;
    throw err;
  }

  let app = loginApp;
  let accountRef = requestedAccountRef || accountRefFromApplication(loginApp || {}) || loginStudent?.AdmissionNo || loginStudent?.AccountRef || '';
  let student = requestedAccountRef ? findStudentByAccountRefInRows(students, requestedAccountRef) : (loginStudent || null);
  let selectedApplication = null;
  if (requestedAccountRef) {
    selectedApplication = applications.find((row) => {
      return sameText(row.ApplicationReference || row.ApplicationID || row.__id, requestedAccountRef) ||
        referencesMatch(row.ApplicationReference || row.ApplicationID || row.__id, requestedAccountRef) ||
        sameText(row.AdmissionNo || row.AdmissionNumber, requestedAccountRef) ||
        referencesMatch(row.AdmissionNo || row.AdmissionNumber, requestedAccountRef);
    }) || null;
  }
  if (student) {
    const parentEmailMatches = lower(student.ParentEmail || student.Email) === email;
    const studentAppRef = clean(student.ApplicationReference);
    const linkedApplication = studentAppRef ? applications.find((row) => sameText(row.ApplicationReference || row.ApplicationID || row.__id, studentAppRef) || referencesMatch(row.ApplicationReference || row.ApplicationID || row.__id, studentAppRef)) : null;
    const linkedEmailMatches = linkedApplication && [linkedApplication.VerificationEmail, linkedApplication.ParentEmail, linkedApplication.Email]
      .some((value) => lower(value) === email);
    const selectedEmailMatches = selectedApplication && [selectedApplication.VerificationEmail, selectedApplication.ParentEmail, selectedApplication.Email]
      .some((value) => lower(value) === email);
    if (!parentEmailMatches && !linkedEmailMatches && !selectedEmailMatches && !saleMatch) {
      const err = new Error('The selected student is not linked to this parent email.');
      err.status = 403;
      throw err;
    }
    if (linkedApplication) {
      app = linkedApplication;
    } else if (selectedApplication) {
      app = selectedApplication;
    }
  } else if (selectedApplication) {
    const selectedEmailMatches = [selectedApplication.VerificationEmail, selectedApplication.ParentEmail, selectedApplication.Email]
      .some((value) => lower(value) === email);
    if (!selectedEmailMatches) {
      const err = new Error('The selected applicant is not linked to this parent email.');
      err.status = 403;
      throw err;
    }
    app = selectedApplication;
  }
  if (!app && student) {
    app = {
      ApplicationReference: student.ApplicationReference || student.AdmissionNo || student.AccountRef,
      ApplicationID: student.ApplicationReference || student.AdmissionNo || student.AccountRef,
      ApplicantName: student.DisplayName || student.ApplicantName,
      ClassApplyingFor: student.ClassAdmitted || student.ClassName,
      ClassAdmitted: student.ClassAdmitted || student.ClassName,
      StudentType: student.StudentType,
      BillingCategory: student.BillingCategory || 'Regular',
      AcademicSession: student.AcademicSession,
      Term: student.Term,
      AdmissionNo: student.AdmissionNo || student.AccountRef,
      Status: student.Status || 'Active',
      ResultStatus: student.Status || '',
      ParentEmail: student.ParentEmail,
      VerificationEmail: email,
      VerificationCode: code
    };
  }
  if (!app) {
    const err = new Error('Selected child is not linked to an application or student account.');
    err.status = 404;
    throw err;
  }
  if (!student) student = await findStudentForApplication(env, app);
  if (student) accountRef = student.AdmissionNo || student.AccountRef || student.ApplicationReference || accountRef;
  const billingApp = { ...app };
  if (student) {
    if (student.ClassAdmitted || student.ClassName) {
      billingApp.ClassApplyingFor = student.ClassAdmitted || student.ClassName;
      billingApp.ClassAdmitted = student.ClassAdmitted || student.ClassName;
    }
    if (student.AcademicSession) billingApp.AcademicSession = student.AcademicSession;
    if (student.Term) billingApp.Term = student.Term;
    if (student.StudentType) billingApp.StudentType = student.StudentType;
    if (student.BillingCategory) billingApp.BillingCategory = student.BillingCategory;
    if (student.AdmissionNo) billingApp.AdmissionNo = student.AdmissionNo;
    if (student.DisplayName || student.ApplicantName) billingApp.ApplicantName = student.DisplayName || student.ApplicantName;
  }

  const accountRefs = new Set([
    accountRef,
    app.ApplicationReference,
    app.ApplicationID,
    app.AdmissionNo,
    app.AdmissionNumber,
    billingApp.ApplicationReference,
    billingApp.ApplicationID,
    billingApp.AdmissionNo,
    billingApp.AdmissionNumber
  ].map(clean).filter(Boolean));
  const rowMatchesAccount = (row) => {
    return [...accountRefs].some((ref) => {
      return sameText(row.AccountRef, ref) ||
        sameText(row.ApplicationReference, ref) ||
        sameText(row.AdmissionNo, ref) ||
        referencesMatch(row.AccountRef, ref) ||
        referencesMatch(row.ApplicationReference, ref) ||
        referencesMatch(row.AdmissionNo, ref);
    });
  };

  let [feeRows, paymentRows, invoiceRows, ledgerRows] = await Promise.all([
    listCollection(env, 'feeItems'),
    listCollection(env, 'payments'),
    listCollection(env, 'invoices'),
    listCollection(env, 'ledger')
  ]);
  if (!feeRows.length) {
    const sheetFinance = await getAppsScriptAccountsOverview(env);
    if (sheetFinance) {
      feeRows = sheetFinance.feeItems || [];
      paymentRows = [
        ...(paymentRows || []),
        ...(sheetFinance.payments || [])
      ];
      invoiceRows = [
        ...(invoiceRows || []),
        ...(sheetFinance.invoices || [])
      ];
      ledgerRows = [
        ...(ledgerRows || []),
        ...(sheetFinance.ledger || [])
      ];
    } else {
      const sheetData = await getAppsScriptPayableFees(env, body);
      if (sheetData) return sheetData;
    }
  }
  const allFees = feeRows.map(normalizeFeeItem)
    .filter((row) => yesNo(row.Active) === 'YES')
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  const enrolledForBilling = Boolean(student) || yesNo(app.Enrolled) === 'YES' || normalizeMatchText(app.Status) === 'enrolled';
  const applicationStatus = normalizeMatchText(app.Status);
  const resultStatus = normalizeMatchText(app.ResultStatus);
  const admittedForPreEnrollment = resultStatus === 'admitted' || ['admitted', 'accepted', 'admission letter sent'].includes(applicationStatus);
  const applicationCreatedAt = timestampMs(app.SubmittedAt || app.CreatedAt || app.UpdatedAt);
  const notStaleForApplication = (row) => {
    if (!applicationCreatedAt) return true;
    const rowTime = timestampMs(row.RawDate || row.Date);
    return !rowTime || rowTime >= applicationCreatedAt;
  };
  const acceptanceAlreadyPaid = yesNo(app.AcceptanceFeePaid) === 'YES' ||
    ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).filter(notStaleForApplication).some((row) => {
      if (asMoneyNumber(row.Credit) <= 0) return false;
      return isAcceptanceFeeLike(row);
    });
  const matchedFees = applyBillingCategoryOverrides(allFees.filter((fee) => {
    const amount = asMoneyNumber(fee.Amount);
    const category = normalizeMatchText(fee.FeeCategory || '');
    const requiredForEnrollment = yesNo(fee.RequiredForEnrollment) === 'YES';
    const isAcceptanceFee = clean(fee.FeeCode).toUpperCase() === 'ACCEPTANCE_FEE' || normalizeMatchText(fee.FeeName) === 'acceptance fee';
    if (!isWalletFee(fee) && amount <= 0) return false;
    if (yesNo(fee.PayableOnline || 'YES') !== 'YES') return false;
    if (!feeMatchesApplication(fee, billingApp)) return false;
    if (isAcceptanceFee) {
      if (acceptanceAlreadyPaid) return false;
      return admittedForPreEnrollment && yesNo(app.OfferSent) === 'YES';
    }
    if (!enrolledForBilling) {
      if (!admittedForPreEnrollment || yesNo(app.OfferSent) !== 'YES') return false;
      return category === 'admission' || requiredForEnrollment;
    }
    return true;
  }), billingApp);

  const feeBalanceMap = {};
  const paymentCodeMap = {};
  const paymentNameMap = {};
  const paidLedgerRows = [];
  const addPaid = (map, key, amount) => {
    const cleanKey = clean(key);
    const paidAmount = asMoneyNumber(amount);
    if (!cleanKey || paidAmount <= 0) return;
    map[cleanKey] = (map[cleanKey] || 0) + paidAmount;
  };
  const addBalanceCredit = (key, amount, session = '', term = '') => {
    const cleanKey = clean(key);
    if (!cleanKey) return;
    feeBalanceMap[cleanKey] = feeBalanceMap[cleanKey] || { credit: 0 };
    feeBalanceMap[cleanKey].credit += asMoneyNumber(amount);
    const scopedKey = periodKey(cleanKey, session, term);
    feeBalanceMap[scopedKey] = feeBalanceMap[scopedKey] || { credit: 0 };
    feeBalanceMap[scopedKey].credit += asMoneyNumber(amount);
  };

  invoiceRows.map(normalizeInvoice).filter(rowMatchesAccount).forEach((row) => {
    if (normalizeMatchText(row.Status) === 'paid') {
      addBalanceCredit(row.FeeCode || row.FeeName, row.Debit || row.Balance, row.AcademicSession, row.Term);
    }
  });
  ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).filter(notStaleForApplication).forEach((row) => {
    if (isWalletLedger(row)) return;
    const credit = asMoneyNumber(row.Credit);
    if (credit <= 0) return;
    paidLedgerRows.push(row);
    addPaid(paymentCodeMap, row.FeeCode, credit);
    addPaid(paymentNameMap, row.FeeName, credit);
    addPaid(paymentNameMap, row.Description, credit);
    addPaid(paymentCodeMap, periodKey(row.FeeCode, row.AcademicSession, row.Term), credit);
    addPaid(paymentNameMap, periodKey(row.FeeName, row.AcademicSession, row.Term), credit);
    addPaid(paymentNameMap, periodKey(row.Description, row.AcademicSession, row.Term), credit);
  });
  const currentWalletBalance = ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).reduce((sum, row) => {
    if (!isWalletLedger(row)) return sum;
    return sum + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit);
  }, 0);
  const accountCreditDebits = ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).filter(notStaleForApplication).reduce((sum, row) => {
    if (isWalletLedger(row)) return sum;
    if (normalizeMatchText(row.FeeCategory) !== 'account credit') return sum;
    return sum + asMoneyNumber(row.Debit);
  }, 0);

  let acceptanceCreditRemaining = enrolledForBilling && acceptanceAlreadyPaid ? asMoneyNumber(app.AcceptanceFeeAmount) : 0;
  if (acceptanceCreditRemaining <= 0 && enrolledForBilling) {
    acceptanceCreditRemaining = Math.max(asMoneyNumber(paymentCodeMap.ACCEPTANCE_FEE), asMoneyNumber(paymentNameMap['Acceptance Fee']));
  }
  const currentTermRank = termRank(billingApp.Term);
  const currentSession = normalizeMatchText(billingApp.AcademicSession || '');
  const rowSessionApplies = (row) => {
    const rowSession = normalizeMatchText(row.AcademicSession || '');
    return !currentSession || !rowSession || rowSession === currentSession || rowSession === 'all' || rowSession === '*';
  };
  const rowIsCurrentPeriod = (row) => {
    const rowTermRank = termRank(row.Term);
    if (!rowSessionApplies(row)) return false;
    if (!currentTermRank) return true;
    return rowTermRank === currentTermRank;
  };
  const priorSchoolFeeCharge = currentTermRank ? applyBillingCategoryOverrides(allFees.filter((fee) => {
    if (yesNo(fee.Active) !== 'YES') return false;
    if (isWalletFee(fee) || isAcceptanceFeeLike(fee)) return false;
    if (normalizeMatchText(fee.FeeCategory || 'School Fee') !== 'school fee') return false;
    const feeRank = termRank(fee.Term);
    return feeRank && feeRank < currentTermRank && feeMatchesAccountBase(fee, billingApp);
  }), billingApp).reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0) : 0;
  const schoolFeeRelatedCredit = currentTermRank ? paidLedgerRows.reduce((sum, row) => {
    const schoolRelated = isAcceptanceFeeLike(row) ||
      isSchoolFeesTotalPayment(row) ||
      normalizeMatchText(row.FeeCategory) === 'school fee' ||
      isGeneralFeeCredit(row);
    return schoolRelated ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0) : 0;
  const currentPeriodSchoolFeeCredit = currentTermRank ? paidLedgerRows.reduce((sum, row) => {
    const schoolRelated = isSchoolFeesTotalPayment(row) ||
      normalizeMatchText(row.FeeCategory) === 'school fee' ||
      isGeneralFeeCredit(row);
    return schoolRelated && rowIsCurrentPeriod(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0) : 0;
  const carryForwardSchoolCredit = Math.max(0, schoolFeeRelatedCredit - currentPeriodSchoolFeeCredit - priorSchoolFeeCharge - accountCreditDebits);
  if (currentTermRank > 1) {
    acceptanceCreditRemaining = 0;
  }
  let schoolFeesTotalCreditRemaining = paidLedgerRows.reduce((sum, row) => {
    return isSchoolFeesTotalPayment(row) && rowIsCurrentPeriod(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, carryForwardSchoolCredit);
  let generalFeeCreditRemaining = paidLedgerRows.reduce((sum, row) => {
    return isGeneralFeeCredit(row) && rowIsCurrentPeriod(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0);
  const priorSchoolFeeBalance = Math.max(0, priorSchoolFeeCharge + accountCreditDebits - (schoolFeeRelatedCredit - currentPeriodSchoolFeeCredit));

  const fees = matchedFees.map((fee) => {
    const copy = { ...fee };
    const originalAmount = asMoneyNumber(copy.Amount);
    const optionalSubscription = isOptionalSubscriptionFee(copy);
    const feeCode = clean(copy.FeeCode);
    const feeName = clean(copy.FeeName || feeCode);
    const codePeriodKey = periodKey(feeCode, copy.AcademicSession, copy.Term);
    const namePeriodKey = periodKey(feeName, copy.AcademicSession, copy.Term);
    const periodSpecific = isPeriodSpecificFee(copy);
    const scopedCodePaid = Math.max(asMoneyNumber(paymentCodeMap[codePeriodKey]), asMoneyNumber((feeBalanceMap[codePeriodKey] || {}).credit));
    const scopedNamePaid = Math.max(asMoneyNumber(paymentNameMap[namePeriodKey]), asMoneyNumber((feeBalanceMap[namePeriodKey] || {}).credit));
    const exactCodePaid = Math.max(scopedCodePaid, periodSpecific ? 0 : asMoneyNumber(paymentCodeMap[feeCode]), periodSpecific ? 0 : asMoneyNumber((feeBalanceMap[feeCode] || {}).credit));
    const feeNamePaid = Math.max(scopedNamePaid, periodSpecific ? 0 : asMoneyNumber(paymentNameMap[feeName]), periodSpecific ? 0 : asMoneyNumber((feeBalanceMap[feeName] || {}).credit));
    const ledgerMatchedPaid = paidLedgerRows.reduce((sum, row) => {
      if (!periodMatchesFee(row, copy)) return sum;
      const rowCode = normalizeMatchText(row.FeeCode);
      const rowName = normalizeMatchText(row.FeeName);
      const rowDescription = normalizeMatchText(row.Description);
      const rowCategory = normalizeMatchText(row.FeeCategory);
      const feeCategory = normalizeMatchText(copy.FeeCategory);
      const codeMatches = rowCode && rowCode === normalizeMatchText(feeCode);
      const nameMatches = normalizeMatchText(feeName) && [rowName, rowDescription].includes(normalizeMatchText(feeName));
      const categoryAmountMatches = feeCategory && feeCategory === rowCategory && Math.abs(asMoneyNumber(row.Credit) - originalAmount) < 0.01;
      return (codeMatches || nameMatches || categoryAmountMatches) ? sum + asMoneyNumber(row.Credit) : sum;
    }, 0);
    let paid = optionalSubscription ? 0 : Math.max(exactCodePaid, feeNamePaid, ledgerMatchedPaid);
    const acceptanceCreditApplied = (!optionalSubscription && !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && acceptanceCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), acceptanceCreditRemaining)
      : 0;
    if (acceptanceCreditApplied > 0) {
      paid += acceptanceCreditApplied;
      acceptanceCreditRemaining -= acceptanceCreditApplied;
    }
    const schoolFeesTotalCreditApplied = (!optionalSubscription && !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && schoolFeesTotalCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), schoolFeesTotalCreditRemaining)
      : 0;
    if (schoolFeesTotalCreditApplied > 0) {
      paid += schoolFeesTotalCreditApplied;
      schoolFeesTotalCreditRemaining -= schoolFeesTotalCreditApplied;
    }
    const generalFeeCreditApplied = (!optionalSubscription && !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && generalFeeCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), generalFeeCreditRemaining)
      : 0;
    if (generalFeeCreditApplied > 0) {
      paid += generalFeeCreditApplied;
      generalFeeCreditRemaining -= generalFeeCreditApplied;
    }
    const walletLimit = isWalletFee(fee) ? asMoneyNumber(copy.MaxAmount) : 0;
    const walletTopupRemaining = walletLimit > 0 ? Math.max(0, walletLimit - currentWalletBalance) : originalAmount;
    const balance = optionalSubscription ? originalAmount : (isWalletFee(fee) ? walletTopupRemaining : Math.max(0, originalAmount - paid));
    copy.OriginalAmount = originalAmount;
    copy.PaidAmount = paid;
    copy.AcceptanceCreditApplied = acceptanceCreditApplied;
    copy.SchoolFeesTotalCreditApplied = schoolFeesTotalCreditApplied;
    copy.GeneralFeeCreditApplied = generalFeeCreditApplied;
    copy.BalanceAmount = balance;
    if (!isWalletFee(fee)) {
      copy.Amount = balance;
    } else if (walletLimit > 0) {
      copy.Amount = balance;
      copy.MaxAmount = balance;
      copy.WalletLimit = walletLimit;
      copy.WalletBalance = currentWalletBalance;
      copy.WalletLimitReached = balance <= 0 ? 'YES' : 'NO';
    }
    if (asMoneyNumber(copy.MinAmount) > balance) copy.MinAmount = balance;
    if (asMoneyNumber(copy.MaxAmount) <= 0 || asMoneyNumber(copy.MaxAmount) > balance) copy.MaxAmount = balance;
    copy.PaymentType = isWalletFee(fee) ? 'Wallet' : 'Fee';
    copy.AppliesTo = [copy.ClassName || 'All', copy.StudentType || 'All', copy.AcademicSession || 'All', copy.Term || 'All'].join(' / ');
    return copy;
  }).filter((fee) => isWalletFee(fee) || asMoneyNumber(fee.Amount) > 0);

  if (priorSchoolFeeBalance > 0 && currentTermRank > 1) {
    const firstSchoolFee = fees.find((fee) => !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee') || matchedFees.find((fee) => normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee') || {};
    fees.unshift({
      FeeCode: 'PREVIOUS_SCHOOL_FEE_BALANCE',
      FeeName: 'Previous Balance',
      FeeCategory: 'School Fee',
      Amount: priorSchoolFeeBalance,
      OriginalAmount: priorSchoolFeeBalance,
      PaidAmount: 0,
      BalanceAmount: priorSchoolFeeBalance,
      Currency: firstSchoolFee.Currency || 'NGN',
      PayableOnline: 'YES',
      AllowInstallment: 'NO',
      MinAmount: '',
      MaxAmount: priorSchoolFeeBalance,
      AcademicSession: billingApp.AcademicSession || firstSchoolFee.AcademicSession || '',
      Term: billingApp.Term || firstSchoolFee.Term || '',
      DueDate: firstSchoolFee.DueDate || '',
      PaymentType: 'Fee',
      AppliesTo: 'Previous unpaid school fee balance'
    });
  }

  const schoolFeeBreakdown = fees.filter((fee) => !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee');
  const schoolFeeTotal = schoolFeeBreakdown.reduce((total, fee) => total + asMoneyNumber(fee.Amount), 0);
  return {
    ok: true,
    message: 'Payable fees loaded from Firestore.',
    account: {
      AccountRef: accountRef,
      ApplicationReference: billingApp.ApplicationReference || app.ApplicationReference || '',
      AdmissionNo: billingApp.AdmissionNo || billingApp.AdmissionNumber || app.AdmissionNo || app.AdmissionNumber || '',
      DisplayName: displayNameFromApplication(billingApp),
      ClassName: billingApp.ClassApplyingFor || billingApp.ClassAdmitted || '',
      StudentType: billingApp.StudentType || '',
      BillingCategory: billingApp.BillingCategory || app.BillingCategory || 'Regular',
      AcademicSession: billingApp.AcademicSession || '',
      Term: billingApp.Term || '',
      Email: app.VerificationEmail || email,
      BillingSource: student ? 'Students' : 'Applications'
    },
    fees,
    schoolFeeBreakdown,
    schoolFeeTotal
  };
}

export async function getAccountsOverview(env) {
  const [accounts, payments, invoices, feeItems, storedLedger, applications, students, settings] = await Promise.all([
    listCollection(env, 'accounts'),
    listCollection(env, 'payments'),
    listCollection(env, 'invoices'),
    listCollection(env, 'feeItems'),
    listCollection(env, 'ledger'),
    listCollection(env, 'applications'),
    listCollection(env, 'students'),
    listCollection(env, 'settings')
  ]);
  const schoolProfile = settings.find((row) => row.__id === 'schoolProfile') || settings.find((row) => clean(row.SchoolName)) || {};
  const normalizedPayments = payments.map(normalizePayment);
  const normalizedInvoices = invoices.map(normalizeInvoice);
  const normalizedStoredLedger = storedLedger.map(normalizeLedger);
  const accountMap = new Map();
  const accountAliasMap = new Map();
  const accountKeyForRefs = (refs, fallback) => {
    for (const ref of refs) {
      const alias = accountAliasMap.get(safeDocumentId(ref).toLowerCase());
      if (alias) return alias;
    }
    return safeDocumentId(fallback || refs[0]).toLowerCase();
  };
  const registerAccountAliases = (key, refs) => {
    refs.forEach((ref) => {
      const alias = safeDocumentId(ref).toLowerCase();
      if (alias) accountAliasMap.set(alias, key);
    });
  };
  const putAccount = (row) => {
    const normalized = normalizeAccount(row || {});
    const refs = accountRefsFrom(normalized);
    const accountRef = clean(normalized.AccountRef || refs[0]);
    if (!accountRef) return;
    const key = accountKeyForRefs(refs, accountRef);
    const existing = accountMap.get(key) || {};
    accountMap.set(key, {
      ...existing,
      ...normalized,
      AccountRef: clean(existing.AccountRef || normalized.AccountRef || accountRef),
      ApplicationReference: clean(existing.ApplicationReference || normalized.ApplicationReference),
      AdmissionNo: clean(existing.AdmissionNo || normalized.AdmissionNo),
      DisplayName: clean(existing.DisplayName || normalized.DisplayName),
      ClassName: clean(existing.ClassName || normalized.ClassName),
      StudentType: clean(existing.StudentType || normalized.StudentType),
      BillingCategory: clean(existing.BillingCategory || normalized.BillingCategory) || 'Regular',
      AcademicSession: clean(existing.AcademicSession || normalized.AcademicSession),
      Term: clean(existing.Term || normalized.Term),
      Status: clean(existing.Status || normalized.Status),
      ResultStatus: clean(existing.ResultStatus || normalized.ResultStatus),
      OfferSent: clean(existing.OfferSent || normalized.OfferSent),
      Enrolled: clean(existing.Enrolled || normalized.Enrolled),
      AdmissionLetterSent: clean(existing.AdmissionLetterSent || normalized.AdmissionLetterSent)
    });
    registerAccountAliases(key, accountRefsFrom(accountMap.get(key)));
  };
  const applicationCreatedMap = new Map();
  applications.map((row) => normalizeApplication(row, schoolProfile)).forEach((app) => {
    const refs = accountRefsFrom(app);
    const createdAt = timestampMs(app.SubmittedAt || app.CreatedAt || app.UpdatedAt);
    refs.forEach((ref) => {
      const key = safeDocumentId(ref).toLowerCase();
      if (key && createdAt) applicationCreatedMap.set(key, createdAt);
    });
  });
  accounts.map(normalizeAccount).forEach(putAccount);
  students.map((row) => normalizeStudent(row, schoolProfile)).forEach((student) => putAccount({
    AccountRef: student.AdmissionNo || student.ApplicationReference,
    ApplicationReference: student.ApplicationReference,
    AdmissionNo: student.AdmissionNo,
    DisplayName: student.DisplayName || student.ApplicantName,
    ClassName: student.ClassName || student.ClassAdmitted,
    StudentType: student.StudentType,
    BillingCategory: student.BillingCategory,
    AcademicSession: student.AcademicSession,
    Term: student.Term,
    Status: student.Status || 'Active',
    Enrolled: 'YES'
  }));
  applications.map((row) => normalizeApplication(row, schoolProfile)).forEach((app) => putAccount({
    AccountRef: app.AdmissionNo || app.AdmissionNumber || app.ApplicationReference || app.ApplicationID,
    ApplicationReference: app.ApplicationReference || app.ApplicationID,
    AdmissionNo: app.AdmissionNo || app.AdmissionNumber,
    DisplayName: displayNameFromApplication(app),
    ClassName: app.ClassApplyingFor || app.ClassAdmitted,
    StudentType: app.StudentType,
    BillingCategory: app.BillingCategory || 'Regular',
    AcademicSession: app.AcademicSession,
    Term: app.Term,
    Status: app.Status,
    ResultStatus: app.ResultStatus,
    OfferSent: app.OfferSent,
    Enrolled: app.Enrolled,
    AdmissionLetterSent: app.AdmissionLetterSent
  }));
  [...normalizedInvoices, ...normalizedStoredLedger].forEach((row) => putAccount({
    AccountRef: row.AccountRef || row.AdmissionNo || row.ApplicationReference,
    ApplicationReference: row.ApplicationReference,
    AdmissionNo: row.AdmissionNo,
    DisplayName: row.DisplayName,
    ClassName: row.ClassName,
    StudentType: row.StudentType,
    BillingCategory: row.BillingCategory,
    AcademicSession: row.AcademicSession,
    Term: row.Term,
    Status: 'Active'
  }));
  const ledger = [
    ...normalizedStoredLedger,
    ...normalizedInvoices.map((row) => ({
      AccountRef: row.AccountRef,
      Date: row.Date,
      EntryType: 'Invoice',
      FeeCategory: row.FeeCategory,
      Description: row.FeeName,
      Debit: row.Debit,
      Credit: 0,
      Reference: row.InvoiceId,
      RecordedBy: ''
    })),
  ];
  const ledgerRows = ledger.map(normalizeLedger);
  const normalizedFeeItems = feeItems.map(normalizeFeeItem);
  const accountRows = Array.from(accountMap.values()).map((account) => {
    const refs = accountRefsFrom(account);
    let totalDebit = 0;
    let totalCredit = 0;
    let accountCreditDebit = 0;
    let walletBalance = asMoneyNumber(account.WalletBalance);
    let lastPaymentAt = clean(account.LastPaymentAt);
    const countedLedgerKeys = new Set();
    ledgerRows.forEach((row) => {
      const rowRefs = accountRefsFrom(row);
      const matched = rowRefs.some((ref) => referencesAny(ref, refs));
      if (!matched) return;
      const ledgerKey = clean(row.LedgerNo || row.Reference || `${row.Date}|${row.AccountRef}|${row.FeeCode}|${row.Debit}|${row.Credit}`);
      if (ledgerKey && countedLedgerKeys.has(ledgerKey)) return;
      if (ledgerKey) countedLedgerKeys.add(ledgerKey);
      const accountCreatedAt = refs
        .map((ref) => applicationCreatedMap.get(safeDocumentId(ref).toLowerCase()) || 0)
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || 0;
      if (accountCreatedAt && timestampMs(row.RawDate || row.Date) && timestampMs(row.RawDate || row.Date) < accountCreatedAt) return;
      const debit = asMoneyNumber(row.Debit);
      const credit = asMoneyNumber(row.Credit);
      if (isWalletLedger(row)) {
        walletBalance += credit - debit;
        return;
      }
      if (isOptionalSubscriptionFee(row)) {
        if (credit > 0 && row.Date && (!lastPaymentAt || String(row.Date) > String(lastPaymentAt))) {
          lastPaymentAt = row.Date;
        }
        return;
      }
      if (debit > 0) {
        totalDebit += debit;
        if (normalizeMatchText(row.FeeCategory) === 'account credit') {
          accountCreditDebit += debit;
        }
      }
      if (credit > 0) {
        totalCredit += credit;
      }
      if (credit > 0 && row.Date && (!lastPaymentAt || String(row.Date) > String(lastPaymentAt))) {
        lastPaymentAt = row.Date;
      }
    });
    const accountStatus = normalizeMatchText(account.Status || '');
    const resultStatus = normalizeMatchText(account.ResultStatus || '');
    const isEnrolled = yesNo(account.Enrolled) === 'YES' || accountStatus === 'enrolled';
    const isAdmitted = resultStatus === 'admitted' || ['admitted', 'accepted', 'admission letter sent'].includes(accountStatus);
    const offerSent = yesNo(account.OfferSent) === 'YES';
    if (isEnrolled || (isAdmitted && offerSent)) {
      const matchingExpectedFees = normalizedFeeItems
        .filter((fee) => yesNo(fee.Active) === 'YES')
        .filter((fee) => yesNo(fee.PayableOnline || 'YES') === 'YES')
        .filter((fee) => !isWalletFee(fee))
        .filter((fee) => !isOptionalSubscriptionFee(fee))
        .filter((fee) => {
          const category = normalizeMatchText(fee.FeeCategory || 'School Fee');
          const requiredForEnrollment = yesNo(fee.RequiredForEnrollment) === 'YES';
          if (isEnrolled) {
            return !isAcceptanceFeeLike(fee);
          }
          return category === 'admission' || requiredForEnrollment;
        })
        .filter((fee) => feeMatchesAccountPeriod(fee, account));
      const expectedFeeDebit = matchingExpectedFees.reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0);
      if (expectedFeeDebit > totalDebit) {
        totalDebit = expectedFeeDebit;
      }
    }
    const netBalance = totalDebit + accountCreditDebit - totalCredit;
    return {
      ...account,
      TotalDebit: totalDebit,
      TotalCredit: totalCredit,
      AccountCreditDebits: accountCreditDebit,
      Balance: netBalance,
      OutstandingBalance: Math.max(0, netBalance),
      ExcessCredit: Math.max(0, -netBalance),
      WalletBalance: walletBalance,
      LastPaymentAt: lastPaymentAt
    };
  }).sort((a, b) => clean(a.DisplayName || a.AccountRef).localeCompare(clean(b.DisplayName || b.AccountRef)));
  return {
    ok: true,
    message: 'Accounts loaded from Firestore.',
    accounts: accountRows,
    payments: normalizedPayments,
    invoices: normalizedInvoices,
    ledger,
    feeItems: feeItems.map(normalizeFeeItem)
  };
}

async function saveBrevoSettings(env, body) {
  const senderName = clean(body.BrevoSenderName || body.SenderName || body.senderName);
  const senderEmail = clean(body.BrevoSenderEmail || body.SenderEmail || body.senderEmail);
  const apiKey = clean(body.BrevoApiKey || body.ApiKey || body.apiKey);
  if (!senderEmail) {
    const err = new Error('Brevo sender email is required.');
    err.status = 400;
    throw err;
  }
  const now = nowIso();
  const payload = {
    BrevoSenderName: senderName,
    BrevoSenderEmail: senderEmail,
    UpdatedAt: now,
    UpdatedBy: clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin'
  };
  if (apiKey) {
    payload.BrevoApiKey = apiKey;
    payload.ApiKeyUpdatedAt = now;
  }
  await upsertDocument(env, 'settings', 'brevo', payload);
  return {
    ok: true,
    message: 'Brevo settings saved to Firestore.',
    settings: {
      BrevoSenderName: senderName,
      BrevoSenderEmail: senderEmail,
      HasBrevoApiKey: Boolean(apiKey)
    }
  };
}

async function saveSchoolProfile(env, body) {
  const profile = {
    SchoolName: clean(body.SchoolName || body.schoolName) || 'Integrated School Management Suite',
    SchoolCode: normalizeSchoolCode(body.SchoolCode || body.schoolCode),
    SchoolAddress: clean(body.SchoolAddress || body.schoolAddress),
    SchoolPhone: clean(body.SchoolPhone || body.schoolPhone),
    SchoolEmail: clean(body.SchoolEmail || body.schoolEmail),
    SchoolSignatoryName: clean(body.SchoolSignatoryName || body.schoolSignatoryName),
    SchoolSignatoryTitle: clean(body.SchoolSignatoryTitle || body.schoolSignatoryTitle),
    ResultSignatoryName: clean(body.ResultSignatoryName || body.resultSignatoryName),
    ResultSignatoryTitle: clean(body.ResultSignatoryTitle || body.resultSignatoryTitle),
    OfferSignatoryName: clean(body.OfferSignatoryName || body.offerSignatoryName),
    OfferSignatoryTitle: clean(body.OfferSignatoryTitle || body.offerSignatoryTitle),
    AdmissionSignatoryName: clean(body.AdmissionSignatoryName || body.admissionSignatoryName),
    AdmissionSignatoryTitle: clean(body.AdmissionSignatoryTitle || body.admissionSignatoryTitle),
    EmailGreetingTemplate: clean(body.EmailGreetingTemplate || body.emailGreetingTemplate) || 'Dear Parent/Guardian,',
    NameFormat: clean(body.NameFormat || body.nameFormat) || 'Surname, first name, middle name',
    PortalHeadline: clean(body.PortalHeadline || body.portalHeadline) || 'Admissions and parent services in one place',
    PortalSubheading: clean(body.PortalSubheading || body.portalSubheading) || 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
    PortalNotice: clean(body.PortalNotice || body.portalNotice),
    ResultDisplayMode: clean(body.ResultDisplayMode || body.resultDisplayMode) || 'subjects',
    ShowResultsOnline: yesNo(body.ShowResultsOnline ?? body.showResultsOnline ?? 'NO') || 'NO',
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin'
  };
  await upsertDocument(env, 'settings', 'schoolProfile', profile);
  return { ok: true, message: 'School profile saved to Firestore.', profile };
}

async function getSchoolProfile(env) {
  const rows = await listCollection(env, 'settings');
  const profile = rows.find((row) => row.__id === 'schoolProfile') || rows.find((row) => clean(row.SchoolName));
  return {
    ok: true,
    profile: profile || {
      SchoolName: 'Integrated School Management Suite',
      SchoolCode: normalizeSchoolCode(env.SCHOOL_CODE),
      SchoolAddress: '',
      SchoolPhone: '',
      SchoolEmail: '',
      SchoolSignatoryName: '',
      SchoolSignatoryTitle: '',
      ResultSignatoryName: '',
      ResultSignatoryTitle: '',
      OfferSignatoryName: '',
      OfferSignatoryTitle: '',
      AdmissionSignatoryName: '',
      AdmissionSignatoryTitle: '',
      EmailGreetingTemplate: 'Dear Parent/Guardian,',
      NameFormat: 'Surname, first name, middle name',
      PortalHeadline: 'Admissions and parent services in one place',
      PortalSubheading: 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
      PortalNotice: '',
      ResultDisplayMode: 'subjects',
      ShowResultsOnline: 'NO'
    }
  };
}

function applicationNotFound(id) {
  const err = new Error(id ? `Application not found: ${id}` : 'ApplicationID or ApplicationReference is required.');
  err.status = id ? 404 : 400;
  return err;
}

async function updateApplicationStatus(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const now = nowIso();
  const updates = {
    Status: clean(body.Status || body.status) || pick(existing, ['Status', 'status']),
    ReviewedBy: clean(body.ReviewedBy || body.reviewedBy) || 'Admissions Office',
    ReviewDate: now,
    UpdatedAt: now
  };
  if (body.Notes !== undefined) updates.Notes = clean(body.Notes);
  if (body.AdmissionNo !== undefined) updates.AdmissionNo = clean(body.AdmissionNo);
  if (body.Term !== undefined) updates.Term = clean(body.Term);
  if (body.ClassArm !== undefined || body.Arm !== undefined) updates.ClassArm = clean(body.ClassArm || body.Arm);
  [
    'AcceptanceFeePaid',
    'AcceptanceFeePaidAt',
    'AcceptanceFeeAmount',
    'AcceptanceFeeMethod',
    'AcceptanceFeeReceiptNo',
    'AcceptanceFeeReceivedBy'
  ].forEach((key) => {
    if (body[key] !== undefined) updates[key] = body[key];
  });
  if (updates.Status === 'Paid' && !updates.AcceptanceFeePaid) updates.AcceptanceFeePaid = 'YES';
  if (updates.AcceptanceFeePaid && !updates.AcceptanceFeePaidAt) updates.AcceptanceFeePaidAt = now;
  const saved = await saveApplication(env, { ...existing, ...updates });

  const admissionNo = updates.AdmissionNo || pick(existing, ['AdmissionNo']);
  const student = await findStudent(env, admissionNo, pick(existing, ['ApplicationReference', 'ApplicationID']));
  if (student && (body.AdmissionNo !== undefined || body.Term !== undefined || body.ClassArm !== undefined || body.Arm !== undefined)) {
    const studentUpdates = { ...student, UpdatedAt: now };
    if (body.AdmissionNo !== undefined) studentUpdates.AdmissionNo = clean(body.AdmissionNo);
    if (body.Term !== undefined) studentUpdates.Term = clean(body.Term);
    if (body.ClassArm !== undefined || body.Arm !== undefined) studentUpdates.ClassArm = clean(body.ClassArm || body.Arm);
    await saveStudent(env, studentUpdates);
  }
  return { ok: true, message: 'Application status updated.', application: saved };
}

async function updateApplicantNotes(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const saved = await saveApplication(env, {
    ...existing,
    Notes: clean(body.Notes || body.notes),
    ReviewedBy: clean(body.ReviewedBy || body.reviewedBy) || 'Admissions Office',
    ReviewDate: nowIso(),
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Applicant notes updated.', application: saved };
}

async function updateEntranceResult(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const resultStatus = clean(body.ResultStatus || body.resultStatus || 'Pending');
  const updates = {
    EnglishScore: body.EnglishScore ?? '',
    MathematicsScore: body.MathematicsScore ?? '',
    InterviewScore: body.InterviewScore ?? '',
    TotalScore: body.TotalScore ?? '',
    ResultPercentage: body.ResultPercentage ?? '',
    ResultStatus: resultStatus,
    ResultNotes: body.ResultNotes ?? '',
    ResultNextStep: body.ResultNextStep ?? body.NextStep ?? '',
    ResultUpdatedBy: clean(body.ResultUpdatedBy) || 'Admissions Office',
    ResultUpdatedAt: nowIso(),
    ResultReadyOnline: clean(body.ResultReadyOnline || body.resultReadyOnline || body.ResultPublished || body.ShowResultOnPortal || ''),
    ResultPublished: clean(body.ResultPublished || body.resultPublished || body.ResultReadyOnline || body.ShowResultOnPortal || ''),
    ShowResultOnPortal: clean(body.ShowResultOnPortal || body.showResultOnPortal || body.ResultReadyOnline || body.ResultPublished || ''),
    UpdatedAt: nowIso()
  };
  if (resultStatus === 'Admitted') updates.Status = 'Accepted';
  if (resultStatus === 'Not Admitted') updates.Status = 'Rejected';
  if (resultStatus === 'Pending') updates.Status = 'Pending';
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message: 'Entrance result updated.', application: saved };
}

async function updateApplicantIntelligence(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const ignored = new Set(['Secret', 'secret', 'Action', 'action', 'ApplicationID', 'ApplicationReference']);
  const updates = { UpdatedAt: nowIso(), IntelligenceUpdatedBy: clean(body.UpdatedBy) || 'Admissions Office' };
  Object.entries(body || {}).forEach(([key, value]) => {
    if (!ignored.has(key)) updates[key] = value;
  });
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message: 'Applicant intelligence updated.', application: saved };
}

async function updateApplicationDetails(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const ignored = new Set(['Secret', 'secret', 'Action', 'action', 'id', '__id']);
  const updates = { UpdatedAt: nowIso(), UpdatedBy: clean(body.UpdatedBy || body.UserRole) || 'Super Admin' };
  Object.entries(body || {}).forEach(([key, value]) => {
    if (!ignored.has(key)) updates[key] = value;
  });
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message: 'Application details updated.', application: saved };
}

async function deleteApplication(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const docId = safeDocumentId(pick(existing, ['ApplicationReference', 'ApplicationID', '__id']) || id);
  await deleteDocument(env, 'applications', docId);
  return { ok: true, message: 'Application deleted.', applicationReference: id };
}

function nextStudentAdmissionNo(students, session = '', schoolCode = 'DCA') {
  const yearMatch = clean(session).match(/20(\d{2})/);
  const yearCode = yearMatch ? yearMatch[1] : String(new Date().getFullYear()).slice(-2);
  const prefix = normalizeSchoolCode(schoolCode);
  let maxNo = 0;
  students.forEach((row) => {
    const admissionNo = pick(row, ['AdmissionNo', 'admissionNo', '__id']);
    const match = clean(admissionNo).match(new RegExp(`^${prefix}/${yearCode}/(\\d+)$`, 'i')) || clean(admissionNo).match(/(\d+)$/);
    if (match) maxNo = Math.max(maxNo, Number(match[1]));
  });
  return `${prefix}/${yearCode}/${String(maxNo + 1).padStart(6, '0')}`;
}

async function importStudents(env, body) {
  const rows = Array.isArray(body.Students) ? body.Students : [];
  if (!rows.length) {
    const err = new Error('No student rows were supplied.');
    err.status = 400;
    throw err;
  }
  const existingStudents = await listCollection(env, 'students');
  const schoolCode = await getSchoolCode(env);
  const importedBy = clean(body.ImportedBy || body.importedBy) || 'Admissions Office';
  let imported = 0;
  let skipped = 0;
  const failures = [];
  const savedStudents = [];
  for (let index = 0; index < rows.length; index += 1) {
    const input = rows[index] || {};
    const rowNo = index + 1;
    const applicantName = pick(input, ['ApplicantName', 'StudentName', 'Name']);
    const classAdmitted = pick(input, ['ClassAdmitted', 'ClassName', 'Class']);
    let admissionNo = pick(input, ['AdmissionNo', 'AdmissionNumber']);
    const appRef = pick(input, ['ApplicationReference']);
    if (!applicantName) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing student name.`);
      continue;
    }
    if (!classAdmitted) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing class.`);
      continue;
    }
    if (!admissionNo) admissionNo = nextStudentAdmissionNo([...existingStudents, ...savedStudents], input.AcademicSession || input.Session || '', schoolCode);
    const duplicate = await findStudent(env, admissionNo, appRef);
    if (duplicate) {
      skipped += 1;
      failures.push(`Row ${rowNo} (${admissionNo}): already exists.`);
      continue;
    }
    const student = {
      ...input,
      EnrolledAt: input.EnrolledAt || nowIso(),
      ApplicationReference: appRef,
      AdmissionNo: admissionNo,
      ApplicantName: applicantName,
      DisplayName: applicantName,
      ClassAdmitted: classAdmitted,
      ClassName: classAdmitted,
      AcademicSession: input.AcademicSession || input.Session || '',
      Term: input.Term || '',
      StudentType: input.StudentType || 'Day Student',
      BillingCategory: input.BillingCategory || input['Billing Category'] || 'Regular',
      Status: input.Status || 'Active',
      ImportedAt: nowIso(),
      ImportedBy: importedBy,
      EnrolledBy: input.EnrolledBy || importedBy,
      UpdatedAt: nowIso()
    };
    const saved = await saveStudent(env, student);
    savedStudents.push(saved);
    imported += 1;
  }
  return { ok: true, message: 'Student import completed.', imported, skipped, failures, students: (await listCollection(env, 'students')).map(normalizeStudent) };
}

async function promoteStudents(env, body) {
  const targets = Array.isArray(body.Students) ? body.Students : [];
  const newClass = clean(body.NewClass || body.newClass);
  const session = clean(body.AcademicSession || body.Session);
  const term = clean(body.Term);
  const promotedBy = clean(body.PromotedBy || body.promotedBy) || 'Admissions Office';
  if (!targets.length) throw new Error('No students were selected for promotion.');
  if (!newClass) throw new Error('New class is required.');
  if (!session) throw new Error('Academic session is required.');
  let promoted = 0;
  let skipped = 0;
  const failures = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index] || {};
    const student = await findStudent(env, pick(target, ['AdmissionNo', 'AdmissionNumber']), pick(target, ['ApplicationReference']));
    if (!student) {
      skipped += 1;
      failures.push(`Selected row ${index + 1}: student not found.`);
      continue;
    }
    const currentStatus = normalizeMatchText(pick(student, ['Status'], 'Active'));
    if (['withdrawn', 'expelled', 'graduated'].includes(currentStatus)) {
      skipped += 1;
      failures.push(`Selected row ${index + 1}: ${pick(student, ['DisplayName', 'ApplicantName', 'AdmissionNo']) || 'student'} is ${pick(student, ['Status'])} and was not moved.`);
      continue;
    }
    const oldClass = pick(student, ['ClassAdmitted', 'ClassName']);
    const line = `${nowIso()} | ${oldClass || 'Unspecified'} -> ${newClass} | ${session}${term ? ` | ${term}` : ''} | ${promotedBy}`;
    await saveStudent(env, {
      ...student,
      PreviousClass: oldClass,
      ClassAdmitted: newClass,
      ClassName: newClass,
      AcademicSession: session,
      Term: term || student.Term || '',
      PromotedAt: nowIso(),
      PromotedBy: promotedBy,
      PromotionHistory: student.PromotionHistory ? `${student.PromotionHistory}\n${line}` : line,
      UpdatedAt: nowIso()
    });
    promoted += 1;
  }
  return { ok: true, message: 'Student promotion completed.', promoted, skipped, failures, students: (await listCollection(env, 'students')).map(normalizeStudent) };
}

async function enrollStudent(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  if (yesNo(pick(existing, ['Enrolled'])) === 'YES' || pick(existing, ['Status']) === 'Enrolled') throw new Error('Student is already enrolled.');
  if (pick(existing, ['ResultStatus']) !== 'Admitted') throw new Error('Entrance result is not marked Admitted.');
  if (yesNo(pick(existing, ['OfferSent'])) !== 'YES') throw new Error('Offer of Admission has not been sent.');
  if (yesNo(pick(existing, ['AcceptanceFeePaid'])) !== 'YES') throw new Error('Acceptance Fee has not been marked Paid.');
  if (yesNo(pick(existing, ['AdmissionLetterSent'])) !== 'YES' && pick(existing, ['Status']) !== 'Admission Letter Sent') throw new Error('Admission Letter has not been sent.');
  const admissionNo = pick(existing, ['AdmissionNo', 'AdmissionNumber']);
  if (!admissionNo) throw new Error('Admission number is missing.');
  const appRef = pick(existing, ['ApplicationReference', 'ApplicationID']);
  if (await findStudent(env, admissionNo, appRef)) throw new Error('A student record already exists for this application or admission number.');
  const enrolledBy = clean(body.EnrolledBy || body.enrolledBy) || 'Admissions Office';
  const applicantName = pick(existing, ['ApplicantName', 'Name', 'DisplayName']);
  const student = await saveStudent(env, {
    EnrolledAt: nowIso(),
    ApplicationReference: appRef,
    AdmissionNo: admissionNo,
    Surname: pick(existing, ['Surname']),
    FirstName: pick(existing, ['FirstName']),
    MiddleName: pick(existing, ['MiddleName']),
    ApplicantName: applicantName,
    DisplayName: applicantName,
    Gender: pick(existing, ['Gender']),
    DateOfBirth: pick(existing, ['DateOfBirth']),
    ClassAdmitted: pick(existing, ['ClassApplyingFor', 'ClassName']),
    ClassName: pick(existing, ['ClassApplyingFor', 'ClassName']),
    AcademicSession: pick(existing, ['AcademicSession']),
    Term: pick(existing, ['Term']),
    StudentType: pick(existing, ['StudentType']),
    BillingCategory: pick(existing, ['BillingCategory'], 'Regular'),
    ParentName: pick(existing, ['FatherName', 'MotherName', 'GuardianName', 'ParentName']),
    ParentPhone: pick(existing, ['FatherPhone', 'MotherPhone', 'GuardianPhone', 'ParentPhone']),
    ParentEmail: pick(existing, ['ParentEmail', 'VerificationEmail', 'FatherEmail', 'MotherEmail']),
    ResidentialAddress: pick(existing, ['ResidentialAddress']),
    CityArea: pick(existing, ['CityArea']),
    StateOfResidence: pick(existing, ['StateOfResidence']),
    BloodGroup: pick(existing, ['BloodGroup']),
    Genotype: pick(existing, ['Genotype']),
    MedicalCondition: pick(existing, ['MedicalCondition']),
    EmergencyContactName: pick(existing, ['EmergencyContactName']),
    EmergencyContactPhone: pick(existing, ['EmergencyContactPhone']),
    PreviousSchool: pick(existing, ['PreviousSchool']),
    AcceptanceFeePaidAt: pick(existing, ['AcceptanceFeePaidAt']),
    AcceptanceFeeAmount: pick(existing, ['AcceptanceFeeAmount']),
    AcceptanceFeeMethod: pick(existing, ['AcceptanceFeeMethod']),
    AcceptanceFeeReceiptNo: pick(existing, ['AcceptanceFeeReceiptNo']),
    EnrolledBy: enrolledBy,
    Status: 'Active',
    UpdatedAt: nowIso()
  });
  const application = await saveApplication(env, { ...existing, Enrolled: 'YES', EnrolledAt: nowIso(), EnrolledBy: enrolledBy, Status: 'Enrolled', UpdatedAt: nowIso() });
  return { ok: true, message: 'Student enrolled successfully.', application, student };
}

async function markApplicationFlag(env, body, flagName, dateName, message) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const updates = { [flagName]: 'YES', [dateName]: nowIso(), UpdatedAt: nowIso() };
  if (flagName === 'AdmissionLetterSent') updates.Status = 'Admission Letter Sent';
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message, application: saved };
}

export async function recordSale(env, body) {
  const email = lower(body.Email || body.email);
  const code = clean(body.VerificationCode || body.verificationCode).toUpperCase();
  const receiptNo = clean(body.ReceiptNo || body.receiptNo);
  if (!email || !code) {
    const err = new Error('Email and VerificationCode are required.');
    err.status = 400;
    throw err;
  }
  const existing = await listCollection(env, 'formSales');
  const sameReceipt = receiptNo && existing.find((row) => sameText(row.ReceiptNo, receiptNo) || sameText(row.__id, safeDocumentId(receiptNo)));
  if (sameReceipt) {
    return {
      ok: true,
      duplicate: true,
      message: 'Sale already recorded.',
      receiptNo: pick(sameReceipt, ['ReceiptNo']) || receiptNo,
      verificationCode: pick(sameReceipt, ['VerificationCode']),
      email: pick(sameReceipt, ['Email']) || email,
      expiryDate: pick(sameReceipt, ['ExpiryDate'])
    };
  }
  const sameCode = existing.find((row) => sameText(row.VerificationCode, code));
  if (sameCode) {
    const err = new Error('This verification code already exists. Generate a different code.');
    err.status = 400;
    throw err;
  }
  const schoolCode = await getSchoolCode(env);
  const sale = {
    Time: body.Time || nowIso(),
    ReceiptNo: receiptNo || `${schoolCode}-FORM-${Date.now()}`,
    ApplicantName: clean(body.ApplicantName),
    Email: email,
    Phone: clean(body.Phone),
    ClassApplyingFor: clean(body.ClassApplyingFor),
    AmountPaid: formatNairaAmount(body.AmountPaid),
    FormLink: clean(body.FormLink),
    VerificationCode: code,
    PaymentDate: body.PaymentDate || nowIso().slice(0, 10),
    ExpiryDate: body.ExpiryDate || '',
    Status: body.Status || 'PAID',
    Used: body.Used || 'NO',
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'formSales', safeDocumentId(sale.ReceiptNo), sale);
  return {
    ok: true,
    message: 'Sale saved.',
    receiptNo: sale.ReceiptNo,
    verificationCode: sale.VerificationCode,
    email: sale.Email,
    expiryDate: sale.ExpiryDate
  };
}

function normalizeFormSale(row) {
  return {
    ...row,
    Time: pick(row, ['Time', 'Timestamp', 'CreatedAt']),
    ReceiptNo: pick(row, ['ReceiptNo', 'receiptNo', '__id']),
    ApplicantName: pick(row, ['ApplicantName', 'applicantName']),
    Email: lower(pick(row, ['Email', 'email'])),
    Phone: pick(row, ['Phone', 'phone']),
    ClassApplyingFor: pick(row, ['ClassApplyingFor', 'classApplyingFor', 'ClassName']),
    AmountPaid: pick(row, ['AmountPaid', 'amountPaid', 'Amount']),
    FormLink: pick(row, ['FormLink', 'formLink']),
    VerificationCode: clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase(),
    PaymentDate: toDisplayDate(pick(row, ['PaymentDate', 'paymentDate'])),
    ExpiryDate: toDisplayDate(pick(row, ['ExpiryDate', 'expiryDate'])),
    Status: pick(row, ['Status', 'status'], 'PAID'),
    Used: yesNo(pick(row, ['Used', 'used']))
  };
}

async function getFormSales(env) {
  const sales = (await listCollection(env, 'formSales'))
    .map(normalizeFormSale)
    .sort((a, b) => clean(b.Time || b.PaymentDate).localeCompare(clean(a.Time || a.PaymentDate)));
  return {
    ok: true,
    message: 'Form purchases loaded from Firestore.',
    backend: 'firestore',
    sales
  };
}

function normalizeAdmissionClass(row) {
  return {
    ...row,
    ClassName: pick(row, ['className', 'ClassName', '__id']),
    FormAmount: asMoneyNumber(pick(row, ['formAmount', 'FormAmount'])),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
  };
}

function normalizeSchoolClass(row) {
  return {
    ...row,
    ClassName: pick(row, ['className', 'ClassName', '__id']),
    Arms: pick(row, ['arms', 'Arms', 'ClassArms']),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
  };
}

export async function getSchoolClasses(env) {
  const classes = (await listCollection(env, 'settings/academics/classes'))
    .map(normalizeSchoolClass)
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  return {
    ok: true,
    message: 'School classes loaded from Firestore.',
    backend: 'firestore',
    classes
  };
}

async function saveSchoolClasses(env, body) {
  const classes = Array.isArray(body.Classes || body.classes) ? (body.Classes || body.classes) : [];
  if (!classes.length) {
    const err = new Error('Classes list is required.');
    err.status = 400;
    throw err;
  }
  const updatedAt = nowIso();
  const updatedBy = clean(body.UpdatedBy || body.updatedBy) || 'School Office';
  let saved = 0;
  const keepIds = new Set();
  for (const item of classes) {
    const className = clean(item.ClassName || item.className || item);
    if (!className) continue;
    const documentId = safeDocumentId(className);
    const payload = {
      ClassName: className,
      Arms: clean(item.Arms || item.arms || item.ClassArms),
      Active: yesNo(item.Active ?? item.active ?? 'YES') || 'YES',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    };
    keepIds.add(documentId);
    await upsertDocument(env, 'settings/academics/classes', documentId, payload);
    saved += 1;
  }
  for (const existing of await listCollection(env, 'settings/academics/classes')) {
    const existingId = clean(existing.__id || safeDocumentId(existing.ClassName || ''));
    if (existingId && !keepIds.has(existingId)) {
      await deleteDocument(env, 'settings/academics/classes', existingId);
    }
  }
  return {
    ok: true,
    message: `School classes saved to Firestore (${saved}).`,
    saved,
    ...(await getSchoolClasses(env))
  };
}

export async function getAdmissionClasses(env) {
  const classes = (await listCollection(env, 'settings/admission/classes'))
    .map(normalizeAdmissionClass)
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  const openClasses = classes
    .filter((item) => yesNo(item.Active) === 'YES')
    .map((item) => item.ClassName)
    .filter(Boolean);
  const pricedClass = classes.find((item) => yesNo(item.Active) === 'YES' && asMoneyNumber(item.FormAmount) > 0) ||
    classes.find((item) => asMoneyNumber(item.FormAmount) > 0) ||
    {};
  return {
    ok: true,
    message: 'Admission classes loaded from Firestore.',
    backend: 'firestore',
    openClasses,
    openClassOptions: openClasses,
    classes,
    formAmount: pricedClass.FormAmount || ''
  };
}

async function saveAdmissionClasses(env, body) {
  const classes = Array.isArray(body.Classes || body.classes) ? (body.Classes || body.classes) : [];
  const formAmount = asMoneyNumber(body.FormAmount || body.formAmount);
  if (!classes.length) {
    const err = new Error('Classes list is required.');
    err.status = 400;
    throw err;
  }
  const updatedAt = nowIso();
  const updatedBy = clean(body.UpdatedBy || body.updatedBy) || 'Admissions Office';
  let saved = 0;
  const keepIds = new Set();
  for (const item of classes) {
    const className = clean(item.ClassName || item.className || item);
    if (!className) continue;
    const documentId = safeDocumentId(className);
    const payload = {
      ClassName: className,
      FormAmount: asMoneyNumber(item.FormAmount || item.formAmount || formAmount),
      Active: yesNo(item.Active ?? item.active ?? 'NO') || 'NO',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    };
    keepIds.add(documentId);
    await upsertDocument(env, 'settings/admission/classes', documentId, payload);
    saved += 1;
  }
  for (const existing of await listCollection(env, 'settings/admission/classes')) {
    const existingId = clean(existing.__id || safeDocumentId(existing.ClassName || ''));
    if (existingId && !keepIds.has(existingId)) {
      await deleteDocument(env, 'settings/admission/classes', existingId);
    }
  }
  return {
    ok: true,
    message: `Admission classes saved to Firestore (${saved}).`,
    saved,
    ...(await getAdmissionClasses(env))
  };
}

async function saveFeeItem(env, body) {
  const feeCode = clean(body.FeeCode || body.feeCode);
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  const existing = (await listCollection(env, 'feeItems')).find((row) => sameText(row.FeeCode, feeCode) || sameText(row.__id, safeDocumentId(feeCode))) || {};
  const payload = {
    ...existing,
    FeeCode: feeCode,
    FeeName: clean(body.FeeName || body.feeName),
    FeeCategory: clean(body.FeeCategory || body.feeCategory) || 'School Fee',
    ClassName: clean(body.ClassName || body.className) || 'All',
    StudentType: clean(body.StudentType || body.studentType) || 'All',
    BillingCategory: clean(body.BillingCategory || body.billingCategory) || 'All',
    AcademicSession: clean(body.AcademicSession || body.academicSession) || 'All',
    Term: clean(body.Term || body.term) || 'All',
    Amount: asMoneyNumber(body.Amount || body.amount),
    Currency: clean(body.Currency || body.currency) || 'NGN',
    PayableOnline: yesNo(body.PayableOnline ?? body.payableOnline ?? 'YES') || 'YES',
    AllowInstallment: yesNo(body.AllowInstallment ?? body.allowInstallment ?? 'NO') || 'NO',
    MinAmount: asMoneyNumber(body.MinAmount || body.minAmount),
    MaxAmount: asMoneyNumber(body.MaxAmount || body.maxAmount),
    DueDate: clean(body.DueDate || body.dueDate || body.PaymentDueDate || body.paymentDueDate),
    RequiredForEnrollment: yesNo(body.RequiredForEnrollment ?? body.requiredForEnrollment ?? 'NO') || 'NO',
    Active: yesNo(body.Active ?? body.active ?? 'YES') || 'YES',
    SortOrder: asMoneyNumber(body.SortOrder || body.sortOrder || 100),
    Notes: clean(body.Notes || body.notes),
    CreatedAt: existing.CreatedAt || nowIso(),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'feeItems', safeDocumentId(feeCode), payload);
  return { ok: true, message: 'Fee item saved to Firestore.', fee: normalizeFeeItem(payload) };
}

async function deleteFeeItem(env, body) {
  const feeCode = clean(body.FeeCode || body.feeCode);
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  await deleteDocument(env, 'feeItems', safeDocumentId(feeCode));
  return { ok: true, message: 'Fee item deleted from Firestore.' };
}

const DEFAULT_FEE_ITEMS = [
  { FeeCode: 'ACCEPTANCE_FEE', FeeName: 'Acceptance Fee', FeeCategory: 'Admission', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'YES', Active: 'YES', SortOrder: 1 },
  { FeeCode: 'TUITION', FeeName: 'Tuition', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 10 },
  { FeeCode: 'BOARDING_FEE', FeeName: 'Boarding Fee', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'Boarding', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 20 },
  { FeeCode: 'FEEDING_FEE', FeeName: 'Feeding Fee', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'Boarding', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 30 },
  { FeeCode: 'BOOKS', FeeName: 'Books', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 40 },
  { FeeCode: 'TRANSPORT', FeeName: 'Transport', FeeCategory: 'Optional', ClassName: 'All', StudentType: 'Day', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 50 },
  { FeeCode: 'CLINIC_FEE', FeeName: 'Clinic / Medical Fee', FeeCategory: 'Clinic', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 60 },
  { FeeCode: 'KITCHEN_FEE', FeeName: 'Kitchen / Feeding Fee', FeeCategory: 'Kitchen', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 70 },
  { FeeCode: 'WALLET_TOPUP', FeeName: 'Student Wallet Top-up', FeeCategory: 'Wallet', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', MinAmount: 500, RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 900 }
];

async function seedDefaultFeeItems(env) {
  const existing = (await listCollection(env, 'feeItems')).map(normalizeFeeItem);
  const existingCodes = new Set(existing.map((item) => clean(item.FeeCode).toUpperCase()));
  let added = 0;
  for (const item of DEFAULT_FEE_ITEMS) {
    if (existingCodes.has(clean(item.FeeCode).toUpperCase())) continue;
    await upsertDocument(env, 'feeItems', safeDocumentId(item.FeeCode), {
      ...item,
      CreatedAt: nowIso(),
      UpdatedAt: nowIso()
    });
    added += 1;
  }
  return { ok: true, message: added ? 'Default fee items created in Firestore.' : 'Default fee items already exist in Firestore.', added };
}

export async function recordManualPayment(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.ApplicationReference);
  const feeCode = clean(body.FeeCode || body.feeCode);
  const amount = asMoneyNumber(body.Amount || body.amount);
  const reference = clean(body.Reference || body.reference || ledgerDocumentId('PAY'));
  if (!accountRef) {
    const err = new Error('AccountRef is required.');
    err.status = 400;
    throw err;
  }
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  if (amount <= 0) {
    const err = new Error('Amount must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const existingPayment = (await listCollection(env, 'payments')).find((row) => sameText(row.Reference, reference) || sameText(row.GatewayReference, reference));
  if (existingPayment) return { ok: true, message: 'Payment was already recorded.', duplicate: true, payment: normalizePayment(existingPayment) };
  const fee = (await listCollection(env, 'feeItems')).map(normalizeFeeItem).find((item) => sameText(item.FeeCode, feeCode)) || {};
  const student = await findStudentByAccountRef(env, accountRef);
  const paymentId = ledgerDocumentId('PAY');
  const payment = {
    PaymentId: paymentId,
    AccountRef: accountRef,
    ApplicationReference: clean(body.ApplicationReference || (student && student.ApplicationReference)),
    AdmissionNo: clean(body.AdmissionNo || (student && student.AdmissionNo)),
    DisplayName: clean(body.DisplayName || (student && (student.DisplayName || student.ApplicantName))),
    ClassName: clean(body.ClassName || (student && student.ClassName)),
    StudentType: clean(body.StudentType || (student && student.StudentType) || fee.StudentType),
    BillingCategory: clean(body.BillingCategory || (student && student.BillingCategory) || fee.BillingCategory) || 'Regular',
    AcademicSession: clean(body.AcademicSession || (student && student.AcademicSession) || fee.AcademicSession),
    Term: clean(body.Term || (student && student.Term) || fee.Term),
    FeeCode: feeCode,
    FeeName: clean(body.FeeName || fee.FeeName || feeCode),
    FeeCategory: clean(body.FeeCategory || fee.FeeCategory),
    Amount: amount,
    Currency: clean(body.Currency || fee.Currency) || 'NGN',
    Method: clean(body.Method) || 'Manual',
    Gateway: clean(body.Gateway) || 'Manual',
    Reference: reference,
    GatewayReference: clean(body.GatewayReference),
    Status: 'Paid',
    PaidAt: clean(body.PaidAt) || nowIso(),
    RecordedAt: nowIso(),
    RecordedBy: clean(body.RecordedBy) || 'Accounts Office',
    Channel: clean(body.Channel),
    ReceiptNo: clean(body.ReceiptNo) || paymentId,
    Metadata: clean(body.Metadata)
  };
  await upsertDocument(env, 'payments', safeDocumentId(paymentId), payment);
  const ledgerNo = ledgerDocumentId('LED');
  await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), {
    LedgerNo: ledgerNo,
    Date: payment.PaidAt,
    AccountRef: payment.AccountRef,
    ApplicationReference: payment.ApplicationReference,
    AdmissionNo: payment.AdmissionNo,
    DisplayName: payment.DisplayName,
    ClassName: payment.ClassName,
    EntryType: normalizeMatchText(payment.FeeCategory) === 'wallet' || clean(payment.FeeCode) === 'WALLET_TOPUP' ? 'Wallet Deposit' : 'Payment',
    FeeCode: payment.FeeCode,
    FeeName: payment.FeeName,
    FeeCategory: payment.FeeCategory,
    AcademicSession: payment.AcademicSession,
    Term: payment.Term,
    Description: payment.FeeName,
    Debit: 0,
    Credit: amount,
    Currency: payment.Currency,
    Reference: reference,
    RecordedBy: payment.RecordedBy,
    Source: payment.Gateway || payment.Method,
    Metadata: payment.Metadata
  });
  const matchingInvoices = (await listCollection(env, 'invoices')).map(normalizeInvoice).filter((invoice) => {
    return sameText(invoice.AccountRef, accountRef) && sameText(invoice.FeeCode, feeCode) && normalizeMatchText(invoice.Status) !== 'paid';
  });
  if (matchingInvoices.length) {
    const invoice = matchingInvoices[0];
    await upsertDocument(env, 'invoices', safeDocumentId(invoice.InvoiceId), {
      ...invoice,
      Credit: Math.min(asMoneyNumber(invoice.Debit), asMoneyNumber(invoice.Credit) + amount),
      Balance: Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit) - amount),
      Status: asMoneyNumber(invoice.Debit) <= asMoneyNumber(invoice.Credit) + amount ? 'Paid' : 'Part Paid',
      UpdatedAt: nowIso()
    });
  }
  if (isAcceptanceFeeLike(payment)) {
    const appId = payment.ApplicationReference || payment.AccountRef;
    const app = await findApplication(env, appId);
    if (app) {
      await saveApplication(env, {
        ...app,
        AcceptanceFeePaid: 'YES',
        AcceptanceFeePaidAt: payment.PaidAt,
        AcceptanceFeeAmount: amount,
        AcceptanceFeeMethod: payment.Gateway || payment.Method,
        AcceptanceFeeReceiptNo: payment.ReceiptNo || payment.Reference,
        AcceptanceFeeReceivedBy: payment.RecordedBy,
        UpdatedAt: nowIso()
      });
    }
  }
  return { ok: true, message: 'Payment recorded in Firestore.', payment };
}

async function generateSchoolFeeInvoices(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef);
  if (!accountRef) {
    const err = new Error('AccountRef is required.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const billingApp = {
    ...student,
    ClassApplyingFor: student.ClassName,
    ClassAdmitted: student.ClassName,
    AcademicSession: student.AcademicSession,
    Term: student.Term,
    BillingCategory: student.BillingCategory || 'Regular'
  };
  const fees = applyBillingCategoryOverrides((await listCollection(env, 'feeItems')).map(normalizeFeeItem).filter((fee) => {
    return yesNo(fee.Active) === 'YES' &&
      normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' &&
      !isWalletFee(fee) &&
      asMoneyNumber(fee.Amount) > 0 &&
      feeMatchesApplication(fee, billingApp);
  }), billingApp);
  if (!fees.length) {
    const err = new Error('No matching school fee items found for this class/student type.');
    err.status = 400;
    throw err;
  }
  const existing = (await listCollection(env, 'invoices')).map(normalizeInvoice);
  const ledgerRows = (await listCollection(env, 'ledger')).map(normalizeLedger).filter((row) => {
    return sameText(row.AccountRef, accountRef) || referencesMatch(row.AccountRef, accountRef) || sameText(row.AdmissionNo, accountRef);
  });
  let availableSchoolCredit = ledgerRows.reduce((sum, row) => {
    if (isWalletLedger(row)) return sum;
    const credit = asMoneyNumber(row.Credit);
    if (credit <= 0) return sum;
    const schoolRelated = isAcceptanceFeeLike(row) ||
      isSchoolFeesTotalPayment(row) ||
      normalizeMatchText(row.FeeCategory) === 'school fee' ||
      isGeneralFeeCredit(row);
    return schoolRelated ? sum + credit : sum;
  }, 0);
  availableSchoolCredit = Math.max(0, availableSchoolCredit - ledgerRows.reduce((sum, row) => {
    if (isWalletLedger(row)) return sum;
    return normalizeMatchText(row.FeeCategory) === 'account credit' ? sum + asMoneyNumber(row.Debit) : sum;
  }, 0));
  let created = 0;
  let updated = 0;
  for (const fee of fees) {
    const debit = asMoneyNumber(fee.Amount);
    const credit = Math.min(debit, availableSchoolCredit);
    availableSchoolCredit = Math.max(0, availableSchoolCredit - credit);
    const balance = Math.max(0, debit - credit);
    const status = balance <= 0 ? 'Paid' : credit > 0 ? 'Part Paid' : 'Unpaid';
    const duplicate = existing.find((invoice) => {
      return sameText(invoice.AccountRef, accountRef) &&
        sameText(invoice.FeeCode, fee.FeeCode) &&
        feeFieldMatches(invoice.AcademicSession || 'All', fee.AcademicSession || 'All', true) &&
        feeFieldMatches(invoice.Term || 'All', fee.Term || 'All', true);
    });
    const invoiceId = duplicate ? duplicate.InvoiceId : ledgerDocumentId('INV');
    await upsertDocument(env, 'invoices', safeDocumentId(invoiceId), {
      ...(duplicate || {}),
      InvoiceId: invoiceId,
      AccountRef: accountRef,
      ApplicationReference: student.ApplicationReference || '',
      AdmissionNo: student.AdmissionNo || '',
      DisplayName: student.DisplayName || student.ApplicantName || '',
      ClassName: student.ClassName || '',
      StudentType: student.StudentType || '',
      BillingCategory: student.BillingCategory || 'Regular',
      FeeCode: fee.FeeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory,
      Amount: debit,
      Debit: debit,
      Credit: credit,
      Balance: balance,
      Currency: fee.Currency || 'NGN',
      AcademicSession: fee.AcademicSession || student.AcademicSession || '',
      Term: fee.Term || student.Term || '',
      DueDate: fee.DueDate || '',
      Status: status,
      Date: duplicate?.Date || nowIso(),
      CreatedAt: duplicate?.CreatedAt || nowIso(),
      UpdatedAt: nowIso(),
      RecordedBy: clean(body.RecordedBy) || duplicate?.RecordedBy || 'Accounts Office'
    });
    if (duplicate) updated += 1;
    else created += 1;
  }
  return { ok: true, message: `${created} school fee invoice item(s) generated, ${updated} updated.`, created, updated };
}

function ledgerDocumentId(prefix = 'LED') {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sameDayIso(value, today = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

async function walletBalanceForAccount(env, accountRef) {
  const rows = (await listCollection(env, 'ledger')).map(normalizeLedger);
  return rows.filter((row) => {
    if (!sameText(row.AccountRef, accountRef) && !referencesMatch(row.AccountRef, accountRef)) return false;
    return normalizeMatchText(row.FeeCategory) === 'wallet' || normalizeMatchText(row.EntryType).startsWith('wallet');
  }).reduce((balance, row) => balance + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit), 0);
}

async function accountCreditBalanceForAccount(env, accountRef) {
  const overview = await getAccountsOverview(env);
  const account = (overview.accounts || []).find((row) => {
    return sameText(row.AccountRef, accountRef) ||
      sameText(row.AdmissionNo, accountRef) ||
      referencesMatch(row.AccountRef, accountRef) ||
      referencesMatch(row.AdmissionNo, accountRef);
  });
  if (!account) return 0;
  return Math.max(
    asMoneyNumber(account.ExcessCredit),
    asMoneyNumber(account.CreditBalance),
    Math.max(0, asMoneyNumber(account.TotalCredit) - asMoneyNumber(account.TotalDebit)),
    Math.max(0, -asMoneyNumber(account.Balance))
  );
}

async function walletSpentTodayForAccount(env, accountRef) {
  const rows = (await listCollection(env, 'ledger')).map(normalizeLedger);
  return rows.filter((row) => {
    if (!sameText(row.AccountRef, accountRef) && !referencesMatch(row.AccountRef, accountRef)) return false;
    return normalizeMatchText(row.EntryType) === 'wallet purchase' && sameDayIso(row.Date || row.createdAt);
  }).reduce((total, row) => total + asMoneyNumber(row.Debit), 0);
}

async function walletAccountPayload(env, student) {
  const normalized = normalizeStudent(student || {});
  const accountRef = normalized.AdmissionNo || normalized.ApplicationReference || normalized.AccountRef || '';
  return {
    AccountRef: accountRef,
    ApplicationReference: normalized.ApplicationReference || '',
    AdmissionNo: normalized.AdmissionNo || '',
    DisplayName: normalized.DisplayName || normalized.ApplicantName || '',
    ClassName: normalized.ClassName || normalized.ClassAdmitted || '',
    StudentType: normalized.StudentType || '',
    BillingCategory: normalized.BillingCategory || 'Regular',
    AcademicSession: normalized.AcademicSession || '',
    Term: normalized.Term || '',
    WalletCardId: normalized.WalletCardId || '',
    WalletCardStatus: normalized.WalletCardStatus || 'Active',
    WalletDailyLimit: normalized.WalletDailyLimit || '',
    WalletTxnLimit: normalized.WalletTxnLimit || '',
    WalletPinThreshold: normalized.WalletPinThreshold || '',
    WalletBalance: await walletBalanceForAccount(env, accountRef),
    WalletSpentToday: await walletSpentTodayForAccount(env, accountRef)
  };
}

async function getWalletCardAccount(env, body) {
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const student = cardId ? await findStudentByWalletCard(env, cardId) : await findStudentByAccountRef(env, accountRef);
  if (!student) {
    const err = new Error('Student wallet card/account not found. Enroll the student first, then assign a wallet card.');
    err.status = 404;
    throw err;
  }
  return { ok: true, message: 'Wallet account loaded.', account: await walletAccountPayload(env, student) };
}

async function saveWalletCard(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  if (!accountRef) {
    const err = new Error('Account/admission number is required.');
    err.status = 400;
    throw err;
  }
  if (!cardId) {
    const err = new Error('Wallet card ID is required.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const duplicate = await findStudentByWalletCard(env, cardId);
  if (duplicate && !sameText(duplicate.AdmissionNo, student.AdmissionNo)) {
    const err = new Error('This wallet card is already assigned to another student.');
    err.status = 400;
    throw err;
  }
  const updates = {
    ...student,
    WalletCardId: cardId,
    WalletCardStatus: clean(body.WalletCardStatus || body.CardStatus || 'Active') || 'Active',
    WalletDailyLimit: body.WalletDailyLimit ?? student.WalletDailyLimit ?? '',
    WalletTxnLimit: body.WalletTxnLimit ?? student.WalletTxnLimit ?? '',
    WalletPinThreshold: body.WalletPinThreshold ?? student.WalletPinThreshold ?? '',
    WalletUpdatedAt: nowIso()
  };
  const pin = clean(body.WalletPin || body.Pin);
  if (pin) {
    updates.WalletPinHash = await sha256Hex(`${clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET)}:${pin}`);
    updates.WalletPinSetAt = nowIso();
  }
  const saved = await saveStudent(env, updates);
  return { ok: true, message: 'Wallet card saved.', account: await walletAccountPayload(env, saved) };
}

async function recordWalletPurchase(env, body) {
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const amount = asMoneyNumber(body.Amount || body.amount);
  if (amount <= 0) {
    const err = new Error('Enter a wallet purchase amount greater than zero.');
    err.status = 400;
    throw err;
  }
  const student = cardId ? await findStudentByWalletCard(env, cardId) : await findStudentByAccountRef(env, accountRef);
  if (!student) {
    const err = new Error('Student wallet card/account not found.');
    err.status = 404;
    throw err;
  }
  const account = await walletAccountPayload(env, student);
  if (['blocked', 'inactive'].includes(normalizeMatchText(account.WalletCardStatus || 'Active'))) {
    const err = new Error('This wallet card is blocked.');
    err.status = 400;
    throw err;
  }
  if (amount > asMoneyNumber(account.WalletBalance)) {
    const err = new Error('Insufficient wallet balance.');
    err.status = 400;
    throw err;
  }
  const txnLimit = asMoneyNumber(account.WalletTxnLimit);
  if (txnLimit > 0 && amount > txnLimit) {
    const err = new Error('This purchase exceeds the wallet transaction limit.');
    err.status = 400;
    throw err;
  }
  const dailyLimit = asMoneyNumber(account.WalletDailyLimit);
  if (dailyLimit > 0 && asMoneyNumber(account.WalletSpentToday) + amount > dailyLimit) {
    const err = new Error('This purchase would exceed the daily wallet limit.');
    err.status = 400;
    throw err;
  }
  const pinThreshold = asMoneyNumber(account.WalletPinThreshold);
  const savedPinHash = clean(student.WalletPinHash);
  if (savedPinHash && pinThreshold > 0 && amount >= pinThreshold) {
    const suppliedPin = clean(body.WalletPin || body.Pin);
    const suppliedHash = await sha256Hex(`${clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET)}:${suppliedPin}`);
    if (!suppliedPin || suppliedHash !== savedPinHash) {
      const err = new Error('Invalid wallet PIN.');
      err.status = 400;
      throw err;
    }
  }
  const ledgerNo = ledgerDocumentId('WALLET');
  const entry = {
    LedgerNo: ledgerNo,
    Date: nowIso(),
    AccountRef: account.AccountRef,
    ApplicationReference: account.ApplicationReference,
    AdmissionNo: account.AdmissionNo,
    DisplayName: account.DisplayName,
    ClassName: account.ClassName,
    AcademicSession: account.AcademicSession || student.AcademicSession || '',
    Term: account.Term || student.Term || '',
    EntryType: 'Wallet Purchase',
    FeeCategory: 'Wallet',
    Description: clean(body.Description || body.description) || 'Wallet purchase',
    Debit: amount,
    Credit: 0,
    Currency: 'NGN',
    Reference: clean(body.Reference || body.reference) || ledgerNo,
    RecordedBy: clean(body.RecordedBy || body.recordedBy) || 'Wallet POS',
    Source: clean(body.Terminal || body.terminal) || 'Wallet POS',
    Metadata: JSON.stringify({
      walletCardId: cardId || account.WalletCardId,
      department: clean(body.Department || body.department)
    })
  };
  await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), entry);
  return {
    ok: true,
    message: 'Wallet purchase recorded.',
    ledger: entry,
    balance: await walletBalanceForAccount(env, account.AccountRef),
    account: await walletAccountPayload(env, student)
  };
}

async function recordCreditAction(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const action = clean(body.CreditAction || body.ActionType || body.actionType || body.Type).toLowerCase();
  const amount = asMoneyNumber(body.Amount || body.amount);
  const recordedBy = clean(body.RecordedBy || body.recordedBy) || 'Accounts Office';
  const notes = clean(body.Notes || body.notes);
  if (!accountRef) {
    const err = new Error('AccountRef is required.');
    err.status = 400;
    throw err;
  }
  if (amount <= 0) {
    const err = new Error('Amount must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const account = await walletAccountPayload(env, student);
  const availableCredit = await accountCreditBalanceForAccount(env, account.AccountRef);
  const isManualCredit = action === 'manual credit adjustment' || action === 'manual_credit' || action === 'credit_adjustment';
  if (!isManualCredit && amount > availableCredit) {
    const err = new Error(`Amount exceeds available account credit (${formatNairaAmount(availableCredit)}).`);
    err.status = 400;
    throw err;
  }
  const reference = clean(body.Reference || body.reference) || ledgerDocumentId('CREDIT');
  const entries = [];
  const base = {
    Date: nowIso(),
    AccountRef: account.AccountRef,
    ApplicationReference: account.ApplicationReference,
    AdmissionNo: account.AdmissionNo,
    DisplayName: account.DisplayName,
    ClassName: account.ClassName,
    AcademicSession: account.AcademicSession || student.AcademicSession || '',
    Term: account.Term || student.Term || '',
    FeeCategory: 'Account Credit',
    Currency: 'NGN',
    Reference: reference,
    RecordedBy: recordedBy,
    Source: 'Accounts Credit Action'
  };
  const addLedger = async (entry, prefix = 'CREDIT') => {
    const ledgerNo = ledgerDocumentId(prefix);
    const payload = {
      LedgerNo: ledgerNo,
      ...entry,
      Metadata: JSON.stringify({
        creditAction: action,
        notes,
        targetAccountRef: clean(body.TargetAccountRef || body.targetAccountRef),
        availableCreditBefore: availableCredit
      })
    };
    await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), payload);
    entries.push(payload);
  };

  if (action === 'refund to parent' || action === 'refund') {
    await addLedger({
      ...base,
      EntryType: 'Credit Refund',
      FeeCode: 'CREDIT_REFUND',
      FeeName: 'Credit Refund',
      Description: notes || 'Refund of account credit to parent',
      Debit: amount,
      Credit: 0
    });
  } else if (action === 'transfer to wallet' || action === 'wallet') {
    await addLedger({
      ...base,
      EntryType: 'Credit Transfer',
      FeeCode: 'CREDIT_TO_WALLET',
      FeeName: 'Credit Transfer to Wallet',
      Description: notes || 'Account credit transferred to student wallet',
      Debit: amount,
      Credit: 0
    });
    await addLedger({
      ...base,
      EntryType: 'Wallet Deposit',
      FeeCode: 'WALLET_TOPUP',
      FeeName: 'Student Wallet Top-up',
      FeeCategory: 'Wallet',
      Description: notes || 'Account credit transferred to wallet',
      Debit: 0,
      Credit: amount
    }, 'WALLET');
  } else if (action === 'transfer to sibling' || action === 'sibling') {
    const targetRef = clean(body.TargetAccountRef || body.targetAccountRef);
    if (!targetRef) {
      const err = new Error('Target sibling/account is required.');
      err.status = 400;
      throw err;
    }
    const targetStudent = await findStudentByAccountRef(env, targetRef);
    if (!targetStudent) {
      const err = new Error('Target sibling/account was not found.');
      err.status = 404;
      throw err;
    }
    const targetAccount = await walletAccountPayload(env, targetStudent);
    await addLedger({
      ...base,
      EntryType: 'Credit Transfer',
      FeeCode: 'CREDIT_TRANSFER_OUT',
      FeeName: 'Credit Transfer Out',
      Description: notes || `Account credit transferred to ${targetAccount.DisplayName || targetAccount.AccountRef}`,
      Debit: amount,
      Credit: 0
    });
    await addLedger({
      Date: nowIso(),
      AccountRef: targetAccount.AccountRef,
      ApplicationReference: targetAccount.ApplicationReference,
      AdmissionNo: targetAccount.AdmissionNo,
      DisplayName: targetAccount.DisplayName,
      ClassName: targetAccount.ClassName,
      AcademicSession: targetAccount.AcademicSession || targetStudent.AcademicSession || '',
      Term: targetAccount.Term || targetStudent.Term || '',
      EntryType: 'Credit Transfer',
      FeeCode: 'CREDIT_TRANSFER_IN',
      FeeName: 'Credit Transfer In',
      FeeCategory: 'Account Credit',
      Description: notes || `Account credit transferred from ${account.DisplayName || account.AccountRef}`,
      Debit: 0,
      Credit: amount,
      Currency: 'NGN',
      Reference: reference,
      RecordedBy: recordedBy,
      Source: 'Accounts Credit Action'
    });
  } else if (action === 'manual credit adjustment' || action === 'manual debit adjustment' || isManualCredit || action === 'debit_adjustment') {
    const isDebit = action === 'manual debit adjustment' || action === 'debit_adjustment';
    if (isDebit && amount > availableCredit) {
      const err = new Error(`Amount exceeds available account credit (${formatNairaAmount(availableCredit)}).`);
      err.status = 400;
      throw err;
    }
    await addLedger({
      ...base,
      EntryType: isDebit ? 'Credit Adjustment Debit' : 'Credit Adjustment',
      FeeCode: isDebit ? 'CREDIT_ADJUSTMENT_DEBIT' : 'CREDIT_ADJUSTMENT',
      FeeName: isDebit ? 'Credit Adjustment Debit' : 'Credit Adjustment',
      Description: notes || (isDebit ? 'Manual debit adjustment to account credit' : 'Manual credit adjustment'),
      Debit: isDebit ? amount : 0,
      Credit: isDebit ? 0 : amount
    });
  } else {
    const err = new Error('Choose a valid credit action.');
    err.status = 400;
    throw err;
  }

  return {
    ok: true,
    message: 'Credit action recorded.',
    entries,
    availableCreditBefore: availableCredit,
    availableCreditAfter: await accountCreditBalanceForAccount(env, account.AccountRef)
  };
}

async function saveClinicRecord(env, body) {
  const studentName = clean(body.StudentName || body.studentName);
  const complaint = clean(body.Complaint || body.complaint);
  if (!studentName) {
    const err = new Error('Student name is required.');
    err.status = 400;
    throw err;
  }
  if (!complaint) {
    const err = new Error('Complaint is required.');
    err.status = 400;
    throw err;
  }
  const recordId = clean(body.RecordId || body.RecordNo) || ledgerDocumentId('CLN');
  const payload = {
    RecordId: recordId,
    RecordNo: recordId,
    Date: clean(body.Date) || nowIso(),
    StudentName: studentName,
    AdmissionNo: clean(body.AdmissionNo),
    ClassName: clean(body.ClassName),
    Complaint: complaint,
    Treatment: clean(body.Treatment),
    Disposition: clean(body.Disposition),
    RecordedBy: clean(body.RecordedBy) || 'Clinic',
    ReviewedBy: clean(body.ReviewedBy),
    Notes: clean(body.Notes),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'clinicRecords', safeDocumentId(recordId), payload);
  return { ok: true, message: 'Clinic record saved to Firestore.', record: payload };
}

async function saveInventoryItem(env, body, collection, defaults) {
  const itemName = clean(body.ItemName || body.itemName);
  const originalItemName = clean(body.OriginalItemName || body.originalItemName || itemName);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  const existingRows = await listCollection(env, collection);
  const existing = existingRows.find((row) => sameText(row.ItemName, originalItemName) || sameText(row.__id, safeDocumentId(originalItemName)) || sameText(row.ItemName, itemName)) || {};
  const originalId = safeDocumentId(originalItemName);
  const nextId = safeDocumentId(itemName);
  const payload = {
    ...existing,
    ItemName: itemName,
    Category: clean(body.Category || body.category) || defaults.category,
    Unit: clean(body.Unit || body.unit) || defaults.unit,
    Quantity: asMoneyNumber(body.Quantity || body.quantity),
    ReorderLevel: asMoneyNumber(body.ReorderLevel || body.reorderLevel),
    LastUpdated: nowIso(),
    Notes: clean(body.Notes || body.notes)
  };
  if (originalId && originalId !== nextId) {
    await deleteDocument(env, collection, originalId);
  }
  await upsertDocument(env, collection, nextId, payload);
  return { ok: true, message: `${defaults.label} inventory item saved to Firestore.`, item: normalizeInventory(payload) };
}

async function deleteInventoryItem(env, body, collection, label) {
  const itemName = clean(body.ItemName || body.itemName);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  await deleteDocument(env, collection, safeDocumentId(itemName));
  return { ok: true, message: `${label} inventory item deleted from Firestore.` };
}

async function recordStockMovement(env, body, collection, movementCollection, defaults) {
  const itemName = clean(body.ItemName || body.itemName);
  const movementType = clean(body.MovementType || body.movementType).toUpperCase();
  const quantity = asMoneyNumber(body.Quantity || body.quantity);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  if (!['IN', 'OUT'].includes(movementType)) {
    const err = new Error('MovementType must be IN or OUT.');
    err.status = 400;
    throw err;
  }
  if (quantity <= 0) {
    const err = new Error('Quantity must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const rows = await listCollection(env, collection);
  const existing = rows.find((row) => sameText(row.ItemName, itemName) || sameText(row.__id, safeDocumentId(itemName)));
  if (!existing) {
    const err = new Error('Inventory item not found. Create the item first.');
    err.status = 404;
    throw err;
  }
  const current = asMoneyNumber(existing.Quantity);
  const nextQty = movementType === 'IN' ? current + quantity : current - quantity;
  const itemPayload = {
    ...existing,
    Quantity: nextQty,
    LastUpdated: nowIso()
  };
  await upsertDocument(env, collection, safeDocumentId(existing.ItemName || itemName), itemPayload);
  const movementNo = ledgerDocumentId(defaults.prefix);
  const movement = {
    MovementNo: movementNo,
    Date: nowIso(),
    ItemName: existing.ItemName || itemName,
    MovementType: movementType,
    Quantity: quantity,
    Reason: clean(body.Reason),
    RecordedBy: clean(body.RecordedBy) || defaults.actor
  };
  await upsertDocument(env, movementCollection, safeDocumentId(movementNo), movement);
  return { ok: true, message: `${defaults.label} stock movement recorded in Firestore.`, movement, item: normalizeInventory(itemPayload) };
}

async function updateStudentBillingCategory(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const category = clean(body.BillingCategory || body.billingCategory) || 'Regular';
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const saved = await saveStudent(env, { ...student, BillingCategory: category, UpdatedAt: nowIso() });
  return { ok: true, message: 'Billing category updated.', student: saved };
}

async function updateStudentStatus(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const status = clean(body.Status || body.status);
  const allowed = ['Active', 'On Leave', 'Suspended', 'Withdrawn', 'Expelled', 'Graduated'];
  if (!accountRef) {
    const err = new Error('Account/admission number is required.');
    err.status = 400;
    throw err;
  }
  const normalizedStatus = allowed.find((item) => item.toLowerCase() === status.toLowerCase());
  if (!normalizedStatus) {
    const err = new Error('Select a valid student status.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const saved = await saveStudent(env, {
    ...student,
    Status: normalizedStatus,
    StatusReason: clean(body.StatusReason || body.statusReason || body.Reason || body.reason),
    StatusEffectiveDate: clean(body.StatusEffectiveDate || body.statusEffectiveDate) || nowIso().slice(0, 10),
    ExpectedReturnDate: clean(body.ExpectedReturnDate || body.expectedReturnDate),
    StatusUpdatedBy: clean(body.UpdatedBy || body.updatedBy) || 'School Office',
    StatusUpdatedAt: nowIso(),
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Student status updated.', student: saved };
}

const DEFAULT_CHART_OF_ACCOUNTS = [
  ['1010', 'Cash on Hand', 'Asset', 'Cash and Bank', 'Debit'],
  ['1020', 'Main Bank Account', 'Asset', 'Cash and Bank', 'Debit'],
  ['1030', 'Online Payment Clearing', 'Asset', 'Cash and Bank', 'Debit'],
  ['1100', 'Student Accounts Receivable', 'Asset', 'Receivables', 'Debit'],
  ['1200', 'Inventory', 'Asset', 'Current Assets', 'Debit'],
  ['1500', 'Property and Equipment', 'Asset', 'Fixed Assets', 'Debit'],
  ['1600', 'Accumulated Depreciation', 'Asset', 'Fixed Assets', 'Credit'],
  ['2000', 'Accounts Payable', 'Liability', 'Payables', 'Credit'],
  ['2100', 'Taxes and Statutory Deductions', 'Liability', 'Statutory', 'Credit'],
  ['2200', 'Student Wallet Liability', 'Liability', 'Student Wallets', 'Credit'],
  ['3000', 'Accumulated School Fund', 'Equity', 'School Fund', 'Credit'],
  ['4000', 'Tuition and School Fee Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4010', 'Admission Form Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4020', 'Boarding Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4030', 'Transport Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4040', 'Books and Uniform Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4050', 'Clinic Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4060', 'Kitchen and Feeding Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4070', 'Club and Activity Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4080', 'Grants and Donations', 'Revenue', 'Other Income', 'Credit'],
  ['4090', 'Other Income', 'Revenue', 'Other Income', 'Credit'],
  ['4100', 'Discounts, Scholarships and Refunds', 'Revenue', 'Contra Revenue', 'Debit'],
  ['5000', 'Academic Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['5010', 'Boarding Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['5020', 'Transport Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['5030', 'Kitchen and Feeding Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['6000', 'Salaries and Staff Costs', 'Expense', 'Operating Expense', 'Debit'],
  ['6010', 'Utilities', 'Expense', 'Operating Expense', 'Debit'],
  ['6020', 'Repairs and Maintenance', 'Expense', 'Operating Expense', 'Debit'],
  ['6030', 'Administrative Expenses', 'Expense', 'Operating Expense', 'Debit'],
  ['6040', 'Marketing and Admissions', 'Expense', 'Operating Expense', 'Debit'],
  ['6050', 'Professional Fees', 'Expense', 'Operating Expense', 'Debit'],
  ['6060', 'Bank and Payment Charges', 'Expense', 'Finance Cost', 'Debit'],
  ['6070', 'Depreciation Expense', 'Expense', 'Non-cash Expense', 'Debit'],
  ['6090', 'Other Expenses', 'Expense', 'Operating Expense', 'Debit']
];

function accountingRoleAllowed(body, allowed) {
  const role = clean(body.UserRole || body.userRole || '');
  return allowed.includes(role);
}

function requireAccountingRole(body, allowed, message = 'Your role is not allowed to perform this accounting action.') {
  if (accountingRoleAllowed(body, allowed)) return;
  const err = new Error(message);
  err.status = 403;
  throw err;
}

function accountingLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
}

function accountingAccountCodeForRevenue(category, feeCode = '') {
  const text = `${clean(category)} ${clean(feeCode)}`.toLowerCase();
  if (text.includes('form') || text.includes('admission')) return '4010';
  if (text.includes('board')) return '4020';
  if (text.includes('transport') || text.includes('bus')) return '4030';
  if (text.includes('book') || text.includes('uniform')) return '4040';
  if (text.includes('clinic') || text.includes('medical')) return '4050';
  if (text.includes('kitchen') || text.includes('feeding')) return '4060';
  if (text.includes('club') || text.includes('activity')) return '4070';
  if (text.includes('grant') || text.includes('donation')) return '4080';
  if (text.includes('school') || text.includes('tuition')) return '4000';
  return '4090';
}

function accountingCashAccountFor(method, gateway = '') {
  const text = `${clean(method)} ${clean(gateway)}`.toLowerCase();
  if (text.includes('cash')) return '1010';
  if (text.includes('paystack') || text.includes('online') || text.includes('gateway')) return '1030';
  return '1020';
}

async function seedAccountingChart(env) {
  const existing = await listCollection(env, 'chartOfAccounts');
  const codes = new Set(existing.map((row) => clean(row.Code || row.code || row.__id)));
  let added = 0;
  for (const [Code, Name, Type, Group, NormalBalance] of DEFAULT_CHART_OF_ACCOUNTS) {
    if (codes.has(Code)) continue;
    await upsertDocument(env, 'chartOfAccounts', Code, {
      Code, Name, Type, Group, NormalBalance, Active: 'YES', System: 'YES',
      CreatedAt: nowIso(), UpdatedAt: nowIso()
    });
    added += 1;
  }
  return added;
}

async function accountingPeriodIsClosed(env, dateText) {
  const date = clean(dateText).slice(0, 10);
  if (!date) return false;
  const periods = await listCollection(env, 'accountingPeriods');
  return periods.some((row) => {
    const status = lower(row.Status || row.status);
    return status === 'closed' && date >= clean(row.StartDate || row.startDate) && date <= clean(row.EndDate || row.endDate);
  });
}

function normalizedJournal(payload) {
  const lines = accountingLines(payload.Lines || payload.lines).map((line, index) => ({
    LineNo: index + 1,
    AccountCode: clean(line.AccountCode || line.accountCode),
    AccountName: clean(line.AccountName || line.accountName),
    Description: clean(line.Description || line.description || payload.Description),
    Department: clean(line.Department || line.department || payload.Department),
    CostCentre: clean(line.CostCentre || line.costCentre || payload.CostCentre),
    Debit: asMoneyNumber(line.Debit || line.debit),
    Credit: asMoneyNumber(line.Credit || line.credit)
  }));
  return { ...payload, Lines: lines };
}

async function writeAccountingAudit(env, action, entityType, entityId, body, details = '') {
  const auditId = ledgerDocumentId('AUD');
  await upsertDocument(env, 'accountingAudit', safeDocumentId(auditId), {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    EntityType: clean(entityType),
    EntityId: clean(entityId),
    UserRole: clean(body.UserRole || body.userRole),
    UserName: clean(body.RecordedBy || body.UpdatedBy || body.UserName || body.userName),
    Details: clean(details)
  });
}

async function saveAccountingJournal(env, body, system = false) {
  const existingId = clean(body.JournalNo || body.journalNo);
  const journalNo = existingId || ledgerDocumentId(system ? 'SYS' : 'JRN');
  const existingRows = await listCollection(env, 'accountingJournals');
  const existing = existingRows.find((row) => sameText(row.JournalNo, journalNo) || sameText(row.__id, safeDocumentId(journalNo))) || {};
  if (lower(existing.Status) === 'posted' && !system) {
    const err = new Error('Posted journals are immutable. Create a reversal journal instead.');
    err.status = 409;
    throw err;
  }
  const status = clean(body.Status || body.status || 'Draft');
  const date = clean(body.Date || body.date) || nowIso().slice(0, 10);
  if (lower(status) === 'posted' && await accountingPeriodIsClosed(env, date)) {
    const err = new Error('This accounting period is closed.');
    err.status = 409;
    throw err;
  }
  const payload = normalizedJournal({
    ...existing,
    JournalNo: journalNo,
    Date: date,
    Description: clean(body.Description || body.description),
    Reference: clean(body.Reference || body.reference),
    Source: clean(body.Source || body.source) || (system ? 'System' : 'Manual Journal'),
    SourceId: clean(body.SourceId || body.sourceId),
    Department: clean(body.Department || body.department),
    CostCentre: clean(body.CostCentre || body.costCentre),
    AcademicSession: clean(body.AcademicSession || body.academicSession),
    Term: clean(body.Term || body.term),
    Status: status,
    Lines: body.Lines || body.lines || existing.Lines || [],
    CreatedAt: existing.CreatedAt || nowIso(),
    CreatedBy: existing.CreatedBy || clean(body.RecordedBy || body.recordedBy),
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.RecordedBy || body.recordedBy),
    PostedAt: lower(status) === 'posted' ? (existing.PostedAt || nowIso()) : '',
    PostedBy: lower(status) === 'posted' ? clean(body.RecordedBy || body.recordedBy) : '',
    System: system ? 'YES' : clean(existing.System || 'NO')
  });
  const debit = payload.Lines.reduce((sum, line) => sum + line.Debit, 0);
  const credit = payload.Lines.reduce((sum, line) => sum + line.Credit, 0);
  if (!payload.Lines.length || payload.Lines.some((line) => !line.AccountCode || (line.Debit <= 0 && line.Credit <= 0))) {
    const err = new Error('Every journal requires valid debit and credit lines.');
    err.status = 400;
    throw err;
  }
  if (Math.abs(debit - credit) > 0.005) {
    const err = new Error(`Journal is not balanced. Debit ${debit.toFixed(2)}; credit ${credit.toFixed(2)}.`);
    err.status = 400;
    throw err;
  }
  payload.TotalDebit = debit;
  payload.TotalCredit = credit;
  await upsertDocument(env, 'accountingJournals', safeDocumentId(journalNo), payload);
  if (!system) await writeAccountingAudit(env, existingId ? 'UPDATE' : 'CREATE', 'Journal', journalNo, body, status);
  return payload;
}

async function syncRevenueToAccounting(env) {
  await seedAccountingChart(env);
  const [invoices, payments, sales, journals] = await Promise.all([
    listCollection(env, 'invoices'),
    listCollection(env, 'payments'),
    listCollection(env, 'formSales').catch(() => []),
    listCollection(env, 'accountingJournals')
  ]);
  const existing = new Set(journals.map((row) => clean(row.JournalNo || row.__id)));
  let created = 0;
  for (const row of invoices) {
    const sourceId = clean(row.InvoiceId || row.InvoiceNo || row.invoiceId || row.__id);
    const journalNo = `SYS-INV-${safeDocumentId(sourceId)}`;
    const amount = asMoneyNumber(row.Amount || row.amount);
    if (!sourceId || amount <= 0 || existing.has(journalNo)) continue;
    const revenue = accountingAccountCodeForRevenue(row.FeeCategory || row.feeCategory, row.FeeCode || row.feeCode);
    await saveAccountingJournal(env, {
      JournalNo: journalNo, Date: row.CreatedAt || row.Date || nowIso(), Status: 'Posted',
      Description: `Invoice: ${clean(row.FeeName || row.Description || sourceId)}`,
      Reference: sourceId, Source: 'Student Invoice', SourceId: sourceId,
      AcademicSession: row.AcademicSession || '', Term: row.Term || '', RecordedBy: 'System',
      Lines: [
        { AccountCode: '1100', Debit: amount, Credit: 0, Description: clean(row.AccountRef || row.DisplayName) },
        { AccountCode: revenue, Debit: 0, Credit: amount, Description: clean(row.FeeName || row.FeeCategory) }
      ]
    }, true);
    existing.add(journalNo); created += 1;
  }
  for (const row of payments) {
    const sourceId = clean(row.PaymentId || row.PaymentNo || row.Reference || row.paymentId || row.__id);
    const journalNo = `SYS-PAY-${safeDocumentId(sourceId)}`;
    const amount = asMoneyNumber(row.Amount || row.amount || row.AmountPaid);
    if (!sourceId || amount <= 0 || existing.has(journalNo)) continue;
    const cash = accountingCashAccountFor(row.Method || row.PaymentMethod, row.Gateway);
    await saveAccountingJournal(env, {
      JournalNo: journalNo, Date: row.PaidAt || row.PaymentDate || row.Date || nowIso(), Status: 'Posted',
      Description: `Receipt: ${clean(row.Reference || sourceId)}`, Reference: clean(row.Reference || sourceId),
      Source: 'Fee Payment', SourceId: sourceId, RecordedBy: 'System',
      Lines: [
        { AccountCode: cash, Debit: amount, Credit: 0, Description: clean(row.Method || row.Gateway || 'Payment received') },
        { AccountCode: '1100', Debit: 0, Credit: amount, Description: clean(row.AccountRef || row.DisplayName) }
      ]
    }, true);
    existing.add(journalNo); created += 1;
  }
  for (const row of sales) {
    const sourceId = clean(row.ReceiptNo || row.receiptNo || row.__id);
    const journalNo = `SYS-FORM-${safeDocumentId(sourceId)}`;
    const amount = asMoneyNumber(row.AmountPaid || row.Amount || row.amount);
    if (!sourceId || amount <= 0 || existing.has(journalNo)) continue;
    await saveAccountingJournal(env, {
      JournalNo: journalNo, Date: row.PaymentDate || row.Timestamp || nowIso(), Status: 'Posted',
      Description: `Admission form sale: ${clean(row.ApplicantName || sourceId)}`, Reference: sourceId,
      Source: 'Admission Form Sale', SourceId: sourceId, RecordedBy: 'System',
      Lines: [
        { AccountCode: accountingCashAccountFor(row.PaymentMethod, row.Gateway), Debit: amount, Credit: 0, Description: 'Form sale receipt' },
        { AccountCode: '4010', Debit: 0, Credit: amount, Description: 'Admission form revenue' }
      ]
    }, true);
    existing.add(journalNo); created += 1;
  }
  return created;
}

async function saveChartAccount(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const code = clean(body.Code || body.code);
  if (!code || !clean(body.Name || body.name) || !clean(body.Type || body.type)) {
    const err = new Error('Account code, name and type are required.'); err.status = 400; throw err;
  }
  const existing = (await listCollection(env, 'chartOfAccounts')).find((row) => sameText(row.Code, code) || sameText(row.__id, code)) || {};
  const payload = {
    ...existing, Code: code, Name: clean(body.Name || body.name), Type: clean(body.Type || body.type),
    Group: clean(body.Group || body.group), NormalBalance: clean(body.NormalBalance || body.normalBalance) || 'Debit',
    Active: yesNo(body.Active ?? body.active ?? 'YES') || 'YES', System: clean(existing.System || 'NO'),
    CreatedAt: existing.CreatedAt || nowIso(), UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'chartOfAccounts', safeDocumentId(code), payload);
  await writeAccountingAudit(env, existing.Code ? 'UPDATE' : 'CREATE', 'Chart Account', code, body, payload.Name);
  return { ok: true, message: 'Chart of account saved.', account: payload };
}

async function saveAccountingExpense(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const expenseNo = clean(body.ExpenseNo || body.expenseNo) || ledgerDocumentId('EXP');
  const existing = (await listCollection(env, 'accountingExpenses')).find((row) => sameText(row.ExpenseNo, expenseNo) || sameText(row.__id, safeDocumentId(expenseNo))) || {};
  if (lower(existing.Status) === 'posted') {
    const err = new Error('Posted expenses cannot be edited. Use a reversal.'); err.status = 409; throw err;
  }
  const amount = asMoneyNumber(body.Amount || body.amount);
  if (amount <= 0 || !clean(body.Description || body.description)) {
    const err = new Error('Expense description and amount are required.'); err.status = 400; throw err;
  }
  const requestedStatus = clean(body.Status || body.status || 'Draft');
  if (['approved', 'posted', 'rejected'].includes(lower(requestedStatus))) {
    requireAccountingRole(body, ['Super Admin', 'Management'], 'Only Management or Super Admin can approve, reject, or post an expense.');
  }
  const payload = {
    ...existing, ExpenseNo: expenseNo, Date: clean(body.Date || body.date) || nowIso().slice(0, 10),
    Vendor: clean(body.Vendor || body.vendor), Description: clean(body.Description || body.description), Amount: amount,
    ExpenseAccount: clean(body.ExpenseAccount || body.expenseAccount) || '6090',
    PaymentAccount: clean(body.PaymentAccount || body.paymentAccount) || '1020',
    Department: clean(body.Department || body.department), CostCentre: clean(body.CostCentre || body.costCentre),
    BudgetCode: clean(body.BudgetCode || body.budgetCode), PaymentMethod: clean(body.PaymentMethod || body.paymentMethod),
    Reference: clean(body.Reference || body.reference), AttachmentUrl: clean(body.AttachmentUrl || body.attachmentUrl),
    Notes: clean(body.Notes || body.notes), Status: requestedStatus,
    RequestedBy: existing.RequestedBy || clean(body.RecordedBy || body.recordedBy), RequestedAt: existing.RequestedAt || nowIso(),
    ApprovedBy: ['approved', 'posted'].includes(lower(requestedStatus)) ? clean(body.RecordedBy || body.recordedBy) : '',
    ApprovedAt: ['approved', 'posted'].includes(lower(requestedStatus)) ? nowIso() : '', UpdatedAt: nowIso()
  };
  if (lower(requestedStatus) === 'posted') {
    const journal = await saveAccountingJournal(env, {
      JournalNo: `SYS-EXP-${safeDocumentId(expenseNo)}`, Date: payload.Date, Status: 'Posted',
      Description: payload.Description, Reference: payload.Reference || expenseNo, Source: 'Expense', SourceId: expenseNo,
      Department: payload.Department, CostCentre: payload.CostCentre, RecordedBy: clean(body.RecordedBy || body.recordedBy),
      Lines: [
        { AccountCode: payload.ExpenseAccount, Debit: amount, Credit: 0, Description: payload.Description, Department: payload.Department },
        { AccountCode: payload.PaymentAccount, Debit: 0, Credit: amount, Description: payload.Vendor || payload.PaymentMethod }
      ]
    }, true);
    payload.JournalNo = journal.JournalNo;
    payload.PostedAt = nowIso(); payload.PostedBy = clean(body.RecordedBy || body.recordedBy);
  }
  await upsertDocument(env, 'accountingExpenses', safeDocumentId(expenseNo), payload);
  await writeAccountingAudit(env, existing.ExpenseNo ? 'UPDATE' : 'CREATE', 'Expense', expenseNo, body, requestedStatus);
  return { ok: true, message: `Expense saved as ${requestedStatus}.`, expense: payload };
}

async function saveAccountingBudget(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const id = clean(body.BudgetId || body.budgetId) || [body.FinancialYear, body.Department, body.AccountCode].map(safeDocumentId).join('-');
  const payload = {
    BudgetId: id, FinancialYear: clean(body.FinancialYear || body.financialYear),
    AcademicSession: clean(body.AcademicSession || body.academicSession), Term: clean(body.Term || body.term),
    Department: clean(body.Department || body.department), AccountCode: clean(body.AccountCode || body.accountCode),
    Amount: asMoneyNumber(body.Amount || body.amount), Notes: clean(body.Notes || body.notes),
    Status: clean(body.Status || body.status || 'Approved'), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy || body.recordedBy)
  };
  if (!payload.FinancialYear || !payload.AccountCode || payload.Amount < 0) {
    const err = new Error('Financial year, account code and a valid amount are required.'); err.status = 400; throw err;
  }
  await upsertDocument(env, 'accountingBudgets', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Budget', id, body, `${payload.AccountCode}: ${payload.Amount}`);
  return { ok: true, message: 'Budget saved.', budget: payload };
}

async function saveAccountingBank(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const id = clean(body.BankId || body.bankId || body.AccountCode || body.accountCode) || ledgerDocumentId('BNK');
  const payload = {
    BankId: id, Name: clean(body.Name || body.name), BankName: clean(body.BankName || body.bankName),
    AccountNumber: clean(body.AccountNumber || body.accountNumber), AccountCode: clean(body.AccountCode || body.accountCode) || '1020',
    OpeningBalance: asMoneyNumber(body.OpeningBalance || body.openingBalance), Active: yesNo(body.Active ?? 'YES') || 'YES',
    UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy || body.recordedBy)
  };
  if (!payload.Name) { const err = new Error('Bank/cash account name is required.'); err.status = 400; throw err; }
  await upsertDocument(env, 'accountingBanks', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Bank Account', id, body, payload.Name);
  return { ok: true, message: 'Bank/cash account saved.', bank: payload };
}

async function saveAccountingReconciliation(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const id = clean(body.ReconciliationNo || body.reconciliationNo) || ledgerDocumentId('REC');
  const statement = asMoneyNumber(body.StatementBalance || body.statementBalance);
  const book = asMoneyNumber(body.BookBalance || body.bookBalance);
  const payload = {
    ReconciliationNo: id, BankId: clean(body.BankId || body.bankId), AccountCode: clean(body.AccountCode || body.accountCode) || '1020',
    StatementDate: clean(body.StatementDate || body.statementDate) || nowIso().slice(0, 10),
    StatementBalance: statement, BookBalance: book,
    OutstandingDeposits: asMoneyNumber(body.OutstandingDeposits || body.outstandingDeposits),
    UnpresentedPayments: asMoneyNumber(body.UnpresentedPayments || body.unpresentedPayments),
    ChargesAndAdjustments: asMoneyNumber(body.ChargesAndAdjustments || body.chargesAndAdjustments),
    Difference: asMoneyNumber(body.Difference || (statement - book)), Status: clean(body.Status || body.status || 'Draft'),
    Notes: clean(body.Notes || body.notes), PreparedBy: clean(body.RecordedBy || body.recordedBy), UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'accountingReconciliations', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Reconciliation', id, body, payload.Status);
  return { ok: true, message: 'Bank reconciliation saved.', reconciliation: payload };
}

async function saveAccountingPeriod(env, body) {
  requireAccountingRole(body, ['Super Admin']);
  const id = clean(body.PeriodId || body.periodId) || `${safeDocumentId(body.StartDate)}-${safeDocumentId(body.EndDate)}`;
  const payload = {
    PeriodId: id, Name: clean(body.Name || body.name), StartDate: clean(body.StartDate || body.startDate),
    EndDate: clean(body.EndDate || body.endDate), Status: clean(body.Status || body.status || 'Open'),
    ClosedAt: lower(body.Status) === 'closed' ? nowIso() : '', ClosedBy: lower(body.Status) === 'closed' ? clean(body.RecordedBy) : '',
    UpdatedAt: nowIso()
  };
  if (!payload.StartDate || !payload.EndDate || payload.StartDate > payload.EndDate) {
    const err = new Error('A valid period start and end date are required.'); err.status = 400; throw err;
  }
  await upsertDocument(env, 'accountingPeriods', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Accounting Period', id, body, payload.Status);
  return { ok: true, message: `Accounting period saved as ${payload.Status}.`, period: payload };
}

function buildAccountingReport(chart, journals, expenses, budgets) {
  const accounts = new Map(chart.map((row) => [clean(row.Code || row.code || row.__id), row]));
  const balances = new Map();
  const posted = journals.filter((row) => lower(row.Status || row.status) === 'posted');
  posted.forEach((journal) => accountingLines(journal.Lines || journal.lines).forEach((line) => {
    const code = clean(line.AccountCode || line.accountCode);
    const item = balances.get(code) || { AccountCode: code, Debit: 0, Credit: 0, Balance: 0 };
    item.Debit += asMoneyNumber(line.Debit || line.debit);
    item.Credit += asMoneyNumber(line.Credit || line.credit);
    item.Balance = item.Debit - item.Credit;
    balances.set(code, item);
  }));
  const trialBalance = Array.from(balances.values()).map((item) => ({
    ...item, AccountName: clean((accounts.get(item.AccountCode) || {}).Name),
    Type: clean((accounts.get(item.AccountCode) || {}).Type), Group: clean((accounts.get(item.AccountCode) || {}).Group)
  })).sort((a, b) => a.AccountCode.localeCompare(b.AccountCode));
  const revenueRows = trialBalance.filter((row) => lower(row.Type) === 'revenue');
  const grossRevenue = revenueRows.filter((row) => clean(row.Group) === 'Operating Revenue').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const otherIncome = revenueRows.filter((row) => clean(row.Group) === 'Other Income').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const concessions = revenueRows.filter((row) => row.AccountCode === '4100').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const netRevenue = grossRevenue - concessions;
  const totalIncome = netRevenue + otherIncome;
  const expenseRows = trialBalance.filter((row) => lower(row.Type) === 'expense');
  const directCosts = expenseRows.filter((row) => clean(row.Group) === 'Direct Cost').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const assets = trialBalance.filter((row) => lower(row.Type) === 'asset').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const liabilities = trialBalance.filter((row) => lower(row.Type) === 'liability').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const equity = trialBalance.filter((row) => lower(row.Type) === 'equity').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const cashPosition = trialBalance.filter((row) => ['1010', '1020', '1030'].includes(row.AccountCode)).reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const receivables = trialBalance.filter((row) => row.AccountCode === '1100').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const postedExpense = expenses.filter((row) => lower(row.Status) === 'posted').reduce((sum, row) => sum + asMoneyNumber(row.Amount), 0);
  const budgetTotal = budgets.reduce((sum, row) => sum + asMoneyNumber(row.Amount), 0);
  return {
    dashboard: { GrossRevenue: grossRevenue, OtherIncome: otherIncome, Concessions: concessions, NetRevenue: netRevenue, TotalIncome: totalIncome, DirectCosts: directCosts,
      GrossSurplus: netRevenue - directCosts, TotalExpenditure: totalExpenses, NetSurplus: totalIncome - totalExpenses,
      Assets: assets, Liabilities: liabilities, Equity: equity, PostedExpenses: postedExpense, BudgetTotal: budgetTotal,
      CashPosition: cashPosition, Receivables: receivables, BudgetRemaining: budgetTotal - totalExpenses },
    trialBalance,
    incomeStatement: { revenue: revenueRows, expenses: expenseRows },
    balanceSheet: { assets: trialBalance.filter((r) => lower(r.Type) === 'asset'), liabilities: trialBalance.filter((r) => lower(r.Type) === 'liability'), equity: trialBalance.filter((r) => lower(r.Type) === 'equity') }
  };
}

async function getAccountingOverview(env) {
  const synchronized = await syncRevenueToAccounting(env);
  const [chart, journals, expenses, budgets, banks, reconciliations, periods, audit] = await Promise.all([
    listCollection(env, 'chartOfAccounts'), listCollection(env, 'accountingJournals'), listCollection(env, 'accountingExpenses'),
    listCollection(env, 'accountingBudgets'), listCollection(env, 'accountingBanks'), listCollection(env, 'accountingReconciliations'),
    listCollection(env, 'accountingPeriods'), listCollection(env, 'accountingAudit')
  ]);
  return { ok: true, message: 'Finance and accounting records loaded.', synchronized, chart, journals, expenses, budgets, banks, reconciliations, periods, audit,
    reports: buildAccountingReport(chart, journals, expenses, budgets) };
}

async function routeAction(env, action, body = {}) {
  switch (action) {
    case 'ping':
      return {
        ok: true,
        message: 'Firestore backend is reachable.',
        backend: 'firestore',
        projectId: env.FIREBASE_PROJECT_ID
      };
    case 'getApplications':
      return {
        ok: true,
        message: 'Applications loaded from Firestore.',
        applications: (await listCollection(env, 'applications')).map(normalizeApplication)
      };
    case 'getStudents':
      return {
        ok: true,
        message: 'Students loaded from Firestore.',
        students: (await listCollection(env, 'students')).map(normalizeStudent)
      };
    case 'getAdmissionClasses':
      return getAdmissionClasses(env);
    case 'saveAdmissionClasses':
      return saveAdmissionClasses(env, body);
    case 'getSchoolClasses':
      return getSchoolClasses(env);
    case 'saveSchoolClasses':
      return saveSchoolClasses(env, body);
    case 'saveFeeItem':
      return saveFeeItem(env, body);
    case 'deleteFeeItem':
      return deleteFeeItem(env, body);
    case 'seedDefaultFeeItems':
      return seedDefaultFeeItems(env);
    case 'generateSchoolFeeInvoices':
      return generateSchoolFeeInvoices(env, body);
    case 'recordManualPayment':
      return recordManualPayment(env, body);
    case 'getWalletCardAccount':
      return getWalletCardAccount(env, body);
    case 'saveWalletCard':
      return saveWalletCard(env, body);
    case 'recordWalletPurchase':
      return recordWalletPurchase(env, body);
    case 'recordCreditAction':
      return recordCreditAction(env, body);
    case 'updateStudentBillingCategory':
      return updateStudentBillingCategory(env, body);
    case 'updateStudentStatus':
      return updateStudentStatus(env, body);
    case 'getAccountsOverview':
      return getAccountsOverview(env);
    case 'getAccountingOverview':
      return getAccountingOverview(env);
    case 'syncAccountingRevenue':
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      return { ok: true, message: 'Revenue subledgers synchronized.', created: await syncRevenueToAccounting(env) };
    case 'saveChartAccount':
      return saveChartAccount(env, body);
    case 'saveAccountingJournal':
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      return { ok: true, message: 'Journal saved.', journal: await saveAccountingJournal(env, body) };
    case 'saveAccountingExpense':
      return saveAccountingExpense(env, body);
    case 'saveAccountingBudget':
      return saveAccountingBudget(env, body);
    case 'saveAccountingBank':
      return saveAccountingBank(env, body);
    case 'saveAccountingReconciliation':
      return saveAccountingReconciliation(env, body);
    case 'saveAccountingPeriod':
      return saveAccountingPeriod(env, body);
    case 'saveBrevoSettings':
      return saveBrevoSettings(env, body);
    case 'saveSchoolProfile':
      return saveSchoolProfile(env, body);
    case 'getSchoolProfile':
      return getSchoolProfile(env);
    case 'getPayableFees':
      return getPayableFees(env, body);
    case 'getClinicRecords':
      return {
        ok: true,
        message: 'Clinic records loaded from Firestore.',
        records: (await listCollection(env, 'clinicRecords')).map(normalizeClinicRecord)
      };
    case 'saveClinicRecord':
      return saveClinicRecord(env, body);
    case 'getClinicInventory':
      return {
        ok: true,
        message: 'Clinic inventory loaded from Firestore.',
        inventory: (await listCollection(env, 'clinicInventory')).map(normalizeInventory)
      };
    case 'saveClinicInventoryItem':
      return saveInventoryItem(env, body, 'clinicInventory', { label: 'Clinic', category: 'Medical Supply', unit: 'pcs' });
    case 'deleteClinicInventoryItem':
      return deleteInventoryItem(env, body, 'clinicInventory', 'Clinic');
    case 'recordClinicStockMovement':
      return recordStockMovement(env, body, 'clinicInventory', 'clinicMovements', { label: 'Clinic', prefix: 'MED', actor: 'Clinic' });
    case 'getKitchenInventory':
      return {
        ok: true,
        message: 'Kitchen inventory loaded from Firestore.',
        inventory: (await listCollection(env, 'kitchenInventory')).map(normalizeInventory)
      };
    case 'saveKitchenInventoryItem':
      return saveInventoryItem(env, body, 'kitchenInventory', { label: 'Kitchen', category: 'Foodstuff', unit: 'kg' });
    case 'deleteKitchenInventoryItem':
      return deleteInventoryItem(env, body, 'kitchenInventory', 'Kitchen');
    case 'recordKitchenStockMovement':
      return recordStockMovement(env, body, 'kitchenInventory', 'kitchenMovements', { label: 'Kitchen', prefix: 'KIT', actor: 'Kitchen' });
    case 'updateApplicationStatus':
      return updateApplicationStatus(env, body);
    case 'updateApplicantNotes':
      return updateApplicantNotes(env, body);
    case 'updateEntranceResult':
      return updateEntranceResult(env, body);
    case 'updateApplicantIntelligence':
      return updateApplicantIntelligence(env, body);
    case 'updateApplicationDetails':
      return updateApplicationDetails(env, body);
    case 'deleteApplication':
      return deleteApplication(env, body);
    case 'importStudents':
      return importStudents(env, body);
    case 'promoteStudents':
      return promoteStudents(env, body);
    case 'enrollStudent':
      return enrollStudent(env, body);
    case 'markResultSent':
      return markApplicationFlag(env, body, 'ResultSent', 'ResultSentAt', 'Entrance result marked as sent.');
    case 'markOfferSent':
      return markApplicationFlag(env, body, 'OfferSent', 'OfferSentAt', 'Offer marked as sent.');
    case 'markAdmissionLetterSent':
      return markApplicationFlag(env, body, 'AdmissionLetterSent', 'AdmissionLetterSentAt', 'Admission letter marked as sent.');
    case 'recordSale':
      return recordSale(env, body);
    case 'getFormSales':
      return getFormSales(env);
    default: {
      const err = new Error(`Firestore backend action is not implemented yet: ${action}`);
      err.status = 400;
      throw err;
    }
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await request.json().catch(() => ({}));
    requireBackendSecret(env, body);
    const action = clean(body.Action || body.action);
    if (!action) {
      return Response.json({ ok: false, message: 'Action is required.' }, { status: 400 });
    }
    const data = await routeAction(env, action, body);
    return Response.json(data);
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status: err.status || 500 });
  }
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const url = new URL(request.url);
    const action = clean(url.searchParams.get('action') || url.searchParams.get('Action'));
    if (action) {
      requireBackendSecret(env, {
        Secret: url.searchParams.get('secret') || url.searchParams.get('Secret')
      });
      const data = await routeAction(env, action, {});
      return Response.json(data);
    }
    return Response.json({
      ok: true,
      message: 'Firestore backend is reachable.',
      backend: 'firestore',
      projectId: env.FIREBASE_PROJECT_ID
    });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status: 500 });
  }
}
