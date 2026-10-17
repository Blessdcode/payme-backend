require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { EmailService } = require('../dist/email/email.service');
const {
  EmailVerificationService,
} = require('../dist/auth/email-verification.service');
const { VerifiedEmailGuard } = require('../dist/auth/verified-email.guard');

function fixtures() {
  const users = new Map([
    [
      'user-1',
      {
        id: 'user-1',
        email: 'test@example.com',
        emailVerifiedAt: null,
        emailVerificationSentAt: null,
      },
    ],
  ]);
  const records = new Map();
  const deliveries = [];
  let pending = Promise.resolve();
  const matches = (user, where) => {
    if (where.id && user.id !== where.id) return false;
    if (
      'emailVerifiedAt' in where &&
      user.emailVerifiedAt !== where.emailVerifiedAt
    )
      return false;
    if ('emailVerificationSentAt' in where) {
      const expected = where.emailVerificationSentAt;
      if (expected === null && user.emailVerificationSentAt !== null)
        return false;
      if (
        expected instanceof Date &&
        user.emailVerificationSentAt?.getTime() !== expected.getTime()
      )
        return false;
      if (
        expected?.lte &&
        !(
          user.emailVerificationSentAt instanceof Date &&
          user.emailVerificationSentAt <= expected.lte
        )
      )
        return false;
    }
    return !where.OR || where.OR.some(part => matches(user, part));
  };
  const db = {
    user: {
      findUnique: async ({ where }) =>
        [...users.values()].find(user => user.email === where.email) ?? null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const user of users.values())
          if (matches(user, where)) {
            Object.assign(user, data);
            count++;
          }
        return { count };
      },
    },
    emailVerificationToken: {
      upsert: async ({ where, create, update }) => {
        const record = records.has(where.userId)
          ? { ...records.get(where.userId), ...update }
          : create;
        records.set(where.userId, record);
        return record;
      },
      findUnique: async ({ where }) =>
        [...records.values()].find(
          record => record.tokenHash === where.tokenHash,
        ) ?? null,
      deleteMany: async ({ where }) => {
        const record = records.get(where.userId);
        if (
          !record ||
          record.tokenHash !== where.tokenHash ||
          (where.expiresAt && record.expiresAt <= where.expiresAt.gt)
        )
          return { count: 0 };
        records.delete(where.userId);
        return { count: 1 };
      },
    },
    $transaction: work => {
      const result = pending.then(async () => {
        const beforeUsers = structuredClone([...users]);
        const beforeRecords = structuredClone([...records]);
        try {
          return await work(db);
        } catch (error) {
          users.clear();
          records.clear();
          beforeUsers.forEach(([key, value]) => users.set(key, value));
          beforeRecords.forEach(([key, value]) => records.set(key, value));
          throw error;
        }
      });
      pending = result.catch(() => {});
      return result;
    },
  };
  const email = {
    enabled: true,
    sendVerification: async (to, token) => {
      deliveries.push({ to, token });
    },
  };
  return {
    users,
    records,
    deliveries,
    email,
    db,
    service: new EmailVerificationService(db, email),
  };
}

test('verification stores only a hash, consumes once, and updates verification status', async () => {
  const f = fixtures();
  await f.service.request('test@example.com');
  assert.equal(f.deliveries.length, 1);
  const token = f.deliveries[0].token;
  const record = f.records.get('user-1');
  assert.equal(
    record.tokenHash === createHash('sha256').update(token).digest('hex'),
    true,
  );
  assert.equal(JSON.stringify(record).includes(token), false);
  assert.ok(record.expiresAt.getTime() - Date.now() > 86300000);
  await f.service.confirm(token);
  assert.ok(f.users.get('user-1').emailVerifiedAt instanceof Date);
  assert.equal(f.records.size, 0);
  await assert.rejects(
    f.service.confirm(token),
    error => error.getStatus() === 400,
  );
});

test('expired/tampered tokens do not verify an account', async () => {
  const f = fixtures();
  await f.service.send(f.users.get('user-1'));
  const token = f.deliveries[0].token;
  await assert.rejects(
    f.service.confirm('a'.repeat(64)),
    error => error.getStatus() === 400,
  );
  f.records.get('user-1').expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(
    f.service.confirm(token),
    error => error.getStatus() === 400,
  );
  assert.equal(f.users.get('user-1').emailVerifiedAt, null);
});

test('cooldown covers concurrent sends, resend replaces the link, and only one confirmation wins', async () => {
  const f = fixtures();
  const user = f.users.get('user-1');
  await Promise.all([f.service.send(user), f.service.send(user)]);
  assert.equal(f.deliveries.length, 1);
  const first = f.deliveries[0].token;
  user.emailVerificationSentAt = new Date(Date.now() - 61000);
  await f.service.send(user);
  assert.equal(f.deliveries.length, 2);
  await assert.rejects(f.service.confirm(first));
  const results = await Promise.allSettled([
    f.service.confirm(f.deliveries[1].token),
    f.service.confirm(f.deliveries[1].token),
  ]);
  assert.equal(
    results.filter(result => result.status === 'fulfilled').length,
    1,
  );
});

test('unknown, verified, and cooldown accounts get the same generic response', async () => {
  const f = fixtures();
  const unknown = await f.service.request('missing@example.com');
  const eligible = await f.service.request('test@example.com');
  const cooldown = await f.service.request('test@example.com');
  f.users.get('user-1').emailVerifiedAt = new Date();
  const verified = await f.service.request('test@example.com');
  assert.deepEqual(unknown, eligible);
  assert.deepEqual(unknown, cooldown);
  assert.deepEqual(unknown, verified);
  assert.equal(f.deliveries.length, 1);
});

test('disabled delivery never claims to send; provider failures release reservation for retry', async () => {
  const f = fixtures();
  f.email.enabled = false;
  await assert.rejects(
    f.service.request('test@example.com'),
    error => error.getStatus() === 503,
  );
  await f.service.send(f.users.get('user-1'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.records.size, 0);
  f.email.enabled = true;
  f.email.sendVerification = async () => {
    throw new Error('Synthetic provider failure');
  };
  await f.service.request('test@example.com');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.records.size, 0);
  assert.equal(f.users.get('user-1').emailVerificationSentAt, null);
});

test('Nodemailer SMTP adapter requires encryption, reuses transport and sanitizes failures', async t => {
  const module = require('nodemailer');
  const nodemailer = module.default ?? module;
  const configurations = [];
  const messages = [];
  let failure;
  let rejected = false;
  t.mock.method(nodemailer, 'createTransport', options => {
    configurations.push(options);
    return {
      sendMail: async message => {
        if (failure) throw failure;
        messages.push(message);
        return {
          accepted: rejected ? [] : ['test@example.com'],
          rejected: rejected ? ['test@example.com'] : [],
        };
      },
    };
  });
  const settings = {
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'test-user',
    SMTP_PASSWORD: 'test-not-real',
    EMAIL_FROM: 'verify@example.com',
    FRONTEND_URL: 'https://app.example.com',
  };
  const email = new EmailService(new ConfigService(settings));
  await email.sendVerification(
    'test@example.com',
    'a'.repeat(64),
    'test-delivery-id',
  );
  await email.sendVerification(
    'test@example.com',
    'b'.repeat(64),
    'test-delivery-id-2',
  );
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].secure, false);
  assert.equal(configurations[0].requireTLS, true);
  assert.equal(configurations[0].tls.rejectUnauthorized, true);
  assert.equal(configurations[0].logger, false);
  assert.equal(configurations[0].debug, false);
  const link = new URL(messages[0].text.match(/https:\/\/\S+/)[0]);
  assert.equal(link.pathname, '/verify-email');
  assert.equal(link.search, '');
  assert.equal(new URLSearchParams(link.hash.slice(1)).has('token'), true);
  assert.equal(messages[0].messageId, '<test-delivery-id@app.example.com>');
  await email.sendPasswordReset(
    'test@example.com',
    'f'.repeat(64),
    'reset-test',
  );
  assert.equal(messages[2].subject, 'Reset your Pay Me password');
  const resetLink = new URL(messages[2].text.match(/https:\/\/\S+/)[0]);
  assert.equal(resetLink.pathname, '/reset-password');
  assert.equal(resetLink.search, '');
  assert.equal(
    new URLSearchParams(resetLink.hash.slice(1)).get('token'),
    'f'.repeat(64),
  );
  assert.match(messages[2].text, /30 minutes/);
  const implicitTls = new EmailService(
    new ConfigService({ ...settings, SMTP_PORT: 465, SMTP_SECURE: true }),
  );
  await implicitTls.sendVerification(
    'test@example.com',
    'c'.repeat(64),
    'test-implicit',
  );
  assert.equal(configurations[1].secure, true);
  assert.equal(configurations[1].requireTLS, false);
  rejected = true;
  await assert.rejects(
    email.sendVerification('test@example.com', 'd'.repeat(64), 'test-reject'),
    error => error.getStatus() === 503,
  );
  rejected = false;
  failure = new Error('Synthetic SMTP credential details');
  await assert.rejects(
    email.sendVerification('test@example.com', 'e'.repeat(64), 'test-failure'),
    error =>
      error.getStatus() === 503 &&
      error.message === 'Email delivery is temporarily unavailable',
  );
});

test('verified-email guard rejects unverified or missing users', () => {
  const guard = new VerifiedEmailGuard();
  const context = user => ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  });
  assert.throws(() => guard.canActivate(context(undefined)));
  assert.throws(() => guard.canActivate(context({ emailVerifiedAt: null })));
  assert.equal(
    guard.canActivate(context({ emailVerifiedAt: new Date() })),
    true,
  );
});
