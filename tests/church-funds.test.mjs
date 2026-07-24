import test from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveFundMapping,
  fundCapabilities,
  normalizeChurchFund,
  normalizeFundMapping,
  validateFundMappingAccounts
} from '../functions/lib/church-funds.js';
import { buildOfferingJournalDraft } from '../functions/lib/church-foundation.js';

test('fund capabilities keep setup changes with treasury roles', () => {
  assert.equal(fundCapabilities({ role: 'Pastor' }).canView, true);
  assert.equal(fundCapabilities({ role: 'Pastor' }).canManageFunds, false);
  assert.equal(fundCapabilities({ role: 'Treasurer' }).canManageFunds, true);
  assert.equal(fundCapabilities({ role: 'Treasurer' }).canManageMappings, true);
  assert.equal(fundCapabilities({ role: 'Membership Officer' }).canView, false);
});

test('church funds normalize branch, type, currency, and lifecycle dates', () => {
  const fund = normalizeChurchFund({
    FundId: 'BUILDING', Name: 'Building Fund', FundType: 'restricted',
    Currency: 'ngn', StartDate: '2026-07-01', EndDate: '2027-06-30'
  }, 'Lagos');
  assert.equal(fund.BranchId, 'lagos');
  assert.equal(fund.FundType, 'Restricted');
  assert.equal(fund.Currency, 'NGN');
  assert.throws(() => normalizeChurchFund({ FundId: 'X', Name: 'X', Currency: 'Naira' }), /three-letter/);
  assert.throws(
    () => normalizeChurchFund({ FundId: 'X', Name: 'X', StartDate: '2026-08-01', EndDate: '2026-07-01' }),
    /cannot be before/
  );
});

test('fund mappings require distinct asset and revenue accounts', () => {
  const mapping = normalizeFundMapping({
    FundId: 'BUILDING', DebitAccountCode: '1000',
    IncomeAccountCode: '4100', EffectiveFrom: '2026-07-01'
  }, 'main');
  const result = validateFundMappingAccounts(mapping, [
    { Code: '1000', Name: 'Bank', Type: 'Asset', Active: 'YES' },
    { Code: '4100', Name: 'Offering Income', Type: 'Revenue', Active: 'YES' }
  ]);
  assert.equal(result.DebitAccountName, 'Bank');
  assert.equal(result.IncomeAccountName, 'Offering Income');
  assert.throws(
    () => normalizeFundMapping({ FundId: 'BUILDING', DebitAccountCode: '1000', IncomeAccountCode: '1000' }),
    /must be different/
  );
  assert.throws(
    () => validateFundMappingAccounts(mapping, [
      { Code: '1000', Name: 'Bank', Type: 'Expense', Active: 'YES' },
      { Code: '4100', Name: 'Offering Income', Type: 'Revenue', Active: 'YES' }
    ]),
    /Asset account/
  );
});

test('effective mapping respects active date windows', () => {
  const mappings = [
    { FundId: 'GENERAL', Active: 'NO' },
    { FundId: 'GENERAL', Active: 'YES', EffectiveFrom: '2026-08-01' },
    { FundId: 'GENERAL', Active: 'YES', EffectiveFrom: '2026-01-01', EffectiveTo: '2026-07-31' },
    { FundId: 'GENERAL', Active: 'YES', EffectiveFrom: '2026-07-01', EffectiveTo: '2026-07-31' }
  ];
  assert.equal(effectiveFundMapping(mappings, 'GENERAL', '2026-07-24'), mappings[3]);
  assert.equal(effectiveFundMapping(mappings, 'GENERAL', '2025-12-31'), null);
});

test('fund income mappings feed the established accounting journal draft', () => {
  const journal = buildOfferingJournalDraft({
    OfferingId: 'OFF-001', BranchId: 'main', Date: '2026-07-24',
    TotalAmount: 25000, RecordedBy: 'treasurer'
  }, {
    DebitAccountCode: '1000', IncomeAccountCode: '4100'
  });
  assert.equal(journal.Source, 'Church Offering');
  assert.equal(journal.Status, 'Draft');
  assert.equal(journal.Lines[0].Debit, 25000);
  assert.equal(journal.Lines[1].AccountCode, '4100');
  assert.equal(journal.Lines[1].Credit, 25000);
});
