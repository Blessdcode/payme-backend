import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const ACCEPTED = {
  data: {
    message: 'If the account is eligible, a verification email will be sent.',
  },
} as const;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async request(email: string) {
    if (!this.email.enabled)
      throw new ServiceUnavailableException('Email delivery is not configured');
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (user && !user.emailVerifiedAt) await this.send(user);
    return ACCEPTED;
  }

  async send(user: { id: string; email: string }): Promise<void> {
    if (!this.email.enabled) return;
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hash(token);
    const now = new Date();
    try {
      const reserved = await this.prisma.$transaction(async tx => {
        // Conditional update serializes concurrent sends and enforces cooldown
        // across processes, not only the per-IP HTTP rate limiter.
        const claim = await tx.user.updateMany({
          where: {
            id: user.id,
            emailVerifiedAt: null,
            OR: [
              { emailVerificationSentAt: null },
              {
                emailVerificationSentAt: {
                  lte: new Date(now.getTime() - 60000),
                },
              },
            ],
          },
          data: { emailVerificationSentAt: now },
        });
        if (claim.count !== 1) return false;
        const data = {
          tokenHash,
          expiresAt: new Date(now.getTime() + 86400000),
          createdAt: now,
        };
        await tx.emailVerificationToken.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...data },
          update: data,
        });
        return true;
      });
      if (!reserved) return;
      void this.deliver(user, token, tokenHash, now).catch(() => {
        this.logger.warn(
          'Email delivery failed; retry through the request endpoint',
        );
      });
    } catch {
      // Registration remains successful. Resend has the same public
      // response for unknown, verified, rate-limited, and delivery-failed users.
      this.logger.warn(
        'Verification email could not be sent; retry through the resend endpoint',
      );
    }
  }

  async confirm(token: string) {
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const record = await tx.emailVerificationToken.findUnique({
        where: { tokenHash: this.hash(token) },
      });
      if (!record || record.expiresAt <= now) throw this.invalidToken();
      // Lock the user before the token, matching resend's lock order.
      const updated = await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw this.invalidToken();
      const consumed = await tx.emailVerificationToken.deleteMany({
        where: {
          userId: record.userId,
          tokenHash: record.tokenHash,
          expiresAt: { gt: new Date() },
        },
      });
      if (consumed.count !== 1) throw this.invalidToken();
    });
    return { data: { message: 'Email address verified' } };
  }

  private async deliver(
    user: { id: string; email: string },
    token: string,
    tokenHash: string,
    now: Date,
  ): Promise<void> {
    try {
      await this.email.sendVerification(user.email, token, randomUUID());
    } catch {
      await this.prisma.$transaction(async tx => {
        await tx.user.updateMany({
          where: { id: user.id, emailVerificationSentAt: now },
          data: { emailVerificationSentAt: null },
        });
        await tx.emailVerificationToken.deleteMany({
          where: { userId: user.id, tokenHash },
        });
      });
      throw new Error('Email not delivered');
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private invalidToken(): BadRequestException {
    return new BadRequestException('Verification link is invalid or expired');
  }
}
