import test from 'node:test';
import assert from 'node:assert/strict';

import { isSchoolFeeCategory } from '../functions/api/backend.js';

test('manual school-fee total recognizes common school-fee category variants', () => {
  assert.equal(isSchoolFeeCategory('School Fee'), true);
  assert.equal(isSchoolFeeCategory('School Fees'), true);
  assert.equal(isSchoolFeeCategory('Tuition'), true);
  assert.equal(isSchoolFeeCategory(''), true);
});

test('manual school-fee total excludes unrelated payment categories', () => {
  assert.equal(isSchoolFeeCategory('Admission'), false);
  assert.equal(isSchoolFeeCategory('Wallet'), false);
  assert.equal(isSchoolFeeCategory('Optional'), false);
  assert.equal(isSchoolFeeCategory('Store'), false);
});
