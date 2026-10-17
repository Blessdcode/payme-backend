require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { fakeDatabase } = require('./helpers/auth-database.cjs');

test('HTTP signup, verification, restricted login and recovery succeed even while SMTP is pending', async t => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    EMAIL_PROVIDER: 'disabled',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  });
  const { AppModule } = require('../dist/app.module');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { EmailService } = require('../dist/email/email.service');
  const { configureApp } = require('../dist/configure-app');
  const db = fakeDatabase();
  let verificationToken;
  let resetToken;
  const complete = [];
  const pendingMail = () => new Promise(resolve => complete.push(resolve));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(EmailService)
    .useValue({
      enabled: true,
      sendVerification: async (_to, token) => {
        verificationToken = token;
        await pendingMail();
      },
      sendPasswordReset: async (_to, token) => {
        resetToken = token;
        await pendingMail();
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApp(app);
  t.after(async () => {
    complete.forEach(resolve => resolve());
    await app.close();
  });
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api/v1/auth';
  const post = (route, body, cookie) =>
    fetch(base + '/' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  const account = {
    email: 'flow@example.com',
    firstName: 'Test',
    lastName: 'User',
    password: 'old-password',
  };
  const registered = await post('register', account);
  assert.equal(registered.status, 201);
  assert.equal(db.sessions.size, 0);
  assert.equal(
    (await post('login', { email: account.email, password: account.password }))
      .status,
    403,
  );
  assert.equal(db.sessions.size, 0);
  const user = [...db.users.values()][0];
  user.emailVerificationSentAt = new Date(0);
  assert.equal(
    (await post('email-verification/request', { email: account.email })).status,
    202,
  );
  assert.match(verificationToken, /^[a-f0-9]{64}$/);
  assert.equal(
    (await post('email-verification/confirm', { token: verificationToken }))
      .status,
    200,
  );
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
    (await fetch(base + '/me', { headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal(
    (await post('forgot-password', { email: account.email })).status,
    202,
  );
  assert.match(resetToken, /^[a-f0-9]{64}$/);
  assert.equal(
    (
      await post('reset-password', {
        token: resetToken,
        newPassword: 'new-password',
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(base + '/me', { headers: { Cookie: cookie } })).status,
    401,
  );
  assert.equal(
    (
      await post('reset-password', {
        token: resetToken,
        newPassword: 'other-password',
      })
    ).status,
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
