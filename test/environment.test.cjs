const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../dist/config/env.validation');

const valid = {
  JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
  JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/pay_me',
  FRONTEND_URL: 'http://localhost:5173',
};

test('valid configuration has defaults and coerces the port', () => {
  assert.equal(validateEnvironment(valid).PORT, 3000);
  assert.equal(validateEnvironment({ ...valid, PORT: '3001' }).PORT, 3001);
});

test('rejects missing database URL, non-Postgres URLs and invalid ports', () => {
  assert.throws(() =>
    validateEnvironment({ FRONTEND_URL: valid.FRONTEND_URL }),
  );
  assert.throws(() =>
    validateEnvironment({ ...valid, DATABASE_URL: 'https://example.com' }),
  );
  for (const PORT of ['0', '65536', 'abc', '2.5']) {
    assert.throws(() => validateEnvironment({ ...valid, PORT }));
  }
});

test('CORS origin must be a single HTTP(S) origin and production requires HTTPS', () => {
  for (const FRONTEND_URL of [
    '*',
    'http://localhost:5173/',
    'http://localhost:5173/path',
    'ftp://example.com',
  ]) {
    assert.throws(() => validateEnvironment({ ...valid, FRONTEND_URL }));
  }
  assert.throws(() =>
    validateEnvironment({ ...valid, NODE_ENV: 'production' }),
  );
  assert.equal(
    validateEnvironment({
      ...valid,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.com',
    }).NODE_ENV,
    'production',
  );
});

test('validation errors do not disclose credential values', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...valid,
        DATABASE_URL: 'secret-password-not-a-url',
      }),
    error => !error.message.includes('secret-password-not-a-url'),
  );
});

test('requires strong, different access and refresh secrets', () => {
  assert.throws(() => validateEnvironment({ ...valid, JWT_ACCESS_SECRET: '' }));
  assert.throws(() =>
    validateEnvironment({ ...valid, JWT_REFRESH_SECRET: 'short' }),
  );
  assert.throws(() =>
    validateEnvironment({
      ...valid,
      JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET,
    }),
  );
});

test('email delivery is disabled by default and SMTP requires its credentials', () => {
  assert.equal(validateEnvironment(valid).EMAIL_PROVIDER, 'disabled');
  assert.throws(() =>
    validateEnvironment({ ...valid, EMAIL_PROVIDER: 'smtp' }),
  );
  assert.equal(
    validateEnvironment({
      ...valid,
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'test-user',
      SMTP_PASSWORD: 'test-not-real',
      EMAIL_FROM: 'verify@example.com',
    }).EMAIL_PROVIDER,
    'smtp',
  );
});

test('SMTP TLS settings parse booleans correctly and reject mismatched standard ports', () => {
  const smtp = {
    ...valid,
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'test-user',
    SMTP_PASSWORD: 'test-not-real',
    EMAIL_FROM: 'verify@example.com',
  };
  assert.equal(validateEnvironment(smtp).SMTP_SECURE, false);
  assert.equal(
    validateEnvironment({ ...smtp, SMTP_PORT: '465', SMTP_SECURE: 'true' })
      .SMTP_SECURE,
    true,
  );
  assert.throws(() =>
    validateEnvironment({ ...smtp, SMTP_PORT: '465', SMTP_SECURE: 'false' }),
  );
  assert.throws(() =>
    validateEnvironment({ ...smtp, SMTP_PORT: '587', SMTP_SECURE: 'true' }),
  );
  assert.throws(() =>
    validateEnvironment({ ...smtp, SMTP_SECURE: 'not-a-boolean' }),
  );
  assert.throws(() => validateEnvironment({ ...smtp, SMTP_PORT: '0' }));
});
