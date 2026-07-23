import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStoreGender, storeGenderMatches } from '../functions/api/init-payment.js';

test('imported gender aliases normalize consistently', () => {
  assert.equal(normalizeStoreGender('F'), 'female');
  assert.equal(normalizeStoreGender('Girl'), 'female');
  assert.equal(normalizeStoreGender('Male Student'), 'male');
});

test('gender-neutral store items remain available to day and boarding students', () => {
  assert.equal(storeGenderMatches('All', 'Female'), true);
  assert.equal(storeGenderMatches('*', 'Male'), true);
  assert.equal(storeGenderMatches('', ''), true);
});

test('gender-specific items accept imported aliases without crossing genders', () => {
  assert.equal(storeGenderMatches('Female', 'Girl'), true);
  assert.equal(storeGenderMatches('Male', 'M'), true);
  assert.equal(storeGenderMatches('Male', 'Female'), false);
});
