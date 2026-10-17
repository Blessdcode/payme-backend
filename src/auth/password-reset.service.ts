import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PasswordService } from './password.service';
import { ResetPasswordDto } from './dto/password-reset.dto';

const ACCEPTED = {
  data: {
    message: 'If the account exists, a password reset email will be sent.',
  },
} as const;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly passwords: PasswordService,
  ) {}

  async request(email: string) {
    if (!this.email.enabled)
      throw new ServiceUnavailableException('Email delivery is not configured');
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user) return ACCEPTED;
    const now = new Date();
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hash(token);
    try {
      const reserved = await this.prisma.$transaction(async tx => {
        const claim = await tx.user.updateMany({
          where: {
            id: user.id,
            passwordHash: user.passwordHash,
            OR: [
              { passwordResetSentAt: null },
              { passwordResetSentAt: { lte: new Date(now.getTime() - 60000) } },
            ],
          },
          data: { passwordResetSentAt: now },
        });
        if (claim.count !== 1) return false;
        const data = {
          tokenHash,
          expiresAt: new Date(now.getTime() + 30 * 60000),
          createdAt: now,
        };
        await tx.passwordResetToken.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...data },
          update: data,
        });
        return true;
      });
      if (!reserved) return ACCEPTED;
      void this.deliver(user, token, tokenHash, now).catch(() => {
        this.logger.warn(
          'Email delivery failed; retry through the request endpoint',
        );
      });
    } catch {
      this.logger.warn(
        'Password reset email could not be sent; retry the request later',
      );
    }
    return ACCEPTED;
  }

  async reset(dto: ResetPasswordDto) {
    const tokenHash = this.hash(dto.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, passwordHash: true } } },
    });
    if (!record || record.expiresAt <= new Date()) throw this.invalidToken();
    if (
      await this.passwords.verify(dto.newPassword, record.user.passwordHash)
    ) {
      throw new BadRequestException(
        'New password must differ from your current password',
      );
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({
        where: { id: record.userId, passwordHash: record.user.passwordHash },
        data: { passwordHash, passwordResetSentAt: null },
      });
      if (changed.count !== 1) throw this.invalidToken();
      const consumed = await tx.passwordResetToken.deleteMany({
        where: {
          userId: record.userId,
          tokenHash,
          expiresAt: { gt: new Date() },
        },
      });
      if (consumed.count !== 1) throw this.invalidToken();
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return {
      data: { message: 'Password reset. Sign in again on all devices.' },
    };
  }

  private async deliver(
    user: { id: string; email: string },
    token: string,
    tokenHash: string,
    now: Date,
  ): Promise<void> {
    try {
      await this.email.sendPasswordReset(user.email, token, randomUUID());
    } catch {
      await this.prisma.$transaction(async tx => {
        // Keep the same user-before-token lock order as reset and password change.
        await tx.user.updateMany({
          where: { id: user.id, passwordResetSentAt: now },
          data: { passwordResetSentAt: null },
        });
        await tx.passwordResetToken.deleteMany({
          where: { userId: user.id, tokenHash },
        });
      });
      throw new Error('Reset email not delivered');
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  private invalidToken(): BadRequestException {
    return new BadRequestException('Password reset link is invalid or expired');
  }
}
