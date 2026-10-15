require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { AuthService } = require('../dist/auth/auth.service');
const { TokenService } = require('../dist/auth/token.service');
const { configureApp } = require('../dist/configure-app');
const { setAuthCookies, clearAuthCookies } = require('../dist/auth/cookies');

function fakeDatabase() {
  const users = new Map();
  const sessions = new Map();
  function safeUser(user) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
    };
  }
  function matches(session, where) {
    return (
      (!where.id || where.id === session.id) &&
      (!where.userId || where.userId === session.userId) &&
      (where.revokedAt === undefined ||
        where.revokedAt === session.revokedAt) &&
      (!where.refreshTokenHash ||
        where.refreshTokenHash === session.refreshTokenHash) &&
      (!where.expiresAt || session.expiresAt > where.expiresAt.gt)
    );
  }
  return {
    users,
    sessions,
    user: {
      create: async ({ data }) => {
        if ([...users.values()].some(user => user.email === data.email)) {
          throw Object.assign(new Error('Duplicate email'), { code: 'P2002' });
        }
        const user = { ...data, createdAt: new Date() };
        users.set(user.id, user);
        const session = {
          ...data.sessions.create,
          userId: user.id,
          revokedAt: null,
        };
        sessions.set(session.id, session);
        return safeUser(user);
      },
      findUnique: async ({ where }) =>
        [...users.values()].find(user => user.email === where.email) ?? null,
    },
    session: {
      create: async ({ data }) => {
        const session = { ...data, revokedAt: null };
        sessions.set(session.id, session);
        return session;
      },
      findUnique: async ({ where }) => {
        const session = sessions.get(where.id);
        return session
          ? { ...session, user: safeUser(users.get(session.userId)) }
          : null;
      },
      findFirst: async ({ where }) => {
        const session = [...sessions.values()].find(item =>
          matches(item, where),
        );
        return session ? { user: safeUser(users.get(session.userId)) } : null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const session of sessions.values()) {
          if (matches(session, where)) {
            Object.assign(session, data);
            count++;
          }
        }
        return { count };
      },
    },
  };
}

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ');
}

test('registration, login, refresh, replay protection, logout and origin validation', async t => {
  const original = { ...process.env };
  const settings = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  };
  Object.assign(process.env, settings);
  // ConfigModule validates when AppModule is imported. Establish test settings first.
  const { AppModule } = require('../dist/app.module');
  const db = fakeDatabase();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApp(app);
  t.after(async () => {
    await app.close();
    for (const key of Object.keys(settings)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1/auth`;
  const call = (route, body, cookie, origin = settings.FRONTEND_URL) =>
    fetch(`${base}/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const account = {
    email: '  ADA@EXAMPLE.COM ',
    firstName: ' Ada ',
    lastName: ' Okafor ',
    password: 'a-long-test-password-123',
  };

  assert.equal((await fetch(`${base}/me`)).status, 401);
  assert.equal((await call('register', account, undefined, '')).status, 403);
  const alternateCase = await fetch(`${await app.getUrl()}/API/V1/AUTH/LOGIN`, {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'ada@example.com',
      password: 'test-password',
    }),
  });
  assert.equal(alternateCase.status, 403);
  assert.equal(
    (await call('register', account, undefined, 'https://untrusted.example'))
      .status,
    403,
  );
  assert.equal(
    (await call('register', { ...account, password: 'short' })).status,
    400,
  );
  assert.equal(
    (await call('register', { ...account, password: '😀'.repeat(24) })).status,
    400,
  );
  assert.equal(
    (await call('register', { ...account, role: 'admin' })).status,
    400,
  );
  const registered = await call('register', account);
  assert.equal(registered.status, 201);
  const registeredBody = await registered.json();
  assert.equal(registeredBody.data.email, 'ada@example.com');
  assert.equal(registeredBody.data.firstName, 'Ada');
  assert.deepEqual(Object.keys(registeredBody.data).sort(), [
    'createdAt',
    'email',
    'firstName',
    'id',
    'lastName',
  ]);
  assert.equal(registered.headers.get('cache-control'), 'no-store');
  const initialCookies = cookiesFrom(registered);
  for (const cookie of registered.headers.getSetCookie()) {
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  }
  assert.match([...db.users.values()][0].passwordHash, /^\$2[ab]\$12\$/);
  const stored = [...db.sessions.values()][0];
  assert.match(stored.refreshTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(!initialCookies.includes(stored.refreshTokenHash));
  const duplicate = await call('register', account);
  assert.equal(duplicate.status, 409);
  const me = await fetch(`${base}/me`, { headers: { Cookie: initialCookies } });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), registeredBody);

  const wrong = await call('login', {
    email: account.email,
    password: 'wrong-password',
  });
  const unknown = await call('login', {
    email: 'missing@example.com',
    password: 'wrong-password',
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal((await wrong.json()).message, (await unknown.json()).message);

  const refresh = await call('refresh', undefined, initialCookies);
  assert.equal(refresh.status, 200);
  const rotatedCookies = cookiesFrom(refresh);
  assert.notEqual(rotatedCookies, initialCookies);
  assert.equal((await call('refresh', undefined, initialCookies)).status, 401);
  assert.equal(
    (await fetch(`${base}/me`, { headers: { Cookie: rotatedCookies } })).status,
    401,
  );

  const loggedIn = await call('login', {
    email: account.email,
    password: account.password,
  });
  assert.equal(loggedIn.status, 200);
  const loginCookies = cookiesFrom(loggedIn);
  assert.equal(
    (await fetch(`${base}/me`, { headers: { Cookie: loginCookies } })).status,
    200,
  );
  const loggedOut = await call('logout', undefined, loginCookies);
  assert.equal(loggedOut.status, 204);
  assert.equal(loggedOut.headers.getSetCookie().length, 2);
  assert.equal(
    (await fetch(`${base}/me`, { headers: { Cookie: loginCookies } })).status,
    401,
  );
  assert.equal((await call('refresh', undefined, loginCookies)).status, 401);
  assert.equal((await call('logout')).status, 204);

  for (let index = 0; index < 8; index++) {
    await call('login', {
      email: 'missing@example.com',
      password: 'wrong-password',
    });
  }
  assert.equal(
    (
      await call('login', {
        email: 'missing@example.com',
        password: 'wrong-password',
      })
    ).status,
    429,
  );
});

test('tokens enforce expiry, kind, signing key and active database session', async () => {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  });
  const jwt = new JwtService();
  const tokens = new TokenService(jwt, config);
  const issued = await tokens.issue(
    'user-1',
    'session-1',
    new Date(Date.now() + 60000),
  );
  assert.equal(
    (await tokens.verify(issued.accessToken, 'access')).sub,
    'user-1',
  );
  await assert.rejects(tokens.verify(issued.refreshToken, 'access'));
  await assert.rejects(
    tokens.verify(`${issued.accessToken}tampered`, 'access'),
  );
  await assert.rejects(tokens.verify(undefined, 'access'));
  const expired = await tokens.issue(
    'user-1',
    'session-1',
    new Date(Date.now() - 10000),
  );
  await assert.rejects(tokens.verify(expired.refreshToken, 'refresh'));
  const service = new AuthService(
    { session: { findFirst: async () => null } },
    {},
    tokens,
  );
  await assert.rejects(service.currentUser(issued.accessToken));
});

test('production cookie options are secure and clearing matches both paths', () => {
  const written = [];
  const cleared = [];
  const response = {
    cookie: (name, value, options) => written.push({ name, value, options }),
    clearCookie: (name, options) => cleared.push({ name, options }),
  };
  setAuthCookies(
    response,
    {
      accessToken: 'access',
      refreshToken: 'refresh',
      refreshExpiresAt: new Date(Date.now() + 60000),
    },
    true,
  );
  clearAuthCookies(response, true);
  for (const cookie of written) {
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, 'lax');
    assert.equal(
      cleared.find(entry => entry.name === cookie.name).options.path,
      cookie.options.path,
    );
  }
});

test('only one concurrent refresh can replace a token hash, and expired sessions are rejected', async () => {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'test-access-secret-for-automated-tests-only',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-automated-tests-only',
  });
  const tokens = new TokenService(new JwtService(), config);
  const db = fakeDatabase();
  const userId = 'concurrent-user';
  const sessionId = 'concurrent-session';
  db.users.set(userId, {
    id: userId,
    email: 'concurrent@example.com',
    firstName: 'Test',
    lastName: 'Owner',
    createdAt: new Date(),
  });
  const expiresAt = new Date(Date.now() + 60000);
  const issued = await tokens.issue(userId, sessionId, expiresAt);
  const originalHash = tokens.hash(issued.refreshToken);
  db.sessions.set(sessionId, {
    id: sessionId,
    userId,
    refreshTokenHash: originalHash,
    revokedAt: null,
    expiresAt,
  });
  const auth = new AuthService(db, {}, tokens);
  const results = await Promise.allSettled([
    auth.refresh(issued.refreshToken),
    auth.refresh(issued.refreshToken),
  ]);
  assert.equal(
    results.filter(result => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.filter(result => result.status === 'rejected').length,
    1,
  );
  const winner = results.find(result => result.status === 'fulfilled').value;
  assert.equal(
    db.sessions.get(sessionId).refreshTokenHash,
    tokens.hash(winner.tokens.refreshToken),
  );
  assert.equal(winner.tokens.refreshExpiresAt.getTime(), expiresAt.getTime());

  db.sessions.get(sessionId).expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(auth.refresh(winner.tokens.refreshToken));
  await assert.rejects(auth.currentUser(winner.tokens.accessToken));
});
