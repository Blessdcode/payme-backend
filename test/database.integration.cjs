require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { HealthService } = require('../dist/health/health.service');
const { validateEnvironment } = require('../dist/config/env.validation');

test('PostgreSQL health and tenant foreign keys work against the migrated schema', async () => {
  const config = validateEnvironment(process.env);
  assert.equal(
    config.NODE_ENV,
    'test',
    'Run only against a dedicated test database with NODE_ENV=test',
  );
  const prisma = new PrismaService(new ConfigService(config));
  await prisma.onModuleInit();
  try {
    assert.deepEqual(await new HealthService(prisma).check(), {
      data: { status: 'ok', database: 'up' },
    });
    // The forced rollback removes all fixtures without destructive cleanup.
    const rollback = new Error('Rollback integration fixtures');
    await assert.rejects(
      prisma.$transaction(async tx => {
        const unique = randomUUID();
        const user = await tx.user.create({
          data: {
            email: `${unique}@example.test`,
            passwordHash: 'test-only-unusable-hash',
            firstName: 'Test',
            lastName: 'Owner',
          },
        });
        const first = await tx.business.create({
          data: { ownerId: user.id, name: 'First', slug: `first-${unique}` },
        });
        const verification = await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: 'd'.repeat(64),
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        assert.equal(verification.userId, user.id);
        const reserved = await tx.user.updateMany({
          where: {
            id: user.id,
            emailVerifiedAt: null,
            emailVerificationSentAt: null,
          },
          data: { emailVerificationSentAt: new Date() },
        });
        assert.equal(reserved.count, 1);
        const duplicateSend = await tx.user.updateMany({
          where: {
            id: user.id,
            emailVerifiedAt: null,
            emailVerificationSentAt: null,
          },
          data: { emailVerificationSentAt: new Date() },
        });
        assert.equal(duplicateSend.count, 0);
        await tx.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date() },
        });
        const consumed = await tx.emailVerificationToken.deleteMany({
          where: {
            userId: user.id,
            tokenHash: 'd'.repeat(64),
            expiresAt: { gt: new Date() },
          },
        });
        assert.equal(consumed.count, 1);
        assert.equal(
          (
            await tx.emailVerificationToken.deleteMany({
              where: { userId: user.id },
            })
          ).count,
          0,
        );
        const second = await tx.business.create({
          data: { ownerId: user.id, name: 'Second', slug: `second-${unique}` },
        });
        const customer = await tx.customer.create({
          data: { businessId: first.id, name: 'Customer' },
        });
        const invoice = await tx.invoice.create({
          data: {
            businessId: first.id,
            customerId: customer.id,
            invoiceNumber: 'INV-001',
            subtotal: '0.30',
            total: '0.30',
          },
        });
        assert.equal(invoice.total.toFixed(2), '0.30');

        const session = await tx.session.create({
          data: {
            userId: user.id,
            refreshTokenHash: 'a'.repeat(64),
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        const rotated = await tx.session.updateMany({
          where: {
            id: session.id,
            refreshTokenHash: 'a'.repeat(64),
            revokedAt: null,
          },
          data: { refreshTokenHash: 'b'.repeat(64) },
        });
        assert.equal(rotated.count, 1);
        const replay = await tx.session.updateMany({
          where: {
            id: session.id,
            refreshTokenHash: 'a'.repeat(64),
            revokedAt: null,
          },
          data: { refreshTokenHash: 'c'.repeat(64) },
        });
        assert.equal(replay.count, 0);

        // Savepoints allow testing expected constraint violations within the
        // rollback-only transaction without leaving PostgreSQL in an aborted state.
        await tx.$executeRawUnsafe('SAVEPOINT tenant_check');
        await assert.rejects(
          tx.invoice.create({
            data: {
              businessId: second.id,
              customerId: customer.id,
              invoiceNumber: 'INV-001',
              subtotal: '1.00',
              total: '1.00',
            },
          }),
          error => error.code === 'P2003',
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT tenant_check');

        await assert.rejects(
          tx.payment.create({
            data: {
              businessId: second.id,
              invoiceId: invoice.id,
              amount: '0.30',
              currency: 'NGN',
            },
          }),
          error => error.code === 'P2003',
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT tenant_check');
        throw rollback;
      }),
      error => error === rollback,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
});
