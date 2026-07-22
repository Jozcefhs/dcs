import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAuthoritativeActor, isActiveStaffUser, resolveAuthoritativeDesktopActor, secureTextEqual
} from '../../functions/lib/backend-security.js';

test('shared-secret comparison accepts only an exact value', () => {
  assert.equal(secureTextEqual('school-secret', 'school-secret'), true);
  assert.equal(secureTextEqual('school-secret', 'school-secret-x'), false);
  assert.equal(secureTextEqual('', 'school-secret'), false);
});

test('authoritative staff record replaces client-supplied role and actor metadata', () => {
  const actor = resolveAuthoritativeDesktopActor(
    { UserUsername: 'ada', UserRole: 'Super Admin', RecordedBy: 'Forged' },
    [{ Username: 'Ada', DisplayName: 'Ada Okafor', Role: 'Accounts Officer', Department: 'Accounts', Active: true }]
  );
  const body = applyAuthoritativeActor({ UserRole: 'Super Admin', RecordedBy: 'Forged' }, actor);
  assert.deepEqual(
    { username: body.UserUsername, role: body.UserRole, department: body.UserDepartment, name: body.RecordedBy },
    { username: 'Ada', role: 'Accounts Officer', department: 'Accounts', name: 'Ada Okafor' }
  );
});

test('missing and disabled staff actors are rejected', () => {
  assert.throws(() => resolveAuthoritativeDesktopActor({ UserUsername: 'missing' }, []), /not found/i);
  assert.throws(
    () => resolveAuthoritativeDesktopActor({ UserUsername: 'disabled' }, [{ Username: 'disabled', Active: 'NO' }]),
    /disabled/i
  );
  assert.equal(isActiveStaffUser({ Active: 'YES' }), true);
  assert.equal(isActiveStaffUser({ Active: 'disabled' }), false);
});

test('configured environment administrator remains an explicit recovery identity', () => {
  const actor = resolveAuthoritativeDesktopActor(
    { UserUsername: 'recovery-admin', UserRole: 'Front Desk' },
    [],
    { ADMIN_WEB_USERNAME: 'recovery-admin', ADMIN_WEB_DISPLAY_NAME: 'Recovery Administrator' }
  );
  assert.equal(actor.role, 'Super Admin');
  assert.equal(actor.source, 'environment-admin');
});
