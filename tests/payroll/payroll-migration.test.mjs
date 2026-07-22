import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollTaxPhase2MigrationPlan } from '../../functions/lib/payroll/tax-config-service.js';

function fixture() {
  return {
    markers: [],
    profiles: [{
      __id: 'EMP-1', EmployeeId: 'EMP-1', Username: 'peter', BasicSalary: 100000,
      TaxRate: 5, PensionRate: 8,
      Allowances: [{ Name: 'Housing', Amount: 25000 }],
      Deductions: [{ Name: 'Union Due', Amount: 1500 }]
    }],
    runs: [{ __id: 'PAY-202601', RunId: 'PAY-202601', TotalGross: 125000, TotalDeductions: 17750, TotalNet: 107250 }],
    items: [{ __id: 'PAY-202601-EMP-1', ItemId: 'PAY-202601-EMP-1', GrossPay: 125000, TaxAmount: 6250, NetPay: 107250 }],
    existingComponents: [], existingTaxProfiles: []
  };
}

test('migration dry-run plans additive writes without requiring a backup', () => {
  const plan = buildPayrollTaxPhase2MigrationPlan(fixture(), { Apply: 'NO' });
  assert.equal(plan.report.Apply, false);
  assert.ok(plan.report.DocumentsPlanned > 0);
  assert.equal(plan.report.PayrollProfiles, 1);
  assert.equal(plan.report.LegacyItemsToMark, 1);
});

test('migration apply requires a verified backup reference', () => {
  assert.throws(
    () => buildPayrollTaxPhase2MigrationPlan(fixture(), { Apply: 'YES' }),
    (error) => error.code === 'PAYROLL_BACKUP_REQUIRED' && error.status === 409
  );
});

test('migration preserves historical amounts and adds legacy trace markers', () => {
  const source = fixture();
  const plan = buildPayrollTaxPhase2MigrationPlan(source, { Apply: 'YES', BackupReference: 'backup-2026-07-22.zip', RecordedBy: 'Admin' });
  const run = plan.writes.find((write) => write.collectionPath === 'payrollRuns').data;
  const item = plan.writes.find((write) => write.collectionPath === 'payrollItems').data;
  assert.equal(run.TotalGross, 125000);
  assert.equal(run.TotalDeductions, 17750);
  assert.equal(run.TotalNet, 107250);
  assert.equal(item.GrossPay, 125000);
  assert.equal(item.TaxAmount, 6250);
  assert.equal(item.NetPay, 107250);
  assert.equal(item.TaxTraceStatus, 'LEGACY_UNAVAILABLE');
  assert.equal(item.LegacyTaxAmount, 6250);
  assert.equal(plan.marker.BackupReference, 'backup-2026-07-22.zip');
});

test('migration is idempotent after its marker exists', () => {
  const input = fixture();
  input.markers = [{ __id: 'PAYE-PHASE2-V1', MigrationId: 'PAYE-PHASE2-V1', Status: 'APPLIED' }];
  const plan = buildPayrollTaxPhase2MigrationPlan(input, { Apply: 'YES', BackupReference: 'backup.zip' });
  assert.equal(plan.alreadyApplied, true);
  assert.deepEqual(plan.writes, []);
});

test('existing tax profiles are never overwritten by migration seeds', () => {
  const input = fixture();
  input.existingTaxProfiles = [{ __id: 'CUSTOM-V1', ProfileId: 'CUSTOM-V1', Name: 'School Verified Rules' }];
  const plan = buildPayrollTaxPhase2MigrationPlan(input, { Apply: 'YES', BackupReference: 'backup.zip' });
  assert.equal(plan.writes.some((write) => write.collectionPath === 'payrollTaxProfiles'), false);
});
