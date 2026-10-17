require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PasswordResetService } = require('../dist/auth/password-reset.service');
const {
  ChangePasswordService,
} = require('../dist/auth/change-password.service');
const { fakeDatabase } = require('./helpers/auth-database.cjs');
function fixture() {
  const db = fakeDatabase();
  db.users.set('u', {
    id: 'u',
    email: 'test@example.com',
    passwordHash: 'old-password',
  });
  db.sessions.set('s', { id: 's', userId: 'u', revokedAt: null });
  db.sessions.set('other', { id: 'other', userId: 'other', revokedAt: null });
  const sent = [];
  const email = {
    enabled: true,
    sendPasswordReset: async (...args) => sent.push(args),
  };
  const passwords = {
    verify: async (p, h) => p === h,
    hash: async p => 'hash-' + p,
  };
  return {
    db,
    sent,
    email,
    passwords,
    service: new PasswordResetService(db, email, passwords),
  };
}
test('recovery request hides unknown accounts, hashes tokens and enforces cooldown', async () => {
  const f = fixture();
  const unknown = await f.service.request('unknown@example.com');
  assert.deepEqual(await f.service.request('test@example.com'), unknown);
  await f.service.request('test@example.com');
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0][1], /^[a-f0-9]{64}$/);
  assert.notEqual(f.db.resetTokens.get('u').tokenHash, f.sent[0][1]);
  assert.ok(f.db.resetTokens.get('u').expiresAt > Date.now());
});
test('reset consumes token, revokes only owner sessions and rejects replay', async () => {
  const f = fixture();
  await f.service.request('test@example.com');
  const dto = { token: f.sent[0][1], newPassword: 'new-password' };
  await f.service.reset(dto);
  assert.equal(f.db.users.get('u').passwordHash, 'hash-new-password');
  assert.ok(f.db.sessions.get('s').revokedAt);
  assert.equal(f.db.sessions.get('other').revokedAt, null);
  assert.equal(f.db.resetTokens.size, 0);
  await assert.rejects(f.service.reset(dto), e => e.getStatus() === 400);
});
test('invalid, expired and reused-password resets leave credentials unchanged', async () => {
  const f = fixture();
  await f.service.request('test@example.com');
  const token = f.sent[0][1];
  await assert.rejects(
    f.service.reset({ token: 'a'.repeat(64), newPassword: 'new-password' }),
  );
  await assert.rejects(f.service.reset({ token, newPassword: 'old-password' }));
  f.db.resetTokens.get('u').expiresAt = new Date(0);
  await assert.rejects(f.service.reset({ token, newPassword: 'new-password' }));
  assert.equal(f.db.users.get('u').passwordHash, 'old-password');
});
test('reset transaction restores password and token on revocation failure', async () => {
  const f = fixture();
  await f.service.request('test@example.com');
  f.db.session.updateMany = async () => {
    throw Error('Synthetic failure');
  };
  await assert.rejects(
    f.service.reset({ token: f.sent[0][1], newPassword: 'new-password' }),
  );
  assert.equal(f.db.users.get('u').passwordHash, 'old-password');
  assert.equal(f.db.resetTokens.size, 1);
});
test('concurrent reset attempts have one winner', async () => {
  const f = fixture();
  await f.service.request('test@example.com');
  const dto = { token: f.sent[0][1], newPassword: 'new-password' };
  const results = await Promise.allSettled([
    f.service.reset(dto),
    f.service.reset(dto),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('new recovery link replaces old one; authenticated change invalidates recovery', async () => {
  const f = fixture();
  await f.service.request('test@example.com');
  const old = f.sent[0][1];
  f.db.users.get('u').passwordResetSentAt = new Date(0);
  await f.service.request('test@example.com');
  await assert.rejects(
    f.service.reset({ token: old, newPassword: 'new-password' }),
  );
  await new ChangePasswordService(f.db, f.passwords).change('u', {
    currentPassword: 'old-password',
    newPassword: 'changed-password',
  });
  assert.equal(f.db.resetTokens.size, 0);
});
test('mail failure releases cooldown and token; disabled mail returns 503', async () => {
  const f = fixture();
  f.email.sendPasswordReset = async () => {
    throw Error('Synthetic failure');
  };
  await f.service.request('test@example.com');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.db.resetTokens.size, 0);
  assert.equal(f.db.users.get('u').passwordResetSentAt, null);
  f.email.enabled = false;
  await assert.rejects(
    f.service.request('test@example.com'),
    e => e.getStatus() === 503,
  );
});
test('HTTP recovery enforces origin and validation, clears cookies and rejects old login', async t => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    EMAIL_PROVIDER: 'disabled',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  });
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../dist/app.module');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { EmailService } = require('../dist/email/email.service');
  const { configureApp } = require('../dist/configure-app');
  const db = fakeDatabase();
  let token;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(EmailService)
    .useValue({
      enabled: true,
      sendVerification: async () => {},
      sendPasswordReset: async (_to, value) => {
        token = value;
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApp(app);
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api/v1/auth';
  const post = (route, body, origin = 'http://localhost:5173') =>
    fetch(base + '/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  const account = {
    email: 'recovery@example.com',
    firstName: 'Test',
    lastName: 'User',
    password: 'old-password',
  };
  const registered = await post('register', account);
  assert.equal(registered.status, 201);
  const accountUser = [...db.users.values()][0];
  accountUser.emailVerifiedAt = new Date();
  const signedIn = await post('login', {
    email: account.email,
    password: account.password,
  });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');
  assert.equal(
    (
      await post(
        'forgot-password',
        { email: account.email },
        'https://untrusted.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (await post('forgot-password', { email: account.email })).status,
    202,
  );
  assert.equal(
    (
      await post('reset-password', {
        token: 'bad',
        newPassword: 'new-password',
      })
    ).status,
    400,
  );
  assert.equal(
    (await post('reset-password', { token, newPassword: 'short' })).status,
    400,
  );
  const reset = await post('reset-password', {
    token,
    newPassword: 'new-password',
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.headers.getSetCookie().length, 2);
  assert.equal(
    (await fetch(base + '/me', { headers: { Cookie: cookie } })).status,
    401,
  );
  assert.equal(
    (await post('reset-password', { token, newPassword: 'other-password' }))
      .status,
    400,
  );
  assert.equal(
    (await post('login', { email: account.email, password: account.password }))
      .status,
    401,
  );
  assert.equal(
    (await post('login', { email: account.email, password: 'new-password' }))
      .status,
    200,
  );
});
