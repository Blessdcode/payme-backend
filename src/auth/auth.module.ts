import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EmailModule } from '../email/email.module';
import { EmailVerificationService } from './email-verification.service';
import { VerifiedEmailGuard } from './verified-email.guard';
import { ChangePasswordService } from './change-password.service';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [AuthController],
  providers: [
    PasswordResetService,
    ChangePasswordService,
    AuthService,
    AuthGuard,
    PasswordService,
    TokenService,
    EmailVerificationService,
    VerifiedEmailGuard,
  ],
  exports: [AuthGuard, AuthService, VerifiedEmailGuard],
})
export class AuthModule {}
