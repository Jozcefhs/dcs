import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountingDestinationForPayment,
  applyBillingCategoryOverrides,
  buildBudgetVsActual,
  buildReceivablesAgeing,
  calculateInvoiceCreditAllocations,
  financialRowMatchesAccount,
  paymentCreditedAmount,
  reconciliationDifference,
  sameFinancialPeriod
} from '../functions/api/backend.js';

test('a padded account reference cannot receive another student payment', () => {
  const payment = { AccountRef: 'DCA/26/001', Credit: 92843.92 };
  assert.equal(financialRowMatchesAccount(payment, {
    AccountRef: 'DCA/26/001', AdmissionNo: 'DCA/26/001'
  }), true);
  assert.equal(financialRowMatchesAccount(payment, {
    AccountRef: 'DCA/26/000001', AdmissionNo: 'DCA/26/001'
  }), false);
});

test('identity matching does not cross AccountRef and AdmissionNo fields', () => {
  assert.equal(financialRowMatchesAccount(
    { AccountRef: 'A-100' },
    { AccountRef: 'B-200', AdmissionNo: 'A-100' }
  ), false);
});

test('Paystack credits the student with the net amount requested by policy', () => {
  assert.equal(paymentCreditedAmount({
    Amount: 100000, GrossAmount: 100000, GatewayFee: 1500, NetAmount: 98500
  }), 98500);
  assert.equal(paymentCreditedAmount({ Amount: 100000, GatewayFee: 0 }), 100000);
});

test('payment accounting routes wallets, stores, receivables, and direct revenue correctly', () => {
  assert.equal(accountingDestinationForPayment({ FeeCode: 'WALLET_TOPUP' }), '2200');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'STORE_CART' }), '4040');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'TUITION', FeeCategory: 'School Fee' }, true), '1100');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'TUITION', FeeCategory: 'School Fee' }, false), '4000');
  assert.equal(accountingDestinationForPayment({ FeeCode: 'ACCEPTANCE_FEE', FeeCategory: 'Admission' }, false), '4010');
});

test('financial periods require the same session and term', () => {
  assert.equal(sameFinancialPeriod({ AcademicSession: '2026/2027', Term: 'First Term' }, '2026/2027', 'First Term'), true);
  assert.equal(sameFinancialPeriod({ AcademicSession: '2025/2026', Term: 'First Term' }, '2026/2027', 'First Term'), false);
  assert.equal(sameFinancialPeriod({ AcademicSession: '2026/2027', Term: 'Second Term' }, '2026/2027', 'First Term'), false);
});

test('specific billing category replaces the All-category fee', () => {
  const fees = [
    { FeeCode: 'TUITION-ALL', FeeName: 'Tuition', FeeCategory: 'School Fee', BillingCategory: 'All', ClassName: 'JSS 1', Term: 'First Term', Amount: 100000 },
    { FeeCode: 'TUITION-STAFF', FeeName: 'Tuition', FeeCategory: 'School Fee', BillingCategory: 'Staff Child', ClassName: 'JSS 1', Term: 'First Term', Amount: 50000 }
  ];
  const selected = applyBillingCategoryOverrides(fees, { BillingCategory: 'Staff Child' });
  assert.deepEqual(selected.map((row) => row.FeeCode), ['TUITION-STAFF']);
});

test('budget actuals remain scoped to department and latest financial year', () => {
  const rows = buildBudgetVsActual([
    { FinancialYear: '2025', Department: 'Accounts', AccountCode: '6090', Amount: 1000 },
    { FinancialYear: '2026', Department: 'Accounts', AccountCode: '6090', Amount: 5000 },
    { FinancialYear: '2026', Department: 'Academic', AccountCode: '6090', Amount: 7000 }
  ], [{
    Date: '2026-06-01', Status: 'Posted', Lines: [
      { AccountCode: '6090', Department: 'Accounts', Debit: 1200, Credit: 0 },
      { AccountCode: '6090', Department: 'Academic', Debit: 2300, Credit: 0 },
      { AccountCode: '1020', Credit: 3500, Debit: 0 }
    ]
  }]);
  assert.deepEqual(rows.map((row) => [row.FinancialYear, row.Department, row.Actual, row.Variance]), [
    ['2026', 'Accounts', 1200, 3800],
    ['2026', 'Academic', 2300, 4700]
  ]);
});

test('school-fees-total payment is allocated FIFO across component invoices in the same period', () => {
  const ageing = buildReceivablesAgeing([
    { InvoiceId: 'INV-1', AccountRef: 'STU-1', FeeCode: 'TUITION', FeeCategory: 'School Fee', AcademicSession: '2026/2027', Term: 'First Term', Amount: 60000, Date: '2026-09-01' },
    { InvoiceId: 'INV-2', AccountRef: 'STU-1', FeeCode: 'DEVELOPMENT', FeeCategory: 'School Fee', AcademicSession: '2026/2027', Term: 'First Term', Amount: 40000, Date: '2026-09-02' }
  ], [{
    AccountRef: 'STU-1', FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', AcademicSession: '2026/2027', Term: 'First Term', Amount: 70000, Status: 'Paid'
  }], '2026-09-30');
  assert.equal(ageing.length, 1);
  assert.equal(ageing[0].Reference, 'INV-2');
  assert.equal(ageing[0].PaidAmount, 10000);
  assert.equal(ageing[0].Balance, 30000);
});

test('part payment updates multiple component invoices without over-crediting', () => {
  const result = calculateInvoiceCreditAllocations([
    { InvoiceId: 'INV-1', Debit: 60000, Credit: 10000 },
    { InvoiceId: 'INV-2', Debit: 40000, Credit: 0 }
  ], 70000);
  assert.deepEqual(result.allocations.map((row) => [row.invoice.InvoiceId, row.AppliedCredit, row.Credit, row.Balance, row.Status]), [
    ['INV-1', 50000, 60000, 0, 'Paid'],
    ['INV-2', 20000, 20000, 20000, 'Part Paid']
  ]);
  assert.equal(result.remaining, 0);
});

test('bank reconciliation includes deposits, unpresented payments, and charges', () => {
  assert.equal(reconciliationDifference(100000, 94000, 5000, 8000, 1000), 4000);
});
