require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  ChangePasswordService,
} = require('../dist/auth/change-password.service');
const { ChangePasswordDto } = require('../dist/auth/dto/change-password.dto');
const { AuthService } = require('../dist/auth/auth.service');
const { fakeDatabase } = require('./helpers/auth-database.cjs');

function fixture() {
  const db = fakeDatabase();
  db.users.set('user-1', {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: 'old-test-password',
  });
  db.sessions.set('session-1', {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
  });
  db.sessions.set('session-2', {
    id: 'session-2',
    userId: 'other-user',
    revokedAt: null,
  });
  const passwords = {
    verify: async (password, hash) => password === hash,
    hash: async password => `hashed-${password}`,
  };
  return { db, passwords, service: new ChangePasswordService(db, passwords) };
}

test('change-password validation accepts eight characters, rejects seven and over-72-byte Unicode', async () => {
  const values = {
    currentPassword: ' old-test-password ',
    newPassword: '12345678',
  };
  const dto = plainToInstance(ChangePasswordDto, values);
  assert.deepEqual(await validate(dto), []);
  assert.equal(dto.currentPassword, values.currentPassword);
  for (const newPassword of ['1234567', '😀'.repeat(24)]) {
    assert.ok(
      (
        await validate(
          plainToInstance(ChangePasswordDto, { ...values, newPassword }),
        )
      ).length > 0,
    );
  }
});

test('incorrect current password and password reuse leave credentials and sessions unchanged', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.change('user-1', {
      currentPassword: 'wrong-password',
      newPassword: 'new-test-password',
    }),
    error => error.getStatus() === 400,
  );
  await assert.rejects(
    f.service.change('user-1', {
      currentPassword: 'old-test-password',
      newPassword: 'old-test-password',
    }),
    error => error.getStatus() === 400,
  );
  assert.equal(f.db.users.get('user-1').passwordHash, 'old-test-password');
  assert.equal(f.db.sessions.get('session-1').revokedAt, null);
});

test('password change revokes only the account sessions and rolls back on revocation failure', async () => {
  const f = fixture();
  const revoke = f.db.session.updateMany;
  f.db.session.updateMany = async () => {
    throw new Error('Synthetic database failure');
  };
  await assert.rejects(
    f.service.change('user-1', {
      currentPassword: 'old-test-password',
      newPassword: 'new-test-password',
    }),
  );
  assert.equal(f.db.users.get('user-1').passwordHash, 'old-test-password');
  assert.equal(f.db.sessions.get('session-1').revokedAt, null);
  f.db.session.updateMany = revoke;
  await f.service.change('user-1', {
    currentPassword: 'old-test-password',
    newPassword: 'new-test-password',
  });
  assert.equal(
    f.db.users.get('user-1').passwordHash,
    'hashed-new-test-password',
  );
  assert.ok(f.db.sessions.get('session-1').revokedAt instanceof Date);
  assert.equal(f.db.sessions.get('session-2').revokedAt, null);
});

test('concurrent password changes cannot overwrite the winning credentials', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.service.change('user-1', {
      currentPassword: 'old-test-password',
      newPassword: 'new-test-password-a',
    }),
    f.service.change('user-1', {
      currentPassword: 'old-test-password',
      newPassword: 'new-test-password-b',
    }),
  ]);
  assert.equal(
    results.filter(result => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.find(result => result.status === 'rejected').reason.getStatus(),
    409,
  );
});

test('login checked against old credentials cannot create a session after password change', async () => {
  const f = fixture();
  let release;
  let reached;
  const paused = new Promise(resolve => {
    release = resolve;
  });
  const signing = new Promise(resolve => {
    reached = resolve;
  });
  const tokens = {
    issue: async () => {
      reached();
      await paused;
      return { accessToken: 'test-access', refreshToken: 'test-refresh' };
    },
    hash: () => 'test-token-hash',
  };
  const auth = new AuthService(f.db, f.passwords, tokens, {});
  const login = auth.login({
    email: 'test@example.com',
    password: 'old-test-password',
  });
  await signing;
  await f.service.change('user-1', {
    currentPassword: 'old-test-password',
    newPassword: 'new-test-password',
  });
  release();
  await assert.rejects(login, error => error.getStatus() === 401);
  assert.equal(
    [...f.db.sessions.values()].filter(
      session => session.userId === 'user-1' && !session.revokedAt,
    ).length,
    0,
  );
});
