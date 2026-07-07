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

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
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

function normalizeApplication(row) {
  const parent = row.parent && typeof row.parent === 'object' ? row.parent : {};
  const applicantName = pick(row, ['applicantName', 'ApplicantName', 'displayName', 'DisplayName']);
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

function normalizeStudent(row) {
  const displayName = pick(row, ['displayName', 'DisplayName', 'applicantName', 'ApplicantName']);
  return {
    ...row,
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo', '__id']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    ApplicantName: displayName,
    DisplayName: displayName,
    ClassAdmitted: pick(row, ['className', 'ClassName', 'classAdmitted', 'ClassAdmitted']),
    ClassName: pick(row, ['className', 'ClassName', 'classAdmitted', 'ClassAdmitted']),
    StudentType: pick(row, ['studentType', 'StudentType'], 'Day Student'),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    ParentEmail: lower(pick(row, ['parentEmail', 'ParentEmail'])),
    ParentPhone: pick(row, ['parentPhone', 'ParentPhone']),
    WalletCardId: pick(row, ['walletCardId', 'WalletCardId']),
    WalletCardStatus: pick(row, ['walletCardStatus', 'WalletCardStatus']),
    Status: pick(row, ['status', 'Status'], 'Active')
  };
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
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    Amount: asMoneyNumber(pick(row, ['amount', 'Amount'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    Gateway: pick(row, ['gateway', 'Gateway']),
    Method: pick(row, ['method', 'Method']),
    Reference: pick(row, ['reference', 'Reference']),
    Date: toDisplayDate(pick(row, ['paidAt', 'Date'])),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy'])
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
  const aParts = a.match(/^([a-z]+)(\d+)(\d+)$/);
  const bParts = b.match(/^([a-z]+)(\d+)(\d+)$/);
  return Boolean(aParts && bParts && aParts[1] === bParts[1] && aParts[2] === bParts[2] && String(Number(aParts[3])) === String(Number(bParts[3])));
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

export async function getPayableFees(env, body = {}) {
  const email = lower(body.Email || body.email);
  const code = clean(body.VerificationCode || body.code).toUpperCase();
  if (!email || !code) {
    const err = new Error('Email and verification code are required.');
    err.status = 400;
    throw err;
  }

  const applications = (await listCollection(env, 'applications')).map(normalizeApplication);
  const app = applications.find((row) => lower(row.VerificationEmail || row.Email || row.ParentEmail) === email && clean(row.VerificationCode).toUpperCase() === code);
  if (!app) {
    const err = new Error('Application not found for that email/code.');
    err.status = 404;
    throw err;
  }

  const accountRef = accountRefFromApplication(app);
  const student = await findStudentForApplication(env, app);
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

  const [feeRows, paymentRows, invoiceRows] = await Promise.all([
    listCollection(env, 'feeItems'),
    listCollection(env, 'payments'),
    listCollection(env, 'invoices')
  ]);
  const allFees = feeRows.map(normalizeFeeItem)
    .filter((row) => yesNo(row.Active) === 'YES')
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  const enrolledForBilling = Boolean(student) || yesNo(app.Enrolled) === 'YES' || normalizeMatchText(app.Status) === 'enrolled';
  const admittedForPreEnrollment = normalizeMatchText(app.ResultStatus) === 'admitted' || normalizeMatchText(app.Status) === 'admitted';
  const matchedFees = applyBillingCategoryOverrides(allFees.filter((fee) => {
    const amount = asMoneyNumber(fee.Amount);
    const category = normalizeMatchText(fee.FeeCategory || '');
    const requiredForEnrollment = yesNo(fee.RequiredForEnrollment) === 'YES';
    if (!isWalletFee(fee) && amount <= 0) return false;
    if (yesNo(fee.PayableOnline || 'YES') !== 'YES') return false;
    if (!feeMatchesApplication(fee, billingApp)) return false;
    if (clean(fee.FeeCode) === 'ACCEPTANCE_FEE' && yesNo(app.AcceptanceFeePaid) === 'YES') return false;
    if (!enrolledForBilling) {
      if (!admittedForPreEnrollment) return false;
      return category === 'admission' || requiredForEnrollment;
    }
    if (category === 'admission' || requiredForEnrollment) return false;
    return true;
  }), billingApp);

  const feeBalanceMap = {};
  const paymentCodeMap = {};
  const paymentNameMap = {};
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
  paymentRows.map(normalizePayment).filter(rowMatchesAccount).forEach((row) => {
    const status = normalizeMatchText(row.Status || 'Paid');
    if (status && status !== 'paid') return;
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    const metadataItems = parseFeeItems(metadata.feeItems || metadata.FeeItems || metadata.components || metadata.Components || nested.feeItems || nested.FeeItems || nested.components || nested.Components);
    if ((clean(row.FeeCode) === 'SCHOOL_FEES_TOTAL' || clean(metadata.paymentType || nested.paymentType) === 'SchoolFeesTotal') && metadataItems.length) {
      metadataItems.forEach((item) => {
        addPaid(paymentCodeMap, item.FeeCode, item.Amount);
        addPaid(paymentNameMap, item.FeeName, item.Amount);
        addPaid(paymentCodeMap, periodKey(item.FeeCode, item.AcademicSession || row.AcademicSession || nested.academicSession, item.Term || row.Term || nested.term), item.Amount);
        addPaid(paymentNameMap, periodKey(item.FeeName, item.AcademicSession || row.AcademicSession || nested.academicSession, item.Term || row.Term || nested.term), item.Amount);
      });
      return;
    }
    addPaid(paymentCodeMap, row.FeeCode, row.Amount);
    addPaid(paymentCodeMap, metadata.feeCode || metadata.componentFeeCode || nested.feeCode || nested.componentFeeCode, row.Amount);
    addPaid(paymentNameMap, row.FeeName, row.Amount);
    addPaid(paymentCodeMap, periodKey(row.FeeCode, row.AcademicSession || nested.academicSession, row.Term || nested.term), row.Amount);
    addPaid(paymentCodeMap, periodKey(metadata.feeCode || metadata.componentFeeCode || nested.feeCode || nested.componentFeeCode, row.AcademicSession || nested.academicSession, row.Term || nested.term), row.Amount);
    addPaid(paymentNameMap, periodKey(row.FeeName, row.AcademicSession || nested.academicSession, row.Term || nested.term), row.Amount);
  });

  let acceptanceCreditRemaining = enrolledForBilling && yesNo(app.AcceptanceFeePaid) === 'YES' ? asMoneyNumber(app.AcceptanceFeeAmount) : 0;
  if (acceptanceCreditRemaining <= 0 && enrolledForBilling) {
    acceptanceCreditRemaining = Math.max(asMoneyNumber(paymentCodeMap.ACCEPTANCE_FEE), asMoneyNumber(paymentNameMap['Acceptance Fee']));
  }

  const fees = matchedFees.map((fee) => {
    const copy = { ...fee };
    const originalAmount = asMoneyNumber(copy.Amount);
    const feeCode = clean(copy.FeeCode);
    const feeName = clean(copy.FeeName || feeCode);
    const codePeriodKey = periodKey(feeCode, copy.AcademicSession, copy.Term);
    const namePeriodKey = periodKey(feeName, copy.AcademicSession, copy.Term);
    const periodSpecific = isPeriodSpecificFee(copy);
    const scopedCodePaid = Math.max(asMoneyNumber(paymentCodeMap[codePeriodKey]), asMoneyNumber((feeBalanceMap[codePeriodKey] || {}).credit));
    const scopedNamePaid = Math.max(asMoneyNumber(paymentNameMap[namePeriodKey]), asMoneyNumber((feeBalanceMap[namePeriodKey] || {}).credit));
    const exactCodePaid = Math.max(scopedCodePaid, periodSpecific ? 0 : asMoneyNumber(paymentCodeMap[feeCode]), periodSpecific ? 0 : asMoneyNumber((feeBalanceMap[feeCode] || {}).credit));
    const feeNamePaid = Math.max(scopedNamePaid, periodSpecific ? 0 : asMoneyNumber(paymentNameMap[feeName]), periodSpecific ? 0 : asMoneyNumber((feeBalanceMap[feeName] || {}).credit));
    let paid = exactCodePaid > 0 ? exactCodePaid : feeNamePaid;
    const acceptanceCreditApplied = (!isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && acceptanceCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), acceptanceCreditRemaining)
      : 0;
    if (acceptanceCreditApplied > 0) {
      paid += acceptanceCreditApplied;
      acceptanceCreditRemaining -= acceptanceCreditApplied;
    }
    const balance = isWalletFee(fee) ? originalAmount : Math.max(0, originalAmount - paid);
    copy.OriginalAmount = originalAmount;
    copy.PaidAmount = paid;
    copy.AcceptanceCreditApplied = acceptanceCreditApplied;
    copy.BalanceAmount = balance;
    if (!isWalletFee(fee)) copy.Amount = balance;
    if (asMoneyNumber(copy.MinAmount) > balance) copy.MinAmount = balance;
    if (asMoneyNumber(copy.MaxAmount) <= 0 || asMoneyNumber(copy.MaxAmount) > balance) copy.MaxAmount = balance;
    copy.PaymentType = isWalletFee(fee) ? 'Wallet' : 'Fee';
    copy.AppliesTo = [copy.ClassName || 'All', copy.StudentType || 'All', copy.AcademicSession || 'All', copy.Term || 'All'].join(' / ');
    return copy;
  }).filter((fee) => isWalletFee(fee) || asMoneyNumber(fee.Amount) > 0);

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

async function getAccountsOverview(env) {
  const [accounts, payments, invoices, feeItems] = await Promise.all([
    listCollection(env, 'accounts'),
    listCollection(env, 'payments'),
    listCollection(env, 'invoices'),
    listCollection(env, 'feeItems')
  ]);
  const normalizedPayments = payments.map(normalizePayment);
  const normalizedInvoices = invoices.map(normalizeInvoice);
  const ledger = [
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
    ...normalizedPayments.map((row) => ({
      AccountRef: row.AccountRef,
      Date: row.Date,
      EntryType: 'Payment',
      FeeCategory: '',
      Description: row.FeeCode || 'Payment',
      Debit: 0,
      Credit: row.Amount,
      Reference: row.Reference,
      RecordedBy: row.RecordedBy
    }))
  ];
  return {
    ok: true,
    message: 'Accounts loaded from Firestore.',
    accounts: accounts.map(normalizeAccount),
    payments: normalizedPayments,
    invoices: normalizedInvoices,
    ledger,
    feeItems: feeItems.map(normalizeFeeItem)
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
  if (student && (body.AdmissionNo !== undefined || body.Term !== undefined)) {
    const studentUpdates = { ...student, UpdatedAt: now };
    if (body.AdmissionNo !== undefined) studentUpdates.AdmissionNo = clean(body.AdmissionNo);
    if (body.Term !== undefined) studentUpdates.Term = clean(body.Term);
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
    ResultUpdatedBy: clean(body.ResultUpdatedBy) || 'Admissions Office',
    ResultUpdatedAt: nowIso(),
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

function nextStudentAdmissionNo(students, session = '') {
  const yearMatch = clean(session).match(/20(\d{2})/);
  const yearCode = yearMatch ? yearMatch[1] : String(new Date().getFullYear()).slice(-2);
  let maxNo = 0;
  students.forEach((row) => {
    const admissionNo = pick(row, ['AdmissionNo', 'admissionNo', '__id']);
    const match = clean(admissionNo).match(/(\d+)$/);
    if (match) maxNo = Math.max(maxNo, Number(match[1]));
  });
  return `DCA/${yearCode}/${String(maxNo + 1).padStart(6, '0')}`;
}

async function importStudents(env, body) {
  const rows = Array.isArray(body.Students) ? body.Students : [];
  if (!rows.length) {
    const err = new Error('No student rows were supplied.');
    err.status = 400;
    throw err;
  }
  const existingStudents = await listCollection(env, 'students');
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
    if (!admissionNo) admissionNo = nextStudentAdmissionNo([...existingStudents, ...savedStudents], input.AcademicSession || input.Session || '');
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
    ParentEmail: pick(existing, ['FatherEmail', 'MotherEmail', 'VerificationEmail', 'ParentEmail']),
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
  const sale = {
    Time: body.Time || nowIso(),
    ReceiptNo: receiptNo || `DCA-FORM-${Date.now()}`,
    ApplicantName: clean(body.ApplicantName),
    Email: email,
    Phone: clean(body.Phone),
    ClassApplyingFor: clean(body.ClassApplyingFor),
    AmountPaid: clean(body.AmountPaid),
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

function normalizeAdmissionClass(row) {
  return {
    ...row,
    ClassName: pick(row, ['className', 'ClassName', '__id']),
    FormAmount: asMoneyNumber(pick(row, ['formAmount', 'FormAmount'])),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
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
  for (const item of classes) {
    const className = clean(item.ClassName || item.className || item);
    if (!className) continue;
    const payload = {
      ClassName: className,
      FormAmount: asMoneyNumber(item.FormAmount || item.formAmount || formAmount),
      Active: yesNo(item.Active ?? item.active ?? 'NO') || 'NO',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    };
    await upsertDocument(env, 'settings/admission/classes', safeDocumentId(className), payload);
    saved += 1;
  }
  return {
    ok: true,
    message: `Admission classes saved to Firestore (${saved}).`,
    saved,
    ...(await getAdmissionClasses(env))
  };
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
    case 'getAccountsOverview':
      return getAccountsOverview(env);
    case 'getPayableFees':
      return getPayableFees(env, body);
    case 'getClinicRecords':
      return {
        ok: true,
        message: 'Clinic records loaded from Firestore.',
        records: (await listCollection(env, 'clinicRecords')).map(normalizeClinicRecord)
      };
    case 'getClinicInventory':
      return {
        ok: true,
        message: 'Clinic inventory loaded from Firestore.',
        inventory: (await listCollection(env, 'clinicInventory')).map(normalizeInventory)
      };
    case 'getKitchenInventory':
      return {
        ok: true,
        message: 'Kitchen inventory loaded from Firestore.',
        inventory: (await listCollection(env, 'kitchenInventory')).map(normalizeInventory)
      };
    case 'updateApplicationStatus':
      return updateApplicationStatus(env, body);
    case 'updateApplicantNotes':
      return updateApplicantNotes(env, body);
    case 'updateEntranceResult':
      return updateEntranceResult(env, body);
    case 'updateApplicantIntelligence':
      return updateApplicantIntelligence(env, body);
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
