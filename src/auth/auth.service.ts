import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_SECONDS } from './auth.constants';
import { publicUserSelect, type AuthTokens, type AuthUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EmailVerificationService } from './email-verification.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: AuthUser }> {
    const userId = randomUUID();
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      // Verification is required before creating any authenticated session.
      const user = await this.prisma.user.create({
        data: {
          id: userId,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
        },
        select: publicUserSelect,
      });
      // Account creation is complete. SMTP must not delay the response
      // and make a successful registration appear to have failed in the browser.
      void this.emailVerification.send(user).catch(() => {
        this.logger.warn(
          'Registration verification email failed; use the resend endpoint',
        );
      });
      return { user };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const record = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...publicUserSelect, passwordHash: true },
    });
    const matches = await this.passwords.verify(
      dto.password,
      record?.passwordHash,
    );
    if (!record || !matches)
      throw new UnauthorizedException('Invalid email or password');
    if (!record.emailVerifiedAt)
      throw new ForbiddenException(
        'Verify your email address before signing in',
      );
    const sessionId = randomUUID();
    const expiresAt = this.sessionExpiry();
    const tokens = await this.tokens.issue(record.id, sessionId, expiresAt);
    await this.prisma.$transaction(async tx => {
      // The conditional write locks the same user row used by password changes.
      // A login verified against an old hash cannot create a live session after
      // a password change commits its session revocations.
      const current = await tx.user.updateMany({
        where: { id: record.id, passwordHash: record.passwordHash },
        data: { passwordHash: record.passwordHash },
      });
      if (current.count !== 1)
        throw new UnauthorizedException('Invalid email or password');
      await tx.session.create({
        data: {
          id: sessionId,
          userId: record.id,
          refreshTokenHash: this.tokens.hash(tokens.refreshToken),
          expiresAt,
        },
      });
    });
    const user: AuthUser = {
      id: record.id,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      createdAt: record.createdAt,
      emailVerifiedAt: record.emailVerifiedAt,
    };
    return { user, tokens };
  }

  async refresh(
    refreshToken: string | undefined,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    if (!refreshToken)
      throw new UnauthorizedException('Authentication required');
    const claims = await this.tokens.verify(refreshToken, 'refresh');
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      include: { user: { select: publicUserSelect } },
    });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Session expired. Please sign in again');
    }
    const previousHash = this.tokens.hash(refreshToken);
    const stored = Buffer.from(session.refreshTokenHash, 'hex');
    const presented = Buffer.from(previousHash, 'hex');
    if (
      stored.length !== presented.length ||
      !timingSafeEqual(stored, presented)
    ) {
      await this.revoke(session.id);
      throw new UnauthorizedException(
        'Session is no longer valid. Please sign in again',
      );
    }
    // Keep the original absolute expiry; rotation does not create immortal sessions.
    const tokens = await this.tokens.issue(
      session.userId,
      session.id,
      session.expiresAt,
    );
    const updated = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: previousHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { refreshTokenHash: this.tokens.hash(tokens.refreshToken) },
    });
    if (updated.count !== 1) {
      // A competing rotation or logout won. Never issue cookies for the losing request.
      throw new UnauthorizedException('Session changed. Please sign in again');
    }
    return { user: session.user, tokens };
  }

  async currentUser(accessToken: string | undefined): Promise<AuthUser> {
    const claims = await this.tokens.verify(accessToken, 'access');
    const session = await this.prisma.session.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { user: { select: publicUserSelect } },
    });
    if (!session) throw new UnauthorizedException('Authentication required');
    return session.user;
  }

  async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void> {
    for (const [token, kind] of [
      [refreshToken, 'refresh'],
      [accessToken, 'access'],
    ] as const) {
      let sessionId: string;
      try {
        sessionId = (await this.tokens.verify(token, kind)).sid;
      } catch {
        continue;
      }
      await this.revoke(sessionId);
      return;
    }
  }

  private async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private sessionExpiry(): Date {
    return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  }
}
