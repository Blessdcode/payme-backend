require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { configureApp } = require('../dist/configure-app');

test('health, CORS and errors use the production HTTP configuration', async t => {
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  });
  const { AppModule } = require('../dist/app.module');
  let databaseAvailable = true;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({
      $queryRaw: async () => {
        if (!databaseAvailable) throw new Error('sensitive database details');
        return [{ value: 1 }];
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApp(app);
  t.after(async () => {
    await app.close();
    for (const key of [
      'NODE_ENV',
      'DATABASE_URL',
      'FRONTEND_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  const healthy = await fetch(`${url}/health`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), {
    data: { status: 'ok', database: 'up' },
  });
  assert.equal(
    healthy.headers.get('access-control-allow-origin'),
    'http://localhost:5173',
  );
  assert.equal(healthy.headers.get('access-control-allow-credentials'), 'true');
  assert.ok(healthy.headers.get('x-request-id'));
  assert.equal(healthy.headers.get('x-content-type-options'), 'nosniff');

  const untrusted = await fetch(`${url}/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.notEqual(
    untrusted.headers.get('access-control-allow-origin'),
    'https://untrusted.example',
  );
  const preflight = await fetch(`${url}/api/v1/customers`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get('access-control-allow-origin'),
    'http://localhost:5173',
  );

  databaseAvailable = false;
  const unhealthy = await fetch(`${url}/health`);
  assert.equal(unhealthy.status, 503);
  const error = await unhealthy.json();
  assert.equal(error.message, 'Database is unavailable');
  assert.equal(error.requestId, unhealthy.headers.get('x-request-id'));
  assert.ok(!JSON.stringify(error).includes('sensitive database details'));

  const missing = await fetch(`${url}/api/v1/not-found`);
  assert.equal(missing.status, 404);
});
