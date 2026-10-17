require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Reflector } = require('@nestjs/core');
const { AuthGuard, AllowUnverifiedEmail } = require('../dist/auth/auth.guard');

test('protected APIs reject unverified sessions by default; only explicit bootstrap exceptions pass', async () => {
  const request = { cookies: {} };
  const controller = class {};
  const handler = () => {};
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  };
  let verified = false;
  const guard = new AuthGuard(
    {
      currentUser: async () => ({
        id: 'test-user',
        emailVerifiedAt: verified ? new Date() : null,
      }),
    },
    new Reflector(),
  );
  await assert.rejects(
    guard.canActivate(context),
    error => error.getStatus() === 403,
  );
  AllowUnverifiedEmail()(handler);
  assert.equal(await guard.canActivate(context), true);
  const ordinary = () => {};
  context.getHandler = () => ordinary;
  await assert.rejects(
    guard.canActivate(context),
    error => error.getStatus() === 403,
  );
  verified = true;
  assert.equal(await guard.canActivate(context), true);
});
