import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findParentOwnedApplication,
  parentOwnsApplication
} from '../functions/api/parent-dashboard.js';

test('a parent may select a second sibling application after family authentication', () => {
  const applications = [
    {
      ApplicationReference: 'DCA/26/000001',
      VerificationEmail: 'parent@example.com',
      VerificationCode: 'FIRST1'
    },
    {
      ApplicationReference: 'DCA/26/000002',
      VerificationEmail: 'parent@example.com',
      VerificationCode: 'SECOND2'
    }
  ];

  const selected = findParentOwnedApplication(
    applications,
    'DCA/26/000002',
    'PARENT@EXAMPLE.COM'
  );

  assert.equal(selected, applications[1]);
});

test('a matching application reference is rejected when the parent email differs', () => {
  const application = {
    ApplicationReference: 'DCA/26/000002',
    VerificationEmail: 'another-parent@example.com'
  };

  assert.equal(parentOwnsApplication(application, 'parent@example.com'), false);
  assert.equal(
    findParentOwnedApplication([application], 'DCA/26/000002', 'parent@example.com'),
    null
  );
});
