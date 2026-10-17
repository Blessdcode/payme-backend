require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../dist/auth/auth.service');
const { fakeDatabase } = require('./helpers/auth-database.cjs');

test('registration returns an unverified user without a session without waiting for SMTP; late failure remains retryable', async () => {
  const db = fakeDatabase();
  let rejectDelivery;
  let recipient;
  const delivery = new Promise((_resolve, reject) => {
    rejectDelivery = reject;
  });
  const service = new AuthService(
    db,
    { hash: async () => 'test-password-hash' },
    {
      issue: async () => ({
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
      }),
      hash: () => 'test-refresh-hash',
    },
    {
      send: user => {
        recipient = user;
        return delivery;
      },
    },
  );
  let timer;
  try {
    const result = await Promise.race([
      service.register({
        email: 'slow-mail@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'test-password',
      }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error('Registration waited for email delivery')),
          1000,
        );
      }),
    ]);
    assert.equal(result.user.email, 'slow-mail@example.com');
    assert.equal(result.user.emailVerifiedAt, null);
    assert.equal(result.tokens, undefined);
    assert.equal(recipient.id, result.user.id);
    assert.equal(db.users.size, 1);
    assert.equal(db.sessions.size, 0);
    rejectDelivery(Error('Synthetic mail failure'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.users.size, 1);
    assert.equal(db.sessions.size, 0);
  } finally {
    clearTimeout(timer);
  }
});
