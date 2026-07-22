import { getAccountsOverview } from './backend.js';
import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection } from '../lib/school-scope.js';

function clean(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function publicRows(rows, limit = 50) {
  return (rows || []).slice(0, limit).map((row) => {
    const copy = { ...row };
    delete copy.WalletPinHash;
    delete copy.PasswordHash;
    return copy;
  });
}

function sortRecent(rows, dateKeys) {
  return [...(rows || [])].sort((a, b) => {
    const av = dateKeys.map((key) => a[key]).find(Boolean) || '';
    const bv = dateKeys.map((key) => b[key]).find(Boolean) || '';
    return String(bv).localeCompare(String(av));
  });
}

function accountKey(value) {
  return clean(value).toLowerCase();
}

function isBoardingStudent(row) {
  const value = clean(row.StudentType || row.studentType || row.BoardingPreference || row.boardingPreference || row.ResidencyType || row.residencyType || row.Tags).toLowerCase();
  return /board(ing|er)?|hostel|resident/.test(value) && !/non[- ]?boarding/.test(value);
}

function reconcileInvoiceDisplay(invoices, accounts) {
  const accountMap = new Map();
  (accounts || []).forEach((account) => {
    const keys = [
      account.AccountRef,
      account.AdmissionNo,
      account.ApplicationReference,
      account.__id
    ].map(accountKey).filter(Boolean);
    keys.forEach((key) => accountMap.set(key, account));
  });
  return (invoices || []).map((invoice) => {
    const account = accountMap.get(accountKey(invoice.AccountRef)) ||
      accountMap.get(accountKey(invoice.AdmissionNo)) ||
      accountMap.get(accountKey(invoice.ApplicationReference));
    if (!account || toNumber(account.OutstandingBalance) > 0) return invoice;
    const debit = toNumber(invoice.Debit || invoice.Amount);
    const currentCredit = toNumber(invoice.Credit || invoice.PaidAmount);
    return {
      ...invoice,
      Credit: currentCredit > 0 ? currentCredit : debit,
      Balance: 0,
      Status: 'Paid'
    };
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const allowed = new Set(user.allowedSections || []);
    if (!allowed.size) {
      const err = new Error('Your staff role does not currently have a web dashboard section assigned.');
      err.status = 403;
      throw err;
    }

    const [
      applications,
      students,
      formSales,
      payments,
      invoices,
      ledger,
      clinicRecords,
      clinicInventory,
      kitchenInventory,
      clinicMovements,
      kitchenMovements
    ] = await Promise.all([
      allowed.has('admissions') ? listSchoolCollection(env, 'applications') : Promise.resolve([]),
      allowed.has('students') ? listSchoolCollection(env, 'students') : Promise.resolve([]),
      allowed.has('formPurchases') ? listCollection(env, 'formSales') : Promise.resolve([]),
      allowed.has('accounts') ? listCollection(env, 'payments') : Promise.resolve([]),
      allowed.has('accounts') ? listCollection(env, 'invoices') : Promise.resolve([]),
      (allowed.has('accounts') || allowed.has('tuckShop')) ? listCollection(env, 'ledger') : Promise.resolve([]),
      allowed.has('clinic') ? listCollection(env, 'clinicRecords') : Promise.resolve([]),
      allowed.has('clinic') ? listCollection(env, 'clinicInventory') : Promise.resolve([]),
      allowed.has('kitchen') ? listCollection(env, 'kitchenInventory') : Promise.resolve([]),
      allowed.has('clinic') ? listCollection(env, 'clinicMovements') : Promise.resolve([]),
      allowed.has('kitchen') ? listCollection(env, 'kitchenMovements') : Promise.resolve([])
    ]);

    let accountOverview = null;
    if (allowed.has('accounts')) {
      try {
        accountOverview = await getAccountsOverview(env);
      } catch (_err) {
        accountOverview = null;
      }
    }
    const displayInvoices = reconcileInvoiceDisplay(invoices, accountOverview && accountOverview.ok ? accountOverview.accounts : []);
    const staffScope = (rows) => rows.filter((row) => {
      const branchAllowed = !clean(user.branchId) || !clean(row.BranchId) || clean(row.BranchId).toLowerCase() === clean(user.branchId).toLowerCase();
      const sectionAccess = clean(user.schoolSectionAccess || 'All').toLowerCase();
      const sectionAllowed = sectionAccess === 'all' || !clean(row.SchoolSection) || clean(row.SchoolSection).toLowerCase() === sectionAccess;
      return user.role === 'Super Admin' || (branchAllowed && sectionAllowed);
    });
    const visibleApplications = staffScope(applications);
    const visibleStudents = staffScope(students);
    const walletPurchases = ledger.filter((row) => clean(row.EntryType).toLowerCase() === 'wallet purchase');
    const lowClinic = clinicInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));
    const lowKitchen = kitchenInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));

    const allDepartments = {
      admissions: publicRows(sortRecent(visibleApplications, ['SubmittedAt', 'UpdatedAt', 'Timestamp']), 80),
      students: publicRows(sortRecent(visibleStudents, ['UpdatedAt', 'EnrolledAt', 'CreatedAt']), 80),
      formPurchases: publicRows(sortRecent(formSales, ['PaymentDate', 'UpdatedAt', 'CreatedAt']), 80),
      accounts: {
        payments: publicRows(sortRecent(payments, ['PaidAt', 'Date', 'RecordedAt']), 80),
        invoices: publicRows(sortRecent(displayInvoices, ['Date', 'CreatedAt', 'DueDate']), 80),
        ledger: publicRows(sortRecent(ledger, ['Date', 'CreatedAt']), 100)
      },
      clinic: {
        records: publicRows(sortRecent(clinicRecords, ['Date', 'CreatedAt']), 80),
        inventory: publicRows(sortRecent(clinicInventory, ['LastUpdated', 'UpdatedAt']), 80),
        lowStock: publicRows(lowClinic, 80),
        movements: publicRows(sortRecent(clinicMovements, ['Date', 'CreatedAt']), 80)
      },
      kitchen: {
        inventory: publicRows(sortRecent(kitchenInventory, ['LastUpdated', 'UpdatedAt']), 80),
        lowStock: publicRows(lowKitchen, 80),
        movements: publicRows(sortRecent(kitchenMovements, ['Date', 'CreatedAt']), 80)
      },
      tuckShop: {
        purchases: publicRows(sortRecent(walletPurchases, ['Date', 'CreatedAt']), 100)
      }
    };
    const departments = Object.fromEntries(Object.entries(allDepartments).filter(([key]) => allowed.has(key)));
    const summary = {};
    if (allowed.has('admissions')) summary.applications = visibleApplications.length;
    if (allowed.has('students')) {
      summary.students = visibleStudents.length;
      summary.boardingStudents = visibleStudents.filter(isBoardingStudent).length;
      summary.dayStudents = visibleStudents.length - summary.boardingStudents;
    }
    if (allowed.has('formPurchases')) summary.formPurchases = formSales.length;
    if (allowed.has('accounts')) {
      summary.payments = payments.length;
      summary.invoices = invoices.length;
    }
    if (allowed.has('clinic')) {
      summary.clinicRecords = clinicRecords.length;
      summary.clinicInventory = clinicInventory.length;
      summary.lowClinicStock = lowClinic.length;
    }
    if (allowed.has('kitchen')) {
      summary.kitchenInventory = kitchenInventory.length;
      summary.lowKitchenStock = lowKitchen.length;
    }
    if (allowed.has('tuckShop')) summary.tuckShopPurchases = walletPurchases.length;

    const countBy = (rows, getter) => Object.entries(rows.reduce((out, row) => {
      const key = clean(getter(row)) || 'Unspecified'; out[key] = (out[key] || 0) + 1; return out;
    }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const accountRows = accountOverview && accountOverview.ok ? accountOverview.accounts || [] : [];
    const classBalances = Object.entries(accountRows.reduce((out, row) => {
      const key = clean(row.ClassName) || 'Unspecified'; out[key] = (out[key] || 0) + Math.max(0, toNumber(row.OutstandingBalance ?? row.Balance)); return out;
    }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const charts = {
      studentGender: countBy(visibleStudents, (row) => row.Gender),
      studentCategory: countBy(visibleStudents, (row) => row.EnrollmentCategory || row.IntakeCategory || 'Returning'),
      classBalances,
      topDefaulters: accountRows.filter((row) => toNumber(row.OutstandingBalance ?? row.Balance) > 0)
        .sort((a, b) => toNumber(b.OutstandingBalance ?? b.Balance) - toNumber(a.OutstandingBalance ?? a.Balance)).slice(0, 10)
        .map((row) => ({ label: clean(row.DisplayName || row.AccountRef), secondary: clean(row.ClassName), value: toNumber(row.OutstandingBalance ?? row.Balance) }))
    };

    return Response.json({
      ok: true,
      message: 'Staff dashboard loaded.',
      user,
      allowedSections: user.allowedSections,
      summary,
      charts,
      departments
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
